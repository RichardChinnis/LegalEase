require('dotenv').config();

console.log('Environment variable check:');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET');
console.log('OLLAMA_BASE_URL:', process.env.OLLAMA_BASE_URL ? 'SET' : 'NOT SET');