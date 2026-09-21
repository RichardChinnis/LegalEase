const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Log directory. LOG_DIR redirects every transport below; with it unset this
// resolves to __dirname/logs exactly as before, so production is unaffected.
// Relative values resolve against this directory, so the value reads the same
// wherever it is set. Created up front because winston's File transports open
// their file as soon as they are constructed, not on first write.
const logsDir = path.resolve(__dirname, process.env.LOG_DIR || 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`),
);

// Rotation bounds, overridable per environment. winston compares
// `size >= maxsize` numerically, so these must be plain byte counts: a
// human-readable string such as '20m' coerces to NaN and silently disables
// rotation -- and parsing it leniently is worse still, since parseInt('20m')
// is 20 and would cap the file at 20 bytes, rotating on every line. Anything
// that is not a plain positive integer is rejected out loud.
// `tailable` keeps the live file at its original name (combined.log) and rolls
// history into combined1.log, combined2.log, ... so anything tailing or
// grepping a fixed path keeps working.
const DEFAULT_MAX_SIZE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
// chat/exception/rejection logs are orders of magnitude smaller than the
// request logs, so they get a tighter budget to keep the service ceiling down.
const DEFAULT_AUX_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_AUX_MAX_FILES = 3;

const positiveInt = (value, fallback, label) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(value).trim() !== String(parsed)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[logger] ${label} must be a positive integer, got ${JSON.stringify(value)}; ` +
      `falling back to ${fallback}. Log rotation would otherwise be misconfigured.`
    );
    return fallback;
  }
  return parsed;
};

const rotation = {
  maxsize: positiveInt(process.env.LOG_MAX_SIZE_BYTES, DEFAULT_MAX_SIZE_BYTES, 'LOG_MAX_SIZE_BYTES'),
  maxFiles: positiveInt(process.env.LOG_MAX_FILES, DEFAULT_MAX_FILES, 'LOG_MAX_FILES'),
  tailable: true,
};

const auxRotation = {
  maxsize: positiveInt(process.env.LOG_AUX_MAX_SIZE_BYTES, DEFAULT_AUX_MAX_SIZE_BYTES, 'LOG_AUX_MAX_SIZE_BYTES'),
  maxFiles: positiveInt(process.env.LOG_AUX_MAX_FILES, DEFAULT_AUX_MAX_FILES, 'LOG_AUX_MAX_FILES'),
  tailable: true,
};

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: format,
  }),
  // File transport for errors
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    ...rotation,
  }),
  // File transport for all logs
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    ...rotation,
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports,
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      ...auxRotation,
    }),
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      ...auxRotation,
    }),
  ],
});

// Create a dedicated chat logger
const chatLogger = winston.createLogger({
    level: 'info',
    levels,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'chat.log'),
            ...auxRotation,
        }),
        new winston.transports.Console({
            format: format,
        })
    ]
});

// HTTP request logging middleware
const httpLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.http(`${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    
    logger.http(`${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: duration,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
    
    originalEnd.apply(this, args);
  };

  next();
};

module.exports = { logger, chatLogger, httpLogger };