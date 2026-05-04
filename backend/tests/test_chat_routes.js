require('dotenv').config();
const NodeCache = require('node-cache');
const { CongressAPIClient } = require('./services/congress-api');
const { createChatRoutes } = require('./routes/chat');

// Test chat routes creation
try {
  console.log('Testing chat routes creation...');
  
  // Create cache
  const cache = new NodeCache({ stdTTL: 3600, maxKeys: 1000, checkperiod: 120 });
  console.log('✓ Cache created');
  
  // Create Congress API client
  const congressAPIClient = new CongressAPIClient(cache);
  console.log('✓ Congress API client created');
  
  // Try to create chat routes
  const chatRoutes = createChatRoutes(congressAPIClient, cache);
  console.log('✓ Chat routes created successfully');
  console.log('Chat routes type:', typeof chatRoutes);
  
} catch (error) {
  console.error('❌ Chat routes creation failed:', error.message);
  console.error('Stack:', error.stack);
}