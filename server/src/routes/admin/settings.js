import { Router } from 'express';
import { basePrisma } from '../../lib/prisma.js';

const router = Router();

// GET /api/admin/settings — Get platform settings (creates singleton if missing)
router.get('/', async (_req, res) => {
  try {
    const settings = await basePrisma.platformSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: {
        id: 'singleton',
        defaultTrialDays: 14,
        autoLockOnTrialExpiry: true,
        gracePeriodDays: 3,
      },
    });

    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/settings — Update platform settings
router.patch('/', async (req, res) => {
  try {
    const { defaultTrialDays, autoLockOnTrialExpiry, gracePeriodDays } =
      req.body;
    const updateData = {};

    if (defaultTrialDays !== undefined) {
      const days = parseInt(defaultTrialDays);
      if (isNaN(days) || days < 0 || days > 90) {
        return res
          .status(400)
          .json({ message: 'defaultTrialDays must be between 0 and 90' });
      }
      updateData.defaultTrialDays = days;
    }

    if (autoLockOnTrialExpiry !== undefined) {
      updateData.autoLockOnTrialExpiry = Boolean(autoLockOnTrialExpiry);
    }

    if (gracePeriodDays !== undefined) {
      const days = parseInt(gracePeriodDays);
      if (isNaN(days) || days < 0 || days > 30) {
        return res
          .status(400)
          .json({ message: 'gracePeriodDays must be between 0 and 30' });
      }
      updateData.gracePeriodDays = days;
    }

    const settings = await basePrisma.platformSettings.upsert({
      where: { id: 'singleton' },
      update: updateData,
      create: {
        id: 'singleton',
        ...updateData,
      },
    });

    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
