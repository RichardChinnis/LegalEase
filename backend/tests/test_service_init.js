require('dotenv').config();
const NodeCache = require('node-cache');
const { LLMProviders } = require('./services/llm-providers');
const { ContextAssembler } = require('./services/context-assembler');
const { ChatService } = require('./services/chat-service');
const { CongressAPIClient } = require('./services/congress-api');

// Test service initialization 
try {
  console.log('Testing service initialization...');
  
  // Create cache
  const cache = new NodeCache({ stdTTL: 3600, maxKeys: 1000, checkperiod: 120 });
  console.log('✓ Cache created');
  
  // Create Congress API client
  const congressAPIClient = new CongressAPIClient(cache);
  console.log('✓ Congress API client created');
  
  // Initialize LLM providers
  const llmProviders = new LLMProviders();
  console.log('✓ LLM providers initialized');
  
  // Initialize context assembler
  const contextAssembler = new ContextAssembler(congressAPIClient);
  console.log('✓ Context assembler initialized');
  
  // Initialize chat service
  const chatService = new ChatService(llmProviders, contextAssembler, cache);
  console.log('✓ Chat service initialized');
  
  console.log('All services initialized successfully!');
  
} catch (error) {
  console.error('❌ Service initialization failed:', error.message);
  console.error('Stack:', error.stack);
}