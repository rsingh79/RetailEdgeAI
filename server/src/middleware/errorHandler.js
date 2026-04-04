/**
 * Global error handler — must be mounted AFTER all routes in app.js.
 *
 * Catches unhandled errors, logs full details server-side, and returns
 * a standardised JSON response to the client. Never leaks stack traces,
 * internal paths, or database details in production.
 */
export function globalErrorHandler(err, req, res, _next) {
  // Log full error details server-side
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    error: err.message,
    stack: err.stack,
    tenantId: req.tenantId || 'none',
    userId: req.user?.id || 'none',
  });

  // Prisma unique constraint violation
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Duplicate entry',
      code: 'DUPLICATE_RESOURCE',
      message: 'A resource with these details already exists.',
    });
  }

  // Prisma record not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Not found',
      code: 'RESOURCE_NOT_FOUND',
      message: 'The requested resource was not found.',
    });
  }

  // Validation errors (from express-validator or custom)
  if (err.name === 'ValidationError' || err.status === 400) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      message: err.message || 'The request contains invalid data.',
      details: err.details || undefined,
    });
  }

  // Authentication errors
  if (err.status === 401 || err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorised',
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource.',
    });
  }

  // Forbidden
  if (err.status === 403) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'FORBIDDEN',
      message: err.message || 'You do not have permission to access this resource.',
    });
  }

  // AI provider errors
  if (err.isAiProviderError) {
    return res.status(503).json({
      error: 'AI service unavailable',
      code: 'AI_SERVICE_ERROR',
      message: 'The AI service is temporarily unavailable. Please try again in a moment.',
    });
  }

  // Shopify API errors
  if (err.isShopifyError) {
    return res.status(502).json({
      error: 'Shopify error',
      code: 'SHOPIFY_API_ERROR',
      message: 'There was an issue communicating with Shopify. Please try again.',
    });
  }

  // Default: internal server error
  // NEVER include err.message in production — could leak internals
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Something went wrong. Please try again or contact support.',
  });
}
