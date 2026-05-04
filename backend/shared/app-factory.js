const express = require('express');
const path = require('path');
const NodeCache = require('node-cache');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('../swagger');
const { applyMiddleware } = require('../middleware');
const { CongressAPIClient } = require('../services/congress-api');
const { DatabaseService, ConversationRepository } = require('../services/database.js');
const { createHealthRoutes } = require('../routes/health');
const { createAPIRoutes } = require('../routes/api');
const { createChatRoutes } = require('../routes/chat');
const authRoutes = require('../routes/auth'); // Import the new auth routes
const { errorHandler } = require('../utils/error-handler');
const config = require('../config');

function createApp(options = {}) {
  const app = express();
  
  // Middleware for parsing JSON bodies with an increased limit for large payloads
  app.use(express.json({ limit: '50mb' }));

  // Configure trust proxy for accurate client IP detection behind reverse proxy
  // Only trust the first proxy (Apache) instead of all proxies
  app.set('trust proxy', 1);

  // Validate environment variables
  config.validateEnvironment();

  // Cache setup
  const cache = new NodeCache({
    stdTTL: config.cache.stdTTL,
    maxKeys: config.cache.maxKeys,
    checkperiod: config.cache.checkperiod
  });

  // Create database service and conversation repository
  const databaseService = new DatabaseService(config.database);
  const conversationRepository = new ConversationRepository(databaseService);

  // Create Congress API client
  const congressAPIClient = new CongressAPIClient(cache);

  // Apply common middleware
  applyMiddleware(app, options);

  // API Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Congress API Proxy Documentation'
  }));

  // Health check routes
  app.use('/', createHealthRoutes(cache));

  // Auth routes
  app.use('/api/auth', authRoutes);

  // Chat routes (must be before general API routes)
  const chatRoutes = createChatRoutes(congressAPIClient, cache, conversationRepository);
  app.use('/api/chat', chatRoutes);

  // API routes
  app.use('/api', createAPIRoutes(congressAPIClient, databaseService));

  // Serve original frontend static files (for testing search component changes)
  const frontendPath = path.join(__dirname, '../../frontend');
  app.use('/frontend', express.static(frontendPath));
  
  // Serve frontend-v2 static files
  const frontendV2Path = path.join(__dirname, '../../frontend-v2');
  app.use('/v2', express.static(frontendV2Path));
  
  // Serve original frontend as the default frontend at root (temporarily for testing)
  app.use('/', express.static(frontendPath));
  
  // Handle client-side routing - serve index.html for non-API routes
  app.use((req, res, next) => {
    // Skip if it's an API route, api-docs, or static asset
    if (req.path.startsWith('/api') || req.path.startsWith('/api-docs') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // Error handling middleware (must be last)
  app.use(errorHandler);
  
  // Store references for testing and server access
  app.cache = cache;
  app.congressAPIClient = congressAPIClient;
  app.chatRoutes = chatRoutes;
  app.database = databaseService;
  app.conversationRepository = conversationRepository;

  return app;
}

module.exports = { createApp };