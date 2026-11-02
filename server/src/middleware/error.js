export function notFound(req, res, _next) {
  res.status(404).json({
    error: `Not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    code: err.code || 'INTERNAL',
    details: err.details,
  });
}
