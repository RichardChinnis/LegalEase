require('dotenv').config({ path: '.env.email' });

module.exports = {
  // SMTP Configuration - Using Ubuntu's local postfix/sendmail
  smtp: {
    host: process.env.EMAIL_HOST || 'localhost',
    port: process.env.EMAIL_PORT || 25,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    // Local SMTP typically doesn't need authentication
    auth: process.env.EMAIL_USER && process.env.EMAIL_PASS ? {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    } : null
  },

  // Email Settings
  email: {
    from: process.env.EMAIL_FROM || 'congress-sync@localhost',
    to: process.env.EMAIL_TO || 'admin@localhost',
    subject: process.env.EMAIL_SUBJECT || 'Congress API Daily Sync Report'
  },

  // Report Settings
  report: {
    // Include detailed table statistics
    includeTableStats: process.env.INCLUDE_TABLE_STATS !== 'false',

    // Maximum number of errors to include in report
    maxErrors: parseInt(process.env.MAX_ERRORS) || 20,

    // Include backup information
    includeBackupInfo: process.env.INCLUDE_BACKUP_INFO !== 'false',

    // Include performance metrics
    includePerformanceMetrics: process.env.INCLUDE_PERFORMANCE_METRICS !== 'false'
  },

  // Paths and directories
  paths: {
    backupDir: process.env.BACKUP_DIR || '/storage/backups/congress-api',
    logDir: process.env.LOG_DIR || '/var/log',
    backupLogFile: process.env.BACKUP_LOG_FILE || '/var/log/congress-api-backup.log'
  },

  // Thresholds for alerts
  thresholds: {
    // Alert if backup is older than this many hours
    backupMaxAge: parseInt(process.env.BACKUP_MAX_AGE_HOURS) || 26,

    // Alert if sync hasn't run in this many hours
    syncMaxAge: parseInt(process.env.SYNC_MAX_AGE_HOURS) || 8,

    // Alert if error rate is above this percentage
    errorRateThreshold: parseInt(process.env.ERROR_RATE_THRESHOLD) || 10,

    // Alert if database connections exceed this number
    maxDbConnections: parseInt(process.env.MAX_DB_CONNECTIONS) || 50
  }
};