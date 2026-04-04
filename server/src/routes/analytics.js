/**
 * Sales Analytics Routes
 *
 * All endpoints require authentication + tenant scope.
 * Default date range: last 30 days if not provided.
 */

import { Router } from 'express';
import {
  getRevenueByPeriod,
  getRevenueComparison,
  getRevenueByChannel,
  getMarginByProduct,
  getLowMarginProducts,
  getTopProducts,
  getBottomProducts,
  getProductTrends,
  getDataQuality,
  getDataBeyondWindow,
  getAnalysisWindowStart,
} from '../services/analytics/salesAnalysis.js';

const router = Router();

// ── GET /revenue — Revenue by period ──

router.get('/revenue', async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const result = await getRevenueByPeriod(req.prisma, { period, startDate, endDate, tenantId: req.user.tenantId });
    res.json(result);
  } catch (err) {
    console.error('Analytics revenue error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /revenue/comparison — Period-over-period comparison ──

router.get('/revenue/comparison', async (req, res) => {
  try {
    const { currentStart, currentEnd, previousStart, previousEnd } = req.query;
    if (!currentStart || !currentEnd || !previousStart || !previousEnd) {
      return res.status(400).json({
        message: 'Required: currentStart, currentEnd, previousStart, previousEnd',
      });
    }
    const result = await getRevenueComparison(req.prisma, {
      currentStart, currentEnd, previousStart, previousEnd,
    });
    res.json(result);
  } catch (err) {
    console.error('Analytics revenue comparison error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /revenue/by-channel — Revenue split by sales channel ──

router.get('/revenue/by-channel', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await getRevenueByChannel(req.prisma, { startDate, endDate, tenantId: req.user.tenantId });
    res.json(result);
  } catch (err) {
    console.error('Analytics revenue by channel error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /margins — Margin analysis by product ──

router.get('/margins', async (req, res) => {
  try {
    const { startDate, endDate, limit, sortBy } = req.query;
    const result = await getMarginByProduct(req.prisma, {
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
      sortBy,
      tenantId: req.user.tenantId,
    });
    res.json(result);
  } catch (err) {
    console.error('Analytics margins error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /margins/low — Products below margin threshold ──

router.get('/margins/low', async (req, res) => {
  try {
    const { threshold, startDate, endDate } = req.query;
    const result = await getLowMarginProducts(req.prisma, {
      threshold: threshold ? parseFloat(threshold) : undefined,
      startDate,
      endDate,
      tenantId: req.user.tenantId,
    });
    res.json(result);
  } catch (err) {
    console.error('Analytics low margins error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /products/top — Best performing products ──

router.get('/products/top', async (req, res) => {
  try {
    const { metric, limit, startDate, endDate } = req.query;
    const result = await getTopProducts(req.prisma, {
      metric,
      limit: limit ? parseInt(limit) : undefined,
      startDate,
      endDate,
      tenantId: req.user.tenantId,
    });
    res.json(result);
  } catch (err) {
    console.error('Analytics top products error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /products/bottom — Worst performing products ──

router.get('/products/bottom', async (req, res) => {
  try {
    const { metric, limit, startDate, endDate } = req.query;
    const result = await getBottomProducts(req.prisma, {
      metric,
      limit: limit ? parseInt(limit) : undefined,
      startDate,
      endDate,
      tenantId: req.user.tenantId,
    });
    res.json(result);
  } catch (err) {
    console.error('Analytics bottom products error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /products/trends — Growing/declining products ──

router.get('/products/trends', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await getProductTrends(req.prisma, { startDate, endDate, tenantId: req.user.tenantId });
    res.json(result);
  } catch (err) {
    console.error('Analytics product trends error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /data-quality — Cost data coverage + analysis window info ──

router.get('/data-quality', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const tenantId = req.user.tenantId;
    const result = await getDataQuality(req.prisma, { startDate, endDate, tenantId });

    // Enrich with analysis window info
    const windowStart = await getAnalysisWindowStart(req.prisma, tenantId);
    const beyondWindow = await getDataBeyondWindow(req.prisma, tenantId);

    result.analysisWindow = {
      windowStart: windowStart || null,
      unlimited: !windowStart,
    };
    if (beyondWindow && beyondWindow.hasDataBeyondWindow) {
      result.dataBeyondWindow = {
        exists: true,
        totalDataMonths: beyondWindow.totalDataMonths,
        oldestDataDate: beyondWindow.oldestDataDate,
        transactionsOutsideWindow: beyondWindow.transactionsOutsideWindow,
        percentOutsideWindow: beyondWindow.percentOutsideWindow,
      };
    } else {
      result.dataBeyondWindow = { exists: false };
    }

    res.json(result);
  } catch (err) {
    console.error('Analytics data quality error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
