// Centralized 404 and JSON error handler (never leaks stack traces or raw SQL).

export function notFoundHandler(req, res) {
  return res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'INVALID_JSON',
      message: 'Malformed JSON request body',
    });
  }

  if (err && err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: 'CONFLICT',
      message: 'Resource already exists',
    });
  }

  if (err && err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      error: err.code || 'BAD_REQUEST',
      message: err.message,
    });
  }

  console.error('[API Error]', err?.message || err);
  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  });
}
