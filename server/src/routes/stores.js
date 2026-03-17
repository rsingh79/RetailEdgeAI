import { Router } from 'express';

const router = Router();

// List active stores for the tenant
router.get('/', async (req, res) => {
  try {
    const stores = await req.prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
