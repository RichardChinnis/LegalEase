const axios = require('axios');

// Simple test of message sending
async function testMessageSending() {
  try {
    const baseURL = 'http://localhost:3000';
    
    console.log('1. Getting a real bill...');
    const billsResponse = await axios.get(`${baseURL}/api/bill?limit=1`);
    const testBill = billsResponse.data.bills[0];
    console.log('✓ Using bill:', `${testBill.type.toUpperCase()} ${testBill.number}`);
    
    console.log('2. Creating conversation...');
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
    
    const conversationId = conversationResponse.data.conversationId;
    console.log('✓ Conversation created:', conversationId);
    
    console.log('3. Sending message...');
    const messageResponse = await axios.post(`${baseURL}/api/chat/conversations/${conversationId}/messages`, {
      message: 'What is the title of this bill?',
      maxTokens: 100,
      temperature: 0.7
    });
    
    console.log('✓ Message sent successfully!');
    console.log('Response:', {
      messageId: messageResponse.data.messageId,
      contentPreview: messageResponse.data.content.substring(0, 100) + '...',
      tokenCount: messageResponse.data.tokenCount
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testMessageSending();