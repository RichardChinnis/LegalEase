const { LLMProviders } = require('./services/llm-providers');

// Simple test of LLM providers
try {
  console.log('Testing LLM Providers...');
  const providers = new LLMProviders();
  console.log('✓ LLM Providers initialized');
  
  const availableProviders = providers.getAvailableProviders();
  console.log('✓ Available providers:', availableProviders);
  
  console.log('All tests passed!');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error('Stack:', error.stack);
}