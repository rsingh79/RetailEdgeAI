import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { adminPrisma } from '../../lib/prisma.js';

const router = Router();

// GET /api/admin/tenants — List all tenants with stats
router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { abn: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status === 'active') {
      where.isLocked = false;
      where.subscriptionStatus = 'active';
    } else if (status === 'trial') {
      where.subscriptionStatus = 'trial';
    } else if (status === 'locked') {
      where.isLocked = true;
    } else if (status === 'expired') {
      where.subscriptionStatus = 'expired';
    }

    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

    const tenants = await adminPrisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, stores: true } },
        planTier: { select: { id: true, name: true, slug: true } },
      },
    });

    // Attach API usage stats per tenant
    const tenantIds = tenants.map((t) => t.id);
    const usageByTenant = await adminPrisma.apiUsageLog.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds }, createdAt: { gte: startOfMonth } },
      _sum: { costUsd: true },
      _count: true,
    });

    const usageMap = {};
    for (const u of usageByTenant) {
      usageMap[u.tenantId] = {
        apiCostMtd: Math.round((u._sum.costUsd || 0) * 100) / 100,
        apiCallsMtd: u._count,
      };
    }

    const result = tenants.map((t) => ({
      ...t,
      apiCostMtd: usageMap[t.id]?.apiCostMtd || 0,
      apiCallsMtd: usageMap[t.id]?.apiCallsMtd || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/tenants/:id — Full tenant detail
router.get('/:id', async (req, res) => {
  try {
    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { stores: true, products: true, invoices: true },
        },
        planTier: {
          select: {
            id: true,
            name: true,
            slug: true,
            monthlyPrice: true,
            features: { select: { feature: { select: { key: true, name: true } } } },
            limits: { select: { limitKey: true, limitValue: true } },
          },
        },
      },
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Get access logs
    const accessLogs = await adminPrisma.tenantAccessLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get API usage summary
    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );
    const usageSummary = await adminPrisma.apiUsageLog.aggregate({
      where: { tenantId: tenant.id, createdAt: { gte: startOfMonth } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });

    res.json({
      ...tenant,
      accessLogs,
      usageSummary: {
        apiCallsMtd: usageSummary._count,
        apiCostMtd:
          Math.round((usageSummary._sum.costUsd || 0) * 100) / 100,
        inputTokensMtd: usageSummary._sum.inputTokens || 0,
        outputTokensMtd: usageSummary._sum.outputTokens || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/tenants — Create a new tenant with owner
router.post('/', async (req, res) => {
  try {
    const {
      name,
      abn,
      timezone,
      currency,
      contactEmail,
      contactPhone,
      ownerName,
      ownerEmail,
      trialDays,
    } = req.body;

    if (!name || !ownerEmail) {
      return res
        .status(400)
        .json({ message: 'name and ownerEmail are required' });
    }

    // Check if owner email already exists
    const existingUser = await adminPrisma.user.findUnique({
      where: { email: ownerEmail },
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Calculate trial end date
    const trialEndsAt = trialDays
      ? new Date(Date.now() + trialDays * 86400000)
      : new Date(Date.now() + 14 * 86400000); // default 14 days

    // Find default tier
    const defaultTier = await adminPrisma.planTier.findFirst({
      where: { isDefault: true, isActive: true },
    });

    // Create tenant
    const tenant = await adminPrisma.tenant.create({
      data: {
        name,
        abn: abn || null,
        timezone: timezone || 'Australia/Sydney',
        currency: currency || 'AUD',
        contactEmail: contactEmail || ownerEmail,
        contactPhone: contactPhone || null,
        trialEndsAt,
        subscriptionStatus: 'trial',
        plan: defaultTier?.slug || 'starter',
        planTierId: defaultTier?.id || null,
      },
    });

    // Create owner user with a temporary password
    const tempPassword = Math.random().toString(36).slice(-10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const owner = await adminPrisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ownerEmail,
        name: ownerName || name,
        passwordHash,
        role: 'OWNER',
      },
    });

    // Log the registration
    await adminPrisma.tenantAccessLog.create({
      data: {
        tenantId: tenant.id,
        action: 'REGISTERED',
        reason: `Created by admin`,
        performedBy: req.user.userId,
      },
    });

    res.status(201).json({
      tenant,
      owner: {
        id: owner.id,
        email: owner.email,
        name: owner.name,
        role: owner.role,
      },
      tempPassword,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/tenants/:id — Update tenant details
router.patch('/:id', async (req, res) => {
  try {
    const { name, abn, timezone, currency, contactEmail, contactPhone } =
      req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (abn !== undefined) updateData.abn = abn;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (currency !== undefined) updateData.currency = currency;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;

    const tenant = await adminPrisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json(tenant);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ message: 'Tenant not found' });
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/tenants/:id/lock — Lock tenant access
router.post('/:id/lock', async (req, res) => {
  try {
    const { reason } = req.body;

    const tenant = await adminPrisma.tenant.update({
      where: { id: req.params.id },
      data: {
        isLocked: true,
        lockReason: reason || 'Locked by admin',
        lockedAt: new Date(),
        lockedBy: req.user.userId,
      },
    });

    await adminPrisma.tenantAccessLog.create({
      data: {
        tenantId: tenant.id,
        action: 'LOCKED',
        reason: reason || 'Locked by admin',
        performedBy: req.user.userId,
      },
    });

    res.json(tenant);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ message: 'Tenant not found' });
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/tenants/:id/unlock — Unlock tenant access
router.post('/:id/unlock', async (req, res) => {
  try {
    const tenant = await adminPrisma.tenant.update({
      where: { id: req.params.id },
      data: {
        isLocked: false,
        lockReason: null,
        lockedAt: null,
        lockedBy: null,
      },
    });

    await adminPrisma.tenantAccessLog.create({
      data: {
        tenantId: tenant.id,
        action: 'UNLOCKED',
        reason: req.body.reason || 'Unlocked by admin',
        performedBy: req.user.userId,
      },
    });

    res.json(tenant);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ message: 'Tenant not found' });
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/tenants/:id/subscription — Update subscription settings
router.patch('/:id/subscription', async (req, res) => {
  try {
    const {
      plan,
      planTierId,
      subscriptionStatus,
      trialEndsAt,
      maxUsers,
      paymentMethodOnFile,
    } = req.body;
    const updateData = {};

    // DB-driven tier change
    if (planTierId !== undefined) {
      // Verify the tier exists
      const tier = await adminPrisma.planTier.findUnique({
        where: { id: planTierId },
        include: {
          limits: true,
        },
      });
      if (!tier) {
        return res.status(400).json({ message: 'Invalid plan tier ID' });
      }
      updateData.planTierId = planTierId;
      // Sync legacy plan field for backward compat
      updateData.plan = tier.slug;

      // Sync legacy limit columns from tier limits
      const limitMap = {};
      for (const l of tier.limits) {
        limitMap[l.limitKey] = l.limitValue;
      }
      if (limitMap.max_users) updateData.maxUsers = limitMap.max_users;
      if (limitMap.max_stores) updateData.maxStores = limitMap.max_stores;
      if (limitMap.max_invoice_pages_per_month) updateData.maxApiCallsPerMonth = limitMap.max_invoice_pages_per_month;
    } else if (plan !== undefined) {
      // Legacy: look up tier by slug and assign
      const tier = await adminPrisma.planTier.findUnique({
        where: { slug: plan },
        include: { limits: true },
      });
      updateData.plan = plan;
      if (tier) {
        updateData.planTierId = tier.id;
        const limitMap = {};
        for (const l of tier.limits) {
          limitMap[l.limitKey] = l.limitValue;
        }
        if (limitMap.max_users) updateData.maxUsers = limitMap.max_users;
        if (limitMap.max_stores) updateData.maxStores = limitMap.max_stores;
        if (limitMap.max_invoice_pages_per_month) updateData.maxApiCallsPerMonth = limitMap.max_invoice_pages_per_month;
      }
    }

    if (subscriptionStatus !== undefined)
      updateData.subscriptionStatus = subscriptionStatus;
    if (trialEndsAt !== undefined)
      updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
    if (maxUsers !== undefined) updateData.maxUsers = maxUsers;
    if (paymentMethodOnFile !== undefined)
      updateData.paymentMethodOnFile = paymentMethodOnFile;

    const tenant = await adminPrisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Log plan/tier change
    if (planTierId !== undefined || plan !== undefined) {
      await adminPrisma.tenantAccessLog.create({
        data: {
          tenantId: tenant.id,
          action: 'PLAN_CHANGED',
          reason: `Plan changed to ${updateData.plan || plan} by admin`,
          performedBy: req.user.userId,
        },
      });
    }

    res.json(tenant);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ message: 'Tenant not found' });
    res.status(500).json({ message: err.message });
  }
});

export default router;
