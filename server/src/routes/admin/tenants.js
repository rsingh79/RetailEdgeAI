import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { basePrisma } from '../../lib/prisma.js';
import { getPlanLimits } from '../../config/plans.js';

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

    const tenants = await basePrisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, stores: true } },
      },
    });

    // Attach API usage stats per tenant
    const tenantIds = tenants.map((t) => t.id);
    const usageByTenant = await basePrisma.apiUsageLog.groupBy({
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
    const tenant = await basePrisma.tenant.findUnique({
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
      },
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Get access logs
    const accessLogs = await basePrisma.tenantAccessLog.findMany({
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
    const usageSummary = await basePrisma.apiUsageLog.aggregate({
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
    const existingUser = await basePrisma.user.findUnique({
      where: { email: ownerEmail },
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Calculate trial end date
    const trialEndsAt = trialDays
      ? new Date(Date.now() + trialDays * 86400000)
      : new Date(Date.now() + 14 * 86400000); // default 14 days

    // Create tenant
    const tenant = await basePrisma.tenant.create({
      data: {
        name,
        abn: abn || null,
        timezone: timezone || 'Australia/Sydney',
        currency: currency || 'AUD',
        contactEmail: contactEmail || ownerEmail,
        contactPhone: contactPhone || null,
        trialEndsAt,
        subscriptionStatus: 'trial',
        plan: 'starter',
      },
    });

    // Create owner user with a temporary password
    const tempPassword = Math.random().toString(36).slice(-10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const owner = await basePrisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ownerEmail,
        name: ownerName || name,
        passwordHash,
        role: 'OWNER',
      },
    });

    // Log the registration
    await basePrisma.tenantAccessLog.create({
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

    const tenant = await basePrisma.tenant.update({
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

    const tenant = await basePrisma.tenant.update({
      where: { id: req.params.id },
      data: {
        isLocked: true,
        lockReason: reason || 'Locked by admin',
        lockedAt: new Date(),
        lockedBy: req.user.userId,
      },
    });

    await basePrisma.tenantAccessLog.create({
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
    const tenant = await basePrisma.tenant.update({
      where: { id: req.params.id },
      data: {
        isLocked: false,
        lockReason: null,
        lockedAt: null,
        lockedBy: null,
      },
    });

    await basePrisma.tenantAccessLog.create({
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
      subscriptionStatus,
      trialEndsAt,
      maxUsers,
      paymentMethodOnFile,
    } = req.body;
    const updateData = {};

    if (plan !== undefined) {
      updateData.plan = plan;
      // Auto-apply plan limits when plan changes
      const limits = getPlanLimits(plan);
      updateData.maxUsers = limits.maxUsers === Infinity ? 999 : limits.maxUsers;
      updateData.maxStores = limits.maxStores === Infinity ? 999 : limits.maxStores;
      updateData.maxApiCallsPerMonth = limits.maxApiCallsPerMonth;
    }
    if (subscriptionStatus !== undefined)
      updateData.subscriptionStatus = subscriptionStatus;
    if (trialEndsAt !== undefined)
      updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
    if (maxUsers !== undefined) updateData.maxUsers = maxUsers;
    if (paymentMethodOnFile !== undefined)
      updateData.paymentMethodOnFile = paymentMethodOnFile;

    const tenant = await basePrisma.tenant.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Log plan change
    if (plan !== undefined) {
      await basePrisma.tenantAccessLog.create({
        data: {
          tenantId: tenant.id,
          action: 'PLAN_CHANGED',
          reason: `Plan changed to ${plan} by admin`,
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
