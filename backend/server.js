const { createApp } = require('./shared/app-factory');
const { logger } = require('./logger');
const config = require('./config');

// Create the Express app with all middleware and routes
const app = createApp();

// Start server with graceful shutdown
const server = app.listen(config.server.port, () => {
  logger.info(`Congress API proxy server running on port ${config.server.port}`, {
    port: config.server.port,
    environment: config.server.environment,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    if (app.database) await app.database.close().catch(err => logger.error('Error closing database', { error: err.message }));
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(async () => {
    if (app.database) await app.database.close().catch(err => logger.error('Error closing database', { error: err.message }));
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason, stack: reason?.stack });
  server.close(() => process.exit(1));
});

module.exports = { app, server };