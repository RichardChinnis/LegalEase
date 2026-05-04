const axios = require('axios');

// Test just the providers endpoint
async function testProvidersEndpoint() {
  try {
    console.log('Testing providers endpoint...');
    const response = await axios.get('http://localhost:3000/api/chat/providers');
    console.log('✓ Success:', response.data);
  } catch (error) {
    console.error('❌ Error details:');
    console.error('Status:', error.response?.status);
    console.error('Status text:', error.response?.statusText);
    console.error('Data:', error.response?.data);
    console.error('Headers:', error.response?.headers);
  }
}

testProvidersEndpoint();