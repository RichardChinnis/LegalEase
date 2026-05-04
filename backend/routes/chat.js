const express = require('express');
const { asyncHandler } = require('../utils/error-handler');
const { LLMProviders } = require('../services/llm-providers');
const { ContextAssembler } = require('../services/context-assembler');
const { ChatService } = require('../services/chat-service');
const { createMiddlewareChain } = require('../middleware');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const { UsageTracker } = require('../services/usage-tracker');

// Enhanced cost calculation helper function
function calculateDetailedCostBreakdown(inputTokens, modelConfig, options = {}) {
  const {
    expectedOutputTokens = 150,
    expectedTurns = 1,
    monthlyUsage = 0
  } = options;

  const pricing = modelConfig.costPer1kTokens;
  if (!pricing) {
    return null;
  }

  // Apply output multiplier for o1 models
  const outputMultiplier = modelConfig.outputMultiplier || 1.0;
  const actualOutputTokens = expectedOutputTokens * outputMultiplier;

  // Calculate base costs
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (actualOutputTokens / 1000) * pricing.output;
  const subtotal = inputCost + outputCost;

  // Calculate usage discount
  let discount = 0;
  if (monthlyUsage > 1000) discount = 0.10; // 10% for high usage
  else if (monthlyUsage > 500) discount = 0.05; // 5% for medium usage

  const totalCost = subtotal * (1 - discount);

  // Multi-turn conversation estimate
  const conversationCost = totalCost * expectedTurns;
  const contextGrowth = expectedTurns > 1 ? (expectedTurns - 1) * actualOutputTokens * 0.15 : 0;
  const totalConversationTokens = inputTokens + (actualOutputTokens * expectedTurns) + contextGrowth;

  return {
    singleTurn: {
      input: {
        tokens: inputTokens,
        cost: inputCost,
        rate: pricing.input
      },
      output: {
        tokens: actualOutputTokens,
        estimatedTokens: expectedOutputTokens,
        multiplier: outputMultiplier,
        cost: outputCost,
        rate: pricing.output
      },
      subtotal,
      discount,
      discountAmount: subtotal - totalCost,
      total: totalCost
    },
    conversation: {
      turns: expectedTurns,
      totalTokens: totalConversationTokens,
      estimatedCost: conversationCost + (contextGrowth / 1000 * pricing.input),
      costPerTurn: totalCost,
      contextGrowth: contextGrowth
    },
    recommendations: generateCostOptimizationTips(modelConfig, inputTokens, actualOutputTokens)
  };
}

// Generate cost optimization recommendations
function generateCostOptimizationTips(modelConfig, inputTokens, outputTokens) {
  const tips = [];

  // High input token usage
  if (inputTokens > 50000) {
    tips.push({
      type: 'input_optimization',
      message: 'Consider reducing context size for cost savings',
      potentialSavings: 'up to 40%'
    });
  }

  // Expensive model recommendations
  if (modelConfig.family === 'o1' || modelConfig.costPer1kTokens.output > 0.02) {
    tips.push({
      type: 'model_optimization',
      message: 'Consider using a more cost-effective model for simpler tasks',
      potentialSavings: 'up to 80%'
    });
  }

  // Output multiplier awareness
  if (modelConfig.outputMultiplier && modelConfig.outputMultiplier > 1) {
    tips.push({
      type: 'reasoning_model',
      message: `This reasoning model uses ${modelConfig.outputMultiplier}x more output tokens`,
      impact: 'Higher accuracy but increased cost'
    });
  }

  return tips;
}

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: API for managing chat conversations with LLMs
 */
function createChatRoutes(congressAPIClient, cache, conversationRepository, dbConnection, eventEmitter) {
  const router = express.Router();
  
  // Initialize services
  const llmProviders = new LLMProviders();
  const contextAssembler = new ContextAssembler(congressAPIClient);
  const usageTracker = new UsageTracker(dbConnection, eventEmitter);
  const chatService = new ChatService(llmProviders, contextAssembler, cache, conversationRepository, usageTracker);

  // Store services for cleanup
  router.llmProviders = llmProviders;
  router.chatService = chatService;

  // Test route without middleware
  /**
   * @swagger
   * /api/chat/test:
   *   get:
   *     summary: Test chat routes
   *     tags: [Chat]
   *     description: A test endpoint to confirm the chat routes are working.
   *     responses:
   *       200:
   *         description: Success message
   */
  router.get('/test', (req, res) => {
    res.json({ message: 'Chat routes working' });
  });

  // Get available providers
  /**
   * @swagger
   * /api/chat/providers:
   *   get:
   *     summary: Get available LLM providers
   *     tags: [Chat]
   *     description: Retrieves a list of available LLM providers.
   *     responses:
   *       200:
   *         description: A list of providers.
   */
  router.get('/providers', 
    asyncHandler(async (req, res) => {
      const providers = llmProviders.getAvailableProviders();
      res.json({
        providers,
        count: providers.length
      });
    })
  );

  // Get available models for a provider
  /**
   * @swagger
   * /api/chat/providers/{provider}/models:
   *   get:
   *     summary: Get available models for a provider
   *     tags: [Chat]
   *     description: Retrieves a list of available models for a specific LLM provider.
   *     parameters:
   *       - in: path
   *         name: provider
   *         schema:
   *           type: string
   *         required: true
   *         description: The name of the LLM provider.
   *     responses:
   *       200:
   *         description: A list of models.
   */
  router.get('/providers/:provider/models',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { provider } = req.params;
      const models = await llmProviders.getAvailableModels(provider);
      if (!models) {
        throw new NotFoundError(`No models found for provider '${provider}'`);
      }
      res.json({
        provider,
        models: models,
        count: models.length
      });
    })
  );

  // Estimate token count for context
  /**
   * @swagger
   * /api/chat/estimate-tokens:
   *   post:
   *     summary: Estimate token count for context
   *     tags: [Chat]
   *     description: Estimates the number of tokens that will be used for a given context.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               billInfo: { type: object },
   *               contextConfig: { type: object },
   *               provider: { type: string },
   *               model: { type: string },
   *               additionalText: { type: string },
   *               committeeReportText: { type: string },
   *               hearingText: { type: string }
   *     responses:
   *       200:
   *         description: The estimated token count.
   */
  router.post('/estimate-tokens',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        billInfo,
        contextConfig,
        provider = 'openai',
        model = null,
        additionalText = '',
        // Support multiple text parameter names
        committeeReportText = '',
        hearingText = '',
        congressionalRecordText = '',
        contentText = ''
      } = req.body;

      if (!billInfo || !contextConfig) {
        throw new BadRequestError('billInfo and contextConfig are required');
      }

      // Determine provided text - check type-specific params first
      const providedText = hearingText
        || committeeReportText
        || congressionalRecordText
        || contentText
        || '';

      // Content type is auto-detected by context assembler
      const context = await contextAssembler.assembleContext(billInfo, contextConfig, providedText);
      const contextString = contextAssembler.contextToString(context);
      const fullText = contextString + (additionalText || '');
      // Use native token counting with model parameter
      const tokenCount = await llmProviders.countTokens(fullText, provider, model);

      res.json({
        tokenCount,
        contentType: context.contentType,
        contextSections: context.sections.map(s => ({
          type: s.type,
          title: s.title,
          version: s.version
        })),
        provider
      });
    })
  );

  // Create a new conversation
  /**
   * @swagger
   * /api/chat/conversations:
   *   post:
   *     summary: Create a new conversation
   *     tags: [Chat]
   *     description: Creates a new chat conversation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               billInfo: { type: object },
   *               contextConfig: { type: object },
   *               provider: { type: string },
   *               model: { type: string },
   *               committeeReportText: { type: string },
   *               hearingText: { type: string }
   *     responses:
   *       201:
   *         description: The created conversation.
   */
  router.post('/conversations',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        billInfo,
        contextConfig,
        provider,
        model,
        // Support multiple text parameter names for different content types
        committeeReportText = '',
        hearingText = '',
        congressionalRecordText = '',
        contentText = ''  // Generic fallback
      } = req.body;

      if (!billInfo || !contextConfig || !provider || !model) {
        throw new BadRequestError('billInfo, contextConfig, provider, and model are required');
      }

      // Determine provided text - check type-specific params first, then generic fallback
      const providedText = hearingText
        || committeeReportText
        || congressionalRecordText
        || contentText
        || '';

      // Content type is auto-detected by the context assembler
      const result = await chatService.createConversation(
        billInfo,
        contextConfig,
        provider,
        model,
        providedText
      );

      res.status(201).json(result);
    })
  );

  // Get conversation details
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}:
   *   get:
   *     summary: Get conversation details
   *     tags: [Chat]
   *     description: Retrieves the details of a specific conversation.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     responses:
   *       200:
   *         description: The conversation details.
   */
  router.get('/conversations/:conversationId',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const conversation = await chatService.getConversationHistory(conversationId);
      res.json(conversation);
    })
  );

  // Send a message (non-streaming)
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}/messages:
   *   post:
   *     summary: Send a message (non-streaming)
   *     tags: [Chat]
   *     description: Sends a message to a conversation and receives a non-streaming response.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message: { type: string },
   *               maxTokens: { type: integer },
   *               temperature: { type: number }
   *     responses:
   *       200:
   *         description: The response from the LLM.
   */
  router.post('/conversations/:conversationId/messages',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const { message, maxTokens, temperature } = req.body;

      if (!message) {
        throw new BadRequestError('message is required');
      }

      const result = await chatService.sendMessage(conversationId, message, {
        stream: false,
        maxTokens,
        temperature
      });

      res.json(result);
    })
  );

  // Send a message (streaming)
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}/messages/stream:
   *   post:
   *     summary: Send a message (streaming)
   *     tags: [Chat]
   *     description: Sends a message to a conversation and receives a streaming response.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message: { type: string },
   *               maxTokens: { type: integer },
   *               temperature: { type: number }
   *     responses:
   *       200:
   *         description: A streaming response from the LLM.
   */
  router.post('/conversations/:conversationId/messages/stream',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const { message, maxTokens, temperature } = req.body;

      if (!message) {
        throw new BadRequestError('message is required');
      }

      const streamGenerator = await chatService.sendMessage(conversationId, message, {
        stream: true,
        maxTokens,
        temperature
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      for await (const chunk of streamGenerator) {
          res.write(`data: ${JSON.stringify(chunk)}

`);
      }

      res.end();
    })
  );

  // Update conversation context
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}/context:
   *   put:
   *     summary: Update conversation context
   *     tags: [Chat]
   *     description: Updates the context of a conversation.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               config: { type: object },
   *               committeeReportText: { type: string },
   *               hearingText: { type: string }
   *     responses:
   *       200:
   *         description: The updated conversation context.
   */
  router.put('/conversations/:conversationId/context',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const {
        config,
        // Support multiple text parameter names for different content types
        committeeReportText = '',
        hearingText = '',
        congressionalRecordText = '',
        contentText = ''  // Generic fallback
      } = req.body;

      if (!config) {
        throw new BadRequestError('config object is required');
      }

      const result = await chatService.updateConversationContext(
        conversationId,
        config,
        committeeReportText,
        hearingText,
        congressionalRecordText || contentText
      );

      res.json(result);
    })
  );

  // Estimate tokens for a new message
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}/estimate-tokens:
   *   post:
   *     summary: Estimate tokens for a new message
   *     tags: [Chat]
   *     description: Estimates the number of tokens that will be used for a new message.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message: { type: string }
   *     responses:
   *       200:
   *         description: The estimated token count.
   */
  router.post('/conversations/:conversationId/estimate-tokens',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const { message } = req.body;

      if (!message) {
        throw new BadRequestError('message is required');
      }

      const estimate = chatService.estimateMessageTokens(conversationId, message);
      res.json(estimate);
    })
  );

  // List conversations (for future use)
  /**
   * @swagger
   * /api/chat/conversations:
   *   get:
   *     summary: List conversations
   *     tags: [Chat]
   *     description: Retrieves a list of all conversations.
   *     responses:
   *       200:
   *         description: A list of conversations.
   */
  router.get('/conversations',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const conversations = chatService.listConversations();
      res.json({
        conversations,
        count: conversations.length
      });
    })
  );

  // Delete conversation
  /**
   * @swagger
   * /api/chat/conversations/{conversationId}:
   *   delete:
   *     summary: Delete conversation
   *     tags: [Chat]
   *     description: Deletes a specific conversation.
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         schema:
   *           type: string
   *         required: true
   *         description: The ID of the conversation.
   *     responses:
   *       200:
   *         description: Confirmation of deletion.
   */
  router.delete('/conversations/:conversationId',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const { conversationId } = req.params;
      const success = chatService.deleteConversation(conversationId);
      res.json({
        success,
        message: 'Conversation deleted successfully'
      });
    })
  );

  // Enhanced cost calculation endpoint
  /**
   * @swagger
   * /api/chat/cost-analysis:
   *   post:
   *     summary: Enhanced cost calculation endpoint
   *     tags: [Chat]
   *     description: Provides a detailed cost breakdown for a given context.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               billInfo: { type: object },
   *               contextConfig: { type: object },
   *               provider: { type: string },
   *               model: { type: string },
   *               conversationOptions: { type: object },
   *               hearingText: { type: string }
   *     responses:
   *       200:
   *         description: A detailed cost analysis.
   */
  router.post('/cost-analysis',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        billInfo,
        contextConfig,
        provider = 'openai',
        model = null,
        conversationOptions = {},
        // Support multiple text parameter names
        hearingText = '',
        committeeReportText = '',
        congressionalRecordText = '',
        contentText = ''
      } = req.body;

      if (!billInfo || !contextConfig) {
        throw new BadRequestError('billInfo and contextConfig are required');
      }

      // Determine provided text
      const providedText = hearingText
        || committeeReportText
        || congressionalRecordText
        || contentText
        || '';

      // Content type is auto-detected by context assembler
      const context = await contextAssembler.assembleContext(billInfo, contextConfig, providedText);
      const contextString = contextAssembler.contextToString(context);
      const inputTokens = await llmProviders.countTokens(contextString, provider, model);
      
      // Get model configuration
      const modelConfig = llmProviders.getModelConfig(provider, model);
      if (!modelConfig) {
        throw new NotFoundError(`Model configuration not found for ${provider}/${model}`);
      }

      // Calculate enhanced cost breakdown
      const costAnalysis = {
        inputTokens,
        contextSections: context.sections.map(s => ({
          type: s.type,
          title: s.title,
          version: s.version
        })),
        model: {
          id: model,
          provider,
          ...modelConfig
        },
        costBreakdown: calculateDetailedCostBreakdown(
          inputTokens, 
          modelConfig, 
          conversationOptions
        )
      };

      res.json(costAnalysis);
    })
  );

  // Debug endpoint - get context preview (development only)
  if (process.env.NODE_ENV !== 'production') {
    /**
     * @swagger
     * /api/chat/debug/context:
     *   post:
     *     summary: Debug endpoint - get context preview
     *     tags: [Chat]
     *     description: Retrieves a preview of the context that will be sent to the LLM. Only available in non-production environments.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               billInfo: { type: object },
     *               contextConfig: { type: object },
     *               hearingText: { type: string }
     *     responses:
     *       200:
     *         description: The context preview.
     */
    router.post('/debug/context',
      createMiddlewareChain('chatAPI'),
      asyncHandler(async (req, res) => {
        const {
          billInfo,
          contextConfig,
          // Support multiple text parameter names
          hearingText = '',
          committeeReportText = '',
          congressionalRecordText = '',
          contentText = ''
        } = req.body;

        if (!billInfo || !contextConfig) {
          throw new BadRequestError('billInfo and contextConfig are required');
        }

        // Determine provided text
        const providedText = hearingText
          || committeeReportText
          || congressionalRecordText
          || contentText
          || '';

        // Content type is auto-detected by context assembler
        const context = await contextAssembler.assembleContext(billInfo, contextConfig, providedText);
        const contextString = contextAssembler.contextToString(context);

        res.json({
          contentType: context.contentType,
          context,
          contextString,
          tokenCount: await llmProviders.countTokens(contextString, 'openai')
        });
      })
    );
  }

  // Usage tracking endpoints for real-time cost monitoring
  /**
   * @swagger
   * /api/chat/track-usage:
   *   post:
   *     summary: Usage tracking endpoints for real-time cost monitoring
   *     tags: [Chat]
   *     description: Tracks usage data for real-time cost monitoring.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId: { type: string },
   *               conversationId: { type: string },
   *               messageType: { type: string },
   *               tokenUsage: { type: object },
   *               provider: { type: string },
   *               model: { type: string },
   *               cost: { type: number }
   *     responses:
   *       200:
   *         description: Confirmation of usage tracking.
   */
  router.post('/track-usage',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        sessionId,
        conversationId,
        messageType,
        tokenUsage,
        provider,
        model,
        cost
      } = req.body;

      if (!sessionId || !tokenUsage || !provider || !model) {
        throw new BadRequestError('sessionId, tokenUsage, provider, and model are required');
      }

      // This would typically save to a database
      // For now, we'll just return the tracked data
      const trackingData = {
        id: `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        sessionId,
        conversationId,
        messageType: messageType || 'user',
        tokenUsage: {
          input: tokenUsage.input || 0,
          output: tokenUsage.output || 0,
          total: (tokenUsage.input || 0) + (tokenUsage.output || 0)
        },
        provider,
        model,
        cost: cost || 0,
        metadata: {
          userAgent: req.headers['user-agent'],
          ip: req.ip
        }
      };

      res.json({
        success: true,
        trackingData
      });
    })
  );

  // Get usage statistics for analytics
  /**
   * @swagger
   * /api/chat/usage-stats:
   *   get:
   *     summary: Get usage statistics for analytics
   *     tags: [Chat]
   *     description: Retrieves usage statistics for analytics.
   *     parameters:
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *         description: The start date for the statistics.
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *         description: The end date for the statistics.
   *       - in: query
   *         name: provider
   *         schema:
   *           type: string
   *         description: The LLM provider to filter by.
   *       - in: query
   *         name: model
   *         schema:
   *           type: string
   *         description: The LLM model to filter by.
   *       - in: query
   *         name: aggregateBy
   *         schema:
   *           type: string
   *         description: The aggregation period (e.g., 'day').
   *     responses:
   *       200:
   *         description: Usage statistics.
   */
  router.get('/usage-stats',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        startDate,
        endDate,
        provider,
        model,
        aggregateBy = 'day'
      } = req.query;

      // Mock analytics data - in production this would query a database
      const mockStats = {
        summary: {
          totalCost: 2.4567,
          totalTokens: 156789,
          totalMessages: 423,
          conversationCount: 89,
          averageCostPerMessage: 0.0058,
          averageTokensPerMessage: 370.6
        },
        dailyBreakdown: [
          { date: '2025-01-18', totalCost: 0.3456, messageCount: 67, tokenCount: 25890 },
          { date: '2025-01-17', totalCost: 0.2890, messageCount: 52, tokenCount: 19876 },
          { date: '2025-01-16', totalCost: 0.4123, messageCount: 78, tokenCount: 30567 }
        ],
        topModels: [
          {
            provider: 'openai',
            model: 'gpt-4o',
            totalCost: 1.2345,
            messageCount: 234,
            totalTokens: 89765,
            averageCostPerMessage: 0.0053,
            averageCostPerToken: 0.0000138,
            lastUsed: Date.now() - 3600000
          },
          {
            provider: 'claude',
            model: 'claude-3-5-sonnet-20241022',
            totalCost: 0.8901,
            messageCount: 156,
            totalTokens: 67234,
            averageCostPerMessage: 0.0057,
            averageCostPerToken: 0.0000132,
            lastUsed: Date.now() - 7200000
          }
        ],
        providerBreakdown: {
          openai: { cost: 1.4567, usage: 60.2 },
          claude: { cost: 0.7890, usage: 32.6 },
          gemini: { cost: 0.2110, usage: 7.2 }
        }
      };

      res.json({
        period: {
          startDate: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          endDate: endDate || new Date().toISOString().split('T')[0]
        },
        filters: { provider, model, aggregateBy },
        data: mockStats
      });
    })
  );

  // Real-time usage alerts endpoint
  /**
   * @swagger
   * /api/chat/usage-alerts:
   *   post:
   *     summary: Real-time usage alerts endpoint
   *     tags: [Chat]
   *     description: Checks for and returns real-time usage alerts.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               alertType: { type: string },
   *               thresholds: { type: object },
   *               currentUsage: { type: object }
   *     responses:
   *       200:
   *         description: A list of alerts.
   */
  router.post('/usage-alerts',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        alertType,
        thresholds,
        currentUsage
      } = req.body;

      if (!alertType || !thresholds || !currentUsage) {
        throw new BadRequestError('alertType, thresholds, and currentUsage are required');
      }

      const alerts = [];

      // Check different alert types
      if (alertType === 'cost' && currentUsage.totalCost > thresholds.dailyCost) {
        alerts.push({
          type: 'daily_cost_exceeded',
          level: 'warning',
          message: `Daily cost threshold exceeded: $${currentUsage.totalCost.toFixed(4)} > $${thresholds.dailyCost.toFixed(4)}`,
          timestamp: Date.now(),
          data: {
            current: currentUsage.totalCost,
            threshold: thresholds.dailyCost,
            percentage: (currentUsage.totalCost / thresholds.dailyCost) * 100
          }
        });
      }

      if (alertType === 'tokens' && currentUsage.totalTokens > thresholds.tokenLimit) {
        alerts.push({
          type: 'token_limit_exceeded',
          level: 'info',
          message: `Token usage is high: ${currentUsage.totalTokens} tokens used today`,
          timestamp: Date.now(),
          data: {
            current: currentUsage.totalTokens,
            threshold: thresholds.tokenLimit
          }
        });
      }

      res.json({
        alerts,
        alertCount: alerts.length,
        timestamp: Date.now()
      });
    })
  );

  // Get cost optimization recommendations
  /**
   * @swagger
   * /api/chat/cost-optimization:
   *   post:
   *     summary: Get cost optimization recommendations
   *     tags: [Chat]
   *     description: Retrieves cost optimization recommendations based on usage patterns.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               currentUsage: { type: object },
   *               usagePatterns: { type: object },
   *               preferences: { type: object }
   *     responses:
   *       200:
   *         description: A list of cost optimization recommendations.
   */
  router.post('/cost-optimization',
    createMiddlewareChain('chatAPI'),
    asyncHandler(async (req, res) => {
      const {
        currentUsage,
        usagePatterns,
        preferences = {}
      } = req.body;

      if (!currentUsage) {
        throw new BadRequestError('currentUsage is required');
      }

      // Mock optimization recommendations
      const recommendations = [];

      // High cost per message recommendation
      if (currentUsage.averageCostPerMessage > 0.01) {
        recommendations.push({
          type: 'model_optimization',
          priority: 'high',
          title: 'Switch to More Cost-Effective Models',
          description: `Your average cost per message is $${currentUsage.averageCostPerMessage.toFixed(4)}. Consider using GPT-4o-mini or Claude Haiku for routine tasks.`,
          potentialSavings: currentUsage.totalCost * 0.4,
          action: 'Switch to cheaper models for simple queries',
          models: [
            { provider: 'openai', model: 'gpt-4o-mini', savingsPercentage: 85 },
            { provider: 'claude', model: 'claude-3-5-haiku-20241022', savingsPercentage: 80 }
          ]
        });
      }

      // Long conversation optimization
      if (usagePatterns && usagePatterns.averageConversationLength > 10) {
        recommendations.push({
          type: 'conversation_optimization',
          priority: 'medium',
          title: 'Optimize Conversation Length',
          description: 'Your conversations average more than 10 messages. Consider being more specific in initial prompts.',
          potentialSavings: currentUsage.totalCost * 0.2,
          action: 'Use more specific prompts to reduce back-and-forth',
          tips: [
            'Include all relevant context in the first message',
            'Ask specific rather than open-ended questions',
            'Use structured prompts for complex requests'
          ]
        });
      }

      // Provider diversification
      const providerConcentration = Math.max(...Object.values(currentUsage.providerUsage || { default: 100 }));
      if (providerConcentration > 80) {
        recommendations.push({
          type: 'diversification',
          priority: 'low',
          title: 'Consider Provider Diversification',
          description: 'You\'re heavily concentrated on one provider. Diversification can provide cost benefits and redundancy.',
          potentialSavings: currentUsage.totalCost * 0.15,
          action: 'Try alternative providers for different use cases',
          alternatives: [
            { provider: 'claude', useCase: 'Long-form content analysis', benefit: 'Large context window' },
            { provider: 'gemini', useCase: 'Quick summaries', benefit: 'Fast and cost-effective' }
          ]
        });
      }

      res.json({
        recommendations,
        totalPotentialSavings: recommendations.reduce((sum, rec) => sum + rec.potentialSavings, 0),
        optimizationScore: Math.max(0, 100 - (recommendations.length * 20)),
        timestamp: Date.now()
      });
    })
  );

  return router;
}

module.exports = { createChatRoutes };