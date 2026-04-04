/**
 * Structured request logging middleware.
 *
 * Logs slow requests (>5 s) as warnings and 5xx errors to stderr.
 * Successful requests are only logged when LOG_ALL_REQUESTS=true
 * to avoid noise in production.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logEntry = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      tenantId: req.tenantId || '-',
      ip: req.ip,
    };

    if (duration > 5000) {
      console.warn('SLOW REQUEST:', logEntry);
    } else if (res.statusCode >= 500) {
      console.error('ERROR:', logEntry);
    } else if (res.statusCode >= 400) {
      console.warn('CLIENT ERROR:', logEntry);
    } else if (process.env.LOG_ALL_REQUESTS === 'true') {
      console.log('REQUEST:', logEntry);
    }
  });

  next();
}
