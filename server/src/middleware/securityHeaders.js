/**
 * Security headers middleware.
 *
 * Sets defensive HTTP headers on every response. Nginx does not set these
 * (checked /etc/nginx/sites-available/retailedgeai), so we add them here.
 */
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '0'); // Deprecated; modern browsers ignore it
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
