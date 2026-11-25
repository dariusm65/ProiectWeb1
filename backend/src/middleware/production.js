// Production hardening helpers (D-021): trust proxy parsing, Helmet CSP/HSTS options,
// HTTPS redirect behind a TLS-terminating proxy (Render), and SPA static serving with fallback.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * Parses TRUST_PROXY into an Express `trust proxy` value.
 * '' / undefined / 'false' -> false; 'true' -> true; '1' -> 1 (hop count); otherwise the raw
 * string (e.g. 'loopback' or a CIDR list) is passed through.
 */
export function parseTrustProxy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  if (typeof value === 'number') return value;
  const v = String(value).trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return String(value).trim();
}

export function parseBooleanEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Helmet options: strict default CSP extended only for what the SPA and Swagger UI need.
 * - img-src: OpenStreetMap tiles for Leaflet maps + data: URIs (Swagger UI icons).
 * - style-src/font-src: Google Fonts used by index.html; 'unsafe-inline' styles for React
 *   style props, Leaflet and Swagger UI's inline <style> (scripts stay 'self'-only).
 * - upgrade-insecure-requests + HSTS only when HTTPS is enforced, so plain-HTTP local
 *   `docker compose up` keeps working.
 */
export function buildHelmetOptions({ forceHttps = false } = {}) {
  return {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'upgrade-insecure-requests': forceHttps ? [] : null,
      },
    },
    strictTransportSecurity: forceHttps
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
  };
}

const SAFE_HOST_HEADER_REGEX = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/;

/**
 * Redirects plain-HTTP requests to HTTPS (308 keeps method + body). Relies on `trust proxy`
 * so `req.secure` reflects X-Forwarded-Proto. `/api/health` is exempt for platform probes.
 * Validates the `Host` header format and normalizes leading slashes on `req.originalUrl`
 * to prevent Host-header / protocol-relative open-redirect injection.
 */
export function httpsRedirect() {
  return (req, res, next) => {
    if (req.secure || req.path === '/api/health') return next();
    const host = String(req.get('host') || '').trim();
    if (!host || !SAFE_HOST_HEADER_REGEX.test(host)) {
      return res.status(400).json({
        error: 'INVALID_HOST_HEADER',
        message: 'Invalid Host header',
      });
    }
    const safePath = String(req.originalUrl || '/').replace(/^\/+/, '/');
    return res.redirect(308, `https://${host}${safePath.startsWith('/') ? safePath : `/${safePath}`}`);
  };
}

/**
 * Serves the built Vite SPA from `distDir` and falls back to index.html for client-side
 * routes. `/api/*` is never handled here, so unknown API paths still reach the JSON 404.
 * Returns false (and mounts nothing) when the directory has no index.html.
 */
export function mountFrontend(app, distDir) {
  if (!distDir) return false;
  const root = path.resolve(distDir);
  const indexHtml = path.join(root, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.warn(`[Startup Warning] FRONTEND_DIST_DIR has no index.html (${root}) — SPA not served.`);
    return false;
  }

  const isApiPath = (p) => p === '/api' || p.startsWith('/api/');

  // Hashed Vite assets are immutable; index.html must always be revalidated.
  const assets = express.static(root, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.use((req, res, next) => (isApiPath(req.path) ? next() : assets(req, res, next)));

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexHtml);
  });
  return true;
}
