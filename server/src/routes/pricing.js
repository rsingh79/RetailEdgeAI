import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// Auth + tenantScope already applied in app.js — req.prisma is tenant-scoped

// List all pricing rules for the tenant
router.get('/', async (req, res) => {
  try {
    const rules = await req.prisma.pricingRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create a new pricing rule
router.post('/', requireRole('OWNER', 'OPS_MANAGER'), async (req, res) => {
  try {
    const { name, scope, scopeValue, targetMargin, minMargin, maxPriceJump, roundingStrategy, priority } = req.body;
    const rule = await req.prisma.pricingRule.create({
      data: { name, scope, scopeValue, targetMargin, minMargin, maxPriceJump, roundingStrategy, priority },
    });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update a pricing rule
router.put('/:id', requireRole('OWNER', 'OPS_MANAGER'), async (req, res) => {
  try {
    const { name, scope, scopeValue, targetMargin, minMargin, maxPriceJump, roundingStrategy, priority, isActive } = req.body;
    const rule = await req.prisma.pricingRule.updateMany({
      where: { id: req.params.id },
      data: { name, scope, scopeValue, targetMargin, minMargin, maxPriceJump, roundingStrategy, priority, isActive },
    });
    if (rule.count === 0) return res.status(404).json({ message: 'Pricing rule not found' });
    res.json({ message: 'Pricing rule updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
