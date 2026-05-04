const { logger } = require('../logger');
const { AppError } = require('./errors');

// Error handler middleware
function errorHandler(err, req, res, next) {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Log the error
  logger.error(err.message, {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      statusCode: err.statusCode,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    },
  });

  const isOperational = err instanceof AppError;

  const statusCode = isOperational ? err.statusCode : 500;
  const message = isOperational ? err.message : 'An unexpected error occurred. Please try again later.';

  // In development, send the full error
  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({
      error: {
        message: err.message,
        type: err.name,
        statusCode: statusCode,
        stack: err.stack,
      },
    });
  }

  // In production, send a generic response for non-operational errors
  return res.status(statusCode).json({
    error: {
      message: message,
      type: isOperational ? err.name : 'InternalServerError',
      statusCode: statusCode,
    },
  });
}

// Async error wrapper - catches async errors and passes to Express error handler
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  asyncHandler,
};