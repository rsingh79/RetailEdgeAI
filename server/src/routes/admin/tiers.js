import { Router } from 'express';
import { basePrisma } from '../../lib/prisma.js';

const router = Router();

// ── Feature CRUD ─────────────────────────────────────────────────────

// GET /api/admin/tiers/features — List all features
router.get('/features', async (req, res) => {
  try {
    const features = await basePrisma.feature.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { tiers: true } },
      },
    });
    res.json(features);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/tiers/features — Create a new feature
router.post('/features', async (req, res) => {
  try {
    const { key, name, description, icon, category, sortOrder, isCore } = req.body;

    if (!key || !name) {
      return res.status(400).json({ message: 'key and name are required' });
    }

    // Ensure key is a valid slug
    const slug = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const feature = await basePrisma.feature.create({
      data: {
        key: slug,
        name,
        description: description || null,
        icon: icon || null,
        category: category || 'general',
        sortOrder: sortOrder || 0,
        isCore: isCore || false,
      },
    });

    // If core feature, auto-add to all active tiers
    if (feature.isCore) {
      const tiers = await basePrisma.planTier.findMany({ where: { isActive: true } });
      for (const tier of tiers) {
        await basePrisma.planTierFeature.upsert({
          where: { planTierId_featureId: { planTierId: tier.id, featureId: feature.id } },
          create: { planTierId: tier.id, featureId: feature.id },
          update: {},
        });
      }
    }

    res.status(201).json(feature);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'A feature with this key already exists' });
    }
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/tiers/features/:id — Update a feature
router.patch('/features/:id', async (req, res) => {
  try {
    const { name, description, icon, category, sortOrder, isActive, isCore } = req.body;
    const data = {};

    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (category !== undefined) data.category = category;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive !== undefined) data.isActive = isActive;
    if (isCore !== undefined) data.isCore = isCore;

    const feature = await basePrisma.feature.update({
      where: { id: req.params.id },
      data,
    });

    // If just became core, auto-add to all active tiers
    if (isCore === true) {
      const tiers = await basePrisma.planTier.findMany({ where: { isActive: true } });
      for (const tier of tiers) {
        await basePrisma.planTierFeature.upsert({
          where: { planTierId_featureId: { planTierId: tier.id, featureId: feature.id } },
          create: { planTierId: tier.id, featureId: feature.id },
          update: {},
        });
      }
    }

    res.json(feature);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Feature not found' });
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/tiers/features/:id — Delete a feature (only if not in any tier)
router.delete('/features/:id', async (req, res) => {
  try {
    // Check if used in any tier
    const usageCount = await basePrisma.planTierFeature.count({
      where: { featureId: req.params.id },
    });

    if (usageCount > 0) {
      return res.status(400).json({
        message: `Cannot delete: feature is used in ${usageCount} tier(s). Remove it from all tiers first.`,
      });
    }

    await basePrisma.feature.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Feature not found' });
    res.status(500).json({ message: err.message });
  }
});

// ── Tier CRUD ────────────────────────────────────────────────────────

// GET /api/admin/tiers — List all tiers with features, limits, and tenant count
router.get('/', async (req, res) => {
  try {
    const tiers = await basePrisma.planTier.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        features: {
          include: {
            feature: { select: { id: true, key: true, name: true, icon: true, category: true, isCore: true } },
          },
        },
        limits: { orderBy: { limitKey: 'asc' } },
        _count: { select: { tenants: true } },
      },
    });
    res.json(tiers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/tiers/:id — Tier detail
router.get('/:id', async (req, res) => {
  try {
    const tier = await basePrisma.planTier.findUnique({
      where: { id: req.params.id },
      include: {
        features: {
          include: {
            feature: { select: { id: true, key: true, name: true, icon: true, category: true, isCore: true } },
          },
        },
        limits: { orderBy: { limitKey: 'asc' } },
        _count: { select: { tenants: true } },
      },
    });

    if (!tier) return res.status(404).json({ message: 'Tier not found' });
    res.json(tier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/tiers — Create a new tier with features + limits
router.post('/', async (req, res) => {
  try {
    const { name, slug, description, monthlyPrice, annualPrice, sortOrder, isDefault, featureIds, limits } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'name is required' });
    }

    const tierSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-')).trim();

    // Get all core features to auto-include
    const coreFeatures = await basePrisma.feature.findMany({
      where: { isCore: true },
      select: { id: true },
    });
    const coreIds = coreFeatures.map((f) => f.id);

    // Merge provided featureIds with core IDs (deduplicated)
    const allFeatureIds = [...new Set([...coreIds, ...(featureIds || [])])];

    const tier = await basePrisma.$transaction(async (tx) => {
      // If this is the new default, unset others
      if (isDefault) {
        await tx.planTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const tier = await tx.planTier.create({
        data: {
          name,
          slug: tierSlug,
          description: description || null,
          monthlyPrice: monthlyPrice || 0,
          annualPrice: annualPrice || 0,
          sortOrder: sortOrder || 0,
          isDefault: isDefault || false,
        },
      });

      // Create feature associations
      for (const featureId of allFeatureIds) {
        await tx.planTierFeature.create({
          data: { planTierId: tier.id, featureId },
        });
      }

      // Create limits
      if (limits && Array.isArray(limits)) {
        for (const l of limits) {
          await tx.planTierLimit.create({
            data: {
              planTierId: tier.id,
              limitKey: l.limitKey,
              limitValue: l.limitValue,
              description: l.description || null,
            },
          });
        }
      }

      return tier;
    });

    // Fetch the full tier with includes
    const fullTier = await basePrisma.planTier.findUnique({
      where: { id: tier.id },
      include: {
        features: {
          include: {
            feature: { select: { id: true, key: true, name: true, icon: true, category: true, isCore: true } },
          },
        },
        limits: { orderBy: { limitKey: 'asc' } },
        _count: { select: { tenants: true } },
      },
    });

    res.status(201).json(fullTier);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'A tier with this slug already exists' });
    }
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/tiers/:id — Update tier (delete-and-recreate features/limits)
router.patch('/:id', async (req, res) => {
  try {
    const { name, description, monthlyPrice, annualPrice, sortOrder, isActive, isDefault, featureIds, limits } = req.body;

    const existing = await basePrisma.planTier.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Tier not found' });

    await basePrisma.$transaction(async (tx) => {
      // If setting as default, unset others
      if (isDefault) {
        await tx.planTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      // Update tier fields
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (monthlyPrice !== undefined) updateData.monthlyPrice = monthlyPrice;
      if (annualPrice !== undefined) updateData.annualPrice = annualPrice;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isDefault !== undefined) updateData.isDefault = isDefault;

      await tx.planTier.update({
        where: { id: req.params.id },
        data: updateData,
      });

      // Replace features if provided
      if (featureIds !== undefined) {
        // Get core features to enforce inclusion
        const coreFeatures = await tx.feature.findMany({
          where: { isCore: true },
          select: { id: true },
        });
        const coreIds = coreFeatures.map((f) => f.id);
        const allFeatureIds = [...new Set([...coreIds, ...featureIds])];

        await tx.planTierFeature.deleteMany({ where: { planTierId: req.params.id } });
        for (const featureId of allFeatureIds) {
          await tx.planTierFeature.create({
            data: { planTierId: req.params.id, featureId },
          });
        }
      }

      // Replace limits if provided
      if (limits !== undefined) {
        await tx.planTierLimit.deleteMany({ where: { planTierId: req.params.id } });
        for (const l of limits) {
          await tx.planTierLimit.create({
            data: {
              planTierId: req.params.id,
              limitKey: l.limitKey,
              limitValue: l.limitValue,
              description: l.description || null,
            },
          });
        }
      }
    });

    // Fetch updated tier
    const tier = await basePrisma.planTier.findUnique({
      where: { id: req.params.id },
      include: {
        features: {
          include: {
            feature: { select: { id: true, key: true, name: true, icon: true, category: true, isCore: true } },
          },
        },
        limits: { orderBy: { limitKey: 'asc' } },
        _count: { select: { tenants: true } },
      },
    });

    res.json(tier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/admin/tiers/:id — Delete tier (refuse if tenants assigned)
router.delete('/:id', async (req, res) => {
  try {
    const tier = await basePrisma.planTier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { tenants: true } } },
    });

    if (!tier) return res.status(404).json({ message: 'Tier not found' });

    if (tier._count.tenants > 0) {
      return res.status(400).json({
        message: `Cannot delete: ${tier._count.tenants} tenant(s) are assigned to this tier. Reassign them first.`,
      });
    }

    // Delete cascade takes care of features and limits
    await basePrisma.planTier.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Tier not found' });
    res.status(500).json({ message: err.message });
  }
});

export default router;
