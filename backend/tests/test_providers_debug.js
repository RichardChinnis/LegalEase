require('dotenv').config();
const { LLMProviders } = require('./services/llm-providers');

// Debug test of LLM providers
try {
  console.log('Testing LLM Providers...');
  const providers = new LLMProviders();
  console.log('✓ LLM Providers initialized');
  
  // Check actual provider objects
  console.log('Provider objects:');
  console.log('- OpenAI:', providers.providers.openai !== null ? 'INITIALIZED' : 'NULL');
  console.log('- Claude:', providers.providers.claude !== null ? 'INITIALIZED' : 'NULL');
  console.log('- Gemini:', providers.providers.gemini !== null ? 'INITIALIZED' : 'NULL');
  console.log('- Ollama:', providers.providers.ollama !== null ? 'INITIALIZED' : 'NULL');
  
  const availableProviders = providers.getAvailableProviders();
  console.log('✓ Available providers:', availableProviders);
  
  console.log('All tests passed!');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error('Stack:', error.stack);
}