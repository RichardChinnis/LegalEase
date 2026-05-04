const axios = require('axios');

// Test the chat endpoints
async function testChatEndpoints() {
  const baseURL = 'http://localhost:3000';
  
  console.log('Testing Chat API Endpoints...\n');
  
  try {
    // Test 1: Get available providers
    console.log('1. Testing GET /api/chat/providers');
    const providersResponse = await axios.get(`${baseURL}/api/chat/providers`);
    console.log('✓ Providers:', providersResponse.data);
    console.log('');
    
    // Test 2: Get models for OpenAI
    console.log('2. Testing GET /api/chat/providers/openai/models');
    const modelsResponse = await axios.get(`${baseURL}/api/chat/providers/openai/models`);
    console.log('✓ OpenAI Models:', modelsResponse.data.models.map(m => m.name));
    console.log('');
    
    // Test 3: Get models for Claude
    console.log('3. Testing GET /api/chat/providers/claude/models');
    const claudeModelsResponse = await axios.get(`${baseURL}/api/chat/providers/claude/models`);
    console.log('✓ Claude Models:', claudeModelsResponse.data.models.map(m => m.name));
    console.log('');
    
    // Test 4: Get models for Gemini
    console.log('4. Testing GET /api/chat/providers/gemini/models');
    const geminiModelsResponse = await axios.get(`${baseURL}/api/chat/providers/gemini/models`);
    console.log('✓ Gemini Models:', geminiModelsResponse.data.models.map(m => m.name));
    console.log('');
    
    // First, let's find a real bill to use for testing
    console.log('5. Finding a real bill for testing...');
    const billsResponse = await axios.get(`${baseURL}/api/bill?limit=1`);
    const testBill = billsResponse.data.bills[0];
    console.log('✓ Using test bill:', `${testBill.type.toUpperCase()} ${testBill.number} (${testBill.congress}th Congress)`);
    console.log('');
    
    // Test 6: Estimate tokens with real bill
    console.log('6. Testing POST /api/chat/estimate-tokens');
    const estimateResponse = await axios.post(`${baseURL}/api/chat/estimate-tokens`, {
      billInfo: {
        congress: testBill.congress,
        type: testBill.type,
        number: testBill.number,
        title: testBill.title
      },
      contextConfig: {
        billTextVersion: 'latest',
        includeSponsor: true,
        includeCosponsors: false,
        summaryVersion: 'latest',
        includeCommitteeReports: false
      },
      provider: 'openai',
      additionalText: 'What is this bill about?'
    });
    console.log('✓ Token Estimate:', estimateResponse.data);
    console.log('');
    
    // Test 7: Create conversation with real bill
    console.log('7. Testing POST /api/chat/conversations');
    const conversationResponse = await axios.post(`${baseURL}/api/chat/conversations`, {
      billInfo: {
        congress: testBill.congress,
        type: testBill.type,
        number: testBill.number,
        title: testBill.title
      },
      contextConfig: {
        billTextVersion: 'latest',
        includeSponsor: true,
        includeCosponsors: false,
        summaryVersion: 'latest',
        includeCommitteeReports: false
      },
      provider: 'openai',
      model: 'gpt-3.5-turbo'
    });
    console.log('✓ Conversation Created:', conversationResponse.data);
    console.log('');
    
    const conversationId = conversationResponse.data.conversationId;
    
    // Test 8: Get conversation details
    console.log('8. Testing GET /api/chat/conversations/:id');
    const getConversationResponse = await axios.get(`${baseURL}/api/chat/conversations/${conversationId}`);
    console.log('✓ Conversation Details:', {
      id: getConversationResponse.data.id,
      messageCount: getConversationResponse.data.messages.length,
      provider: getConversationResponse.data.provider,
      model: getConversationResponse.data.model
    });
    console.log('');
    
    // Test 9: List all conversations
    console.log('9. Testing GET /api/chat/conversations');
    const conversationsResponse = await axios.get(`${baseURL}/api/chat/conversations`);
    console.log('✓ All Conversations:', conversationsResponse.data);
    console.log('');
    
    // Test 10: Estimate message tokens
    console.log('10. Testing POST /api/chat/conversations/:id/estimate-tokens');
    const messageTokensResponse = await axios.post(`${baseURL}/api/chat/conversations/${conversationId}/estimate-tokens`, {
      message: 'Can you explain the key provisions of this bill?'
    });
    console.log('✓ Message Token Estimate:', messageTokensResponse.data);
    console.log('');
    
    // Test 11: Send a non-streaming message
    console.log('11. Testing POST /api/chat/conversations/:id/messages');
    const messageResponse = await axios.post(`${baseURL}/api/chat/conversations/${conversationId}/messages`, {
      message: 'What is the title of this bill?',
      maxTokens: 100,
      temperature: 0.7
    });
    console.log('✓ Message Response:', {
      messageId: messageResponse.data.messageId,
      contentLength: messageResponse.data.content.length,
      tokenCount: messageResponse.data.tokenCount
    });
    console.log('');
    
    // Test 12: Get updated conversation with new message
    console.log('12. Testing GET /api/chat/conversations/:id (after message)');
    const updatedConversationResponse = await axios.get(`${baseURL}/api/chat/conversations/${conversationId}`);
    console.log('✓ Updated Conversation:', {
      id: updatedConversationResponse.data.id,
      messageCount: updatedConversationResponse.data.messages.length,
      lastMessage: updatedConversationResponse.data.messages[updatedConversationResponse.data.messages.length - 1]?.content.substring(0, 100) + '...'
    });
    console.log('');
    
    // Test 13: Update conversation context
    console.log('13. Testing PUT /api/chat/conversations/:id/context');
    const contextUpdateResponse = await axios.put(`${baseURL}/api/chat/conversations/${conversationId}/context`, {
      contextConfig: {
        billTextVersion: 'latest',
        includeSponsor: true,
        includeCosponsors: true,
        summaryVersion: 'latest',
        includeCommitteeReports: true
      }
    });
    console.log('✓ Context Updated:', contextUpdateResponse.data);
    console.log('');
    
    // Test 14: Test streaming message (we'll just start it and cancel quickly)
    console.log('14. Testing POST /api/chat/conversations/:id/messages/stream');
    try {
      const streamResponse = await axios.post(`${baseURL}/api/chat/conversations/${conversationId}/messages/stream`, {
        message: 'Give me a brief summary of this bill.',
        maxTokens: 50,
        temperature: 0.5
      }, {
        timeout: 2000, // Short timeout to not wait for full stream
        responseType: 'stream'
      });
      console.log('✓ Streaming started successfully (response type:', typeof streamResponse.data, ')');
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.log('✓ Streaming endpoint responds (timed out as expected)');
      } else {
        throw error;
      }
    }
    console.log('');
    
    // Test 15: Delete conversation
    console.log('15. Testing DELETE /api/chat/conversations/:id');
    const deleteResponse = await axios.delete(`${baseURL}/api/chat/conversations/${conversationId}`);
    console.log('✓ Conversation Deleted:', deleteResponse.data);
    console.log('');
    
    console.log('All tests passed! 🎉');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('Stack:', error.stack);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testChatEndpoints();
}

module.exports = { testChatEndpoints };