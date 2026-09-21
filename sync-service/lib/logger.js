const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Log directory. LOG_DIR overrides config.logging.dir, matching the
// env-over-config precedence used for the rotation bounds below so the whole
// logging block follows one rule rather than two. Both resolve against the
// service root, so a relative value reads the same wherever it is set, and an
// unset LOG_DIR reproduces the previous path exactly.
const logDir = path.resolve(__dirname, '..', process.env.LOG_DIR || config.logging.dir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Rotation bounds. Sizing lives in config.logging alongside the rest of the
// service's tunables; LOG_MAX_SIZE_BYTES / LOG_MAX_FILES override it per
// environment. Both are validated rather than trusted: winston compares
// `size >= maxsize` numerically, so a human-readable string such as '20m'
// coerces to NaN and silently disables rotation -- and parsing it leniently is
// worse still, since parseInt('20m') is 20 and would cap the file at 20 bytes.
// Anything that is not a plain positive integer is rejected out loud.
// `tailable` keeps the live file at its original name (sync.log) and rolls
// history into sync1.log, sync2.log, ... so anything tailing or grepping a
// fixed path keeps working.
const DEFAULT_MAX_SIZE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

const fromEnvOrConfig = (envValue, configValue) =>
  envValue === undefined || envValue === '' ? configValue : envValue;

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
  maxsize: positiveInt(
    fromEnvOrConfig(process.env.LOG_MAX_SIZE_BYTES, config.logging.maxSize),
    DEFAULT_MAX_SIZE_BYTES,
    'log max size in bytes (config.logging.maxSize / LOG_MAX_SIZE_BYTES)'
  ),
  maxFiles: positiveInt(
    fromEnvOrConfig(process.env.LOG_MAX_FILES, config.logging.maxFiles),
    DEFAULT_MAX_FILES,
    'log max files (config.logging.maxFiles / LOG_MAX_FILES)'
  ),
  tailable: true
};

// Create winston logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'congress-sync' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      ...rotation
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      ...rotation
    }),
    // Sync-specific logs
    new winston.transports.File({
      filename: path.join(logDir, 'sync.log'),
      ...rotation
    })
  ]
});

// Console output for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

module.exports = logger;