const request = require('supertest');
const { createApp } = require('../shared/app-factory');
const { LLMProviders } = require('../services/llm-providers');

// Mock the LLMProviders class
jest.mock('../services/llm-providers');

describe('Chat API Endpoints', () => {
    let app;

    beforeAll(() => {
        // Mock the methods of LLMProviders before the app is created
        LLMProviders.prototype.getAvailableProviders = jest.fn().mockReturnValue(['openai', 'claude', 'gemini']);
        LLMProviders.prototype.getAvailableModels = jest.fn().mockResolvedValue(
            [{ id: 'gpt-4', name: 'GPT-4' }]
        );

        // Mock the chatCompletion to return a stream
        LLMProviders.prototype.chatCompletion = jest.fn();

        app = createApp();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/chat/providers', () => {
        it('should return a list of available providers', async () => {
            const res = await request(app).get('/api/chat/providers');
            expect(res.statusCode).toEqual(200);
            expect(res.body.providers).toBeInstanceOf(Array);
            expect(res.body.providers).toContain('openai');
        });
    });

    describe('GET /api/chat/providers/:provider/models', () => {
        it('should return a list of models for a valid provider', async () => {
            const res = await request(app).get('/api/chat/providers/openai/models');
            expect(res.statusCode).toEqual(200);
            expect(res.body.models).toBeInstanceOf(Array);
            expect(res.body.models[0]).toHaveProperty('id');
        });
    });

    describe('Conversation Management', () => {
        let conversationId;

        it('should create a new conversation', async () => {
            const res = await request(app)
                .post('/api/chat/conversations')
                .send({
                    billInfo: { type: 'hr', number: '1', congress: '118' },
                    contextConfig: { includeSponsor: true },
                    provider: 'openai',
                    model: 'gpt-4'
                });
            
            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('conversationId');
            conversationId = res.body.conversationId;
        });

        it('should get an existing conversation', async () => {
            // First create a conversation to ensure one exists
            const createRes = await request(app)
                .post('/api/chat/conversations')
                .send({
                    billInfo: { type: 'hr', number: '1', congress: '118' },
                    contextConfig: { includeSponsor: true },
                    provider: 'openai',
                    model: 'gpt-4'
                });
            const newConversationId = createRes.body.conversationId;

            const res = await request(app).get(`/api/chat/conversations/${newConversationId}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body.id).toEqual(newConversationId);
        });
    });

    describe('POST /api/chat/conversations/:conversationId/messages/stream', () => {
        it('should return a valid SSE stream', async () => {
            // 1. Mock the stream generator to mimic the OpenAI structure
            async function* mockStream() {
                yield { choices: [{ delta: { content: 'Hello' } }] };
                yield { choices: [{ delta: { content: ' World' } }] };
            }
            LLMProviders.prototype.chatCompletion.mockResolvedValue(mockStream());

            // 2. Create a conversation
            const convRes = await request(app)
                .post('/api/chat/conversations')
                .send({
                    billInfo: { type: 'hr', number: '1', congress: '118' },
                    contextConfig: { includeSponsor: true },
                    provider: 'openai',
                    model: 'gpt-4'
                });
            const conversationId = convRes.body.conversationId;

            // 3. Make the streaming request
            const res = await request(app)
                .post(`/api/chat/conversations/${conversationId}/messages/stream`)
                .send({ message: 'Test' });

            // 4. Assert the response
            expect(res.statusCode).toEqual(200);
            expect(res.headers['content-type']).toEqual('text/event-stream');

            // 5. Check the content of the stream
            expect(res.text).toContain('data: {"type":"start"');
            expect(res.text).toContain('data: {"type":"content","content":"Hello"');
            expect(res.text).toContain('data: {"type":"content","content":" World"');
            expect(res.text).toContain('data: {"type":"done"');
        });
    });
});
