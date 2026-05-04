const { randomUUID: uuidv4 } = require('crypto');
const { logger, chatLogger } = require('../logger');

class ChatService {
  constructor(llmProviders, contextAssembler, cache, conversationRepository) {
    this.llmProviders = llmProviders;
    this.contextAssembler = contextAssembler;
    this.cache = cache;
    this.conversationRepository = conversationRepository;
  }

  // Create a new conversation
  // Note: isHearing parameter is deprecated - content type is auto-detected from contentInfo
  async createConversation(contentInfo, contextConfig, provider, model, providedText = '', isHearing = false) {
    const conversationId = uuidv4();

    // Generate log identifier based on content type
    const logIdentifier = this.getContentIdentifier(contentInfo);
    chatLogger.info(`Creating new conversation`, {
      conversationId,
      item: logIdentifier,
      contentType: contentInfo.contentType || 'auto-detect',
      provider,
      model,
      contextConfig
    });

    try {
      chatLogger.debug(`Creating conversation with providedText length: ${providedText ? providedText.length : 0}`);

      // Assemble context - type is auto-detected by context assembler
      const context = await this.contextAssembler.assembleContext(contentInfo, contextConfig, providedText);
      
      // Calculate token count using native API
      const tokenCount = await this.llmProviders.countTokens(
        this.contextAssembler.contextToString(context),
        provider,
        model
      );

      // Create conversation object
      const conversation = {
        id: conversationId,
        billInfo: contentInfo,  // Keep 'billInfo' key for backward compatibility
        contextConfig,
        provider,
        model,
        context,
        messages: [],
        tokenCount,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Store in database - use contentType from context for type tracking
      await this.conversationRepository.createConversation({
        id: conversationId,
        billInfo: contentInfo,
        provider,
        model,
        contextConfig,
        context,
        tokenCount,
        contentType: context.contentType,
        // Keep isHearing for backward compatibility with existing DB queries
        isHearing: context.contentType === 'hearing'
      });

      chatLogger.info(`Conversation created successfully`, {
        conversationId,
        tokenCount,
        contextSections: context.sections.map(s => s.type)
      });

      const fullContextPrompt = this.contextAssembler.contextToString(context);

      return {
        conversationId,
        tokenCount,
        contextSections: context.sections.map(s => ({
          type: s.type,
          title: s.title,
          version: s.version
        })),
        fullContextPrompt,
        contextConfig: {
          ...contextConfig,
          provider,
          model
        }
      };

    } catch (error) {
      chatLogger.error('Error creating conversation', { conversationId, error: error.message, stack: error.stack });
      throw new Error(`Failed to create conversation: ${error.message}`);
    }
  }

  // Get conversation by ID
  async getConversation(conversationId) {
    const conversation = await this.conversationRepository.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return conversation;
  }

  // Send a message in a conversation
  async sendMessage(conversationId, userMessage, options = {}) {
    const conversation = await this.getConversation(conversationId);
    
    chatLogger.info(`Sending message`, {
      conversationId,
      provider: conversation.provider,
      model: conversation.model,
      userMessageLength: userMessage.length,
      options
    });

    try {
      // Add user message to conversation
      const userMessageObj = {
        id: uuidv4(),
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
        tokenCount: await this.llmProviders.countTokens(userMessage, conversation.provider, conversation.model)
      };

      // Add user message to database
      await this.conversationRepository.addMessage(conversationId, {
        id: userMessageObj.id,
        role: userMessageObj.role,
        content: userMessageObj.content,
        tokenCount: userMessageObj.tokenCount,
        streaming: false
      });
      
      // Update conversation object for processing
      conversation.messages.push(userMessageObj);

      // Prepare messages for LLM
      const llmMessages = this.prepareLLMMessages(conversation);

      // Get LLM response
      const response = await this.llmProviders.chatCompletion(
        conversation.provider,
        conversation.model,
        llmMessages,
        {
          stream: options.stream || false,
          maxTokens: options.maxTokens || 1000,
          temperature: options.temperature || 0.7
        }
      );

      if (options.stream) {
        // Return streaming response
        return this.handleStreamingResponse(conversation, response);
      } else {
        // Handle non-streaming response
        return this.handleNonStreamingResponse(conversation, response);
      }

    } catch (error) {
      chatLogger.error('Error sending message', { conversationId, error: error.message, stack: error.stack });
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  // Prepare messages for LLM API
  prepareLLMMessages(conversation) {
    const messages = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: this.contextAssembler.contextToString(conversation.context)
    });

    // Add conversation history
    conversation.messages.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    return messages;
  }

  // Handle streaming response
  async handleStreamingResponse(conversation, stream) {
    const assistantMessageId = uuidv4();
    
    const assistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      tokenCount: 0,
      streaming: true
    };

    // Add assistant message to database
    await this.conversationRepository.addMessage(conversation.id, {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      tokenCount: assistantMessage.tokenCount,
      streaming: assistantMessage.streaming
    });
    
    conversation.messages.push(assistantMessage);

    // Return the async generator directly
    return this.createStreamProcessor(conversation, assistantMessage, stream);
  }

  // Create stream processor
  createStreamProcessor(conversation, assistantMessage, stream) {
    let content = '';
    
    const processStream = async function* (providerStream) {
        // Yield the starting message ID first
        yield {
            type: 'start',
            messageId: assistantMessage.id
        };

        try {
            // Handle each provider's streaming format differently
            if (conversation.provider === 'openai') {
                for await (const chunk of providerStream) {
                    const delta = chunk.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        content += delta;
                        yield {
                            type: 'content',
                            content: delta,
                            fullContent: content
                        };
                    }
                }
            } else if (conversation.provider === 'claude') {
                for await (const chunk of providerStream) {
                    if (chunk.type === 'content_block_delta') {
                        const delta = chunk.delta?.text || '';
                        if (delta) {
                            content += delta;
                            yield {
                                type: 'content',
                                content: delta,
                                fullContent: content
                            };
                        }
                    }
                }
            } else if (conversation.provider === 'gemini') {
                // Gemini returns a different stream format, handle it properly
                try {
                    for await (const chunk of providerStream) {
                        let delta = '';
                        if (chunk && typeof chunk.text === 'function') {
                            delta = chunk.text() || '';
                        } else if (chunk && chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content) {
                            // Handle alternate Gemini response format
                            const parts = chunk.candidates[0].content.parts || [];
                            delta = parts.map(part => part.text || '').join('');
                        }
                        
                        if (delta) {
                            content += delta;
                            yield {
                                type: 'content',
                                content: delta,
                                fullContent: content
                            };
                        }
                    }
                } catch (geminiError) {
                    // If standard iteration fails, try alternative Gemini stream handling
                    chatLogger.warn('Gemini standard streaming failed, trying alternative method', {
                        error: geminiError.message,
                        conversationId: conversation.id
                    });
                    
                    if (providerStream && typeof providerStream.stream === 'function') {
                        const chunks = await providerStream.stream();
                        for (const chunk of chunks) {
                            const delta = chunk.text() || '';
                            if (delta) {
                                content += delta;
                                yield {
                                    type: 'content',
                                    content: delta,
                                    fullContent: content
                                };
                            }
                        }
                    }
                }
            } else if (conversation.provider === 'ollama') {
                for await (const chunk of providerStream) {
                    const delta = chunk?.message?.content || '';
                    if (delta) {
                        content += delta;
                        yield {
                            type: 'content',
                            content: delta,
                            fullContent: content
                        };
                    }
                }
            }

            // Finalize message
            assistantMessage.content = content;
            assistantMessage.streaming = false;
            assistantMessage.tokenCount = await this.llmProviders.countTokens(content, conversation.provider, conversation.model);
            
            // Update message in database
            await this.conversationRepository.updateMessage(assistantMessage.id, {
              content,
              streaming: false,
              tokenCount: assistantMessage.tokenCount
            });
            
            chatLogger.info('Stream ended successfully', {
                conversationId: conversation.id,
                messageId: assistantMessage.id,
                assistantMessageLength: content.length,
                tokenCount: assistantMessage.tokenCount
            });

            yield {
                type: 'done',
                fullContent: content,
                tokenCount: assistantMessage.tokenCount
            };

        } catch (error) {
            chatLogger.error('Error in stream processing', { conversationId: conversation.id, messageId: assistantMessage.id, error: error.message, stack: error.stack });
            assistantMessage.error = error.message;
            
            yield {
                type: 'error',
                error: error.message
            };
        }
    }.bind(this); // Bind 'this' to access llmProviders

    // For all providers, 'stream' is the stream itself
    return processStream(stream);
  }

  // Handle non-streaming response
  async handleNonStreamingResponse(conversation, response) {
    let content = '';
    let tokenUsage = {};

    if (conversation.provider === 'openai') {
      content = response.choices[0]?.message?.content || '';
      tokenUsage = response.usage || {};
    } else if (conversation.provider === 'claude') {
      content = response.content[0]?.text || '';
      tokenUsage = response.usage || {};
    } else if (conversation.provider === 'gemini') {
      content = response.content[0]?.text || '';
      tokenUsage = response.usage || {};
    } else if (conversation.provider === 'ollama') {
      content = response.content[0]?.text || '';
      tokenUsage = response.usage || {};
    }

    const assistantMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      tokenCount: await this.llmProviders.countTokens(content, conversation.provider, conversation.model),
      tokenUsage,
      streaming: false
    };

    // Add assistant message to database
    await this.conversationRepository.addMessage(conversation.id, {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      tokenCount: assistantMessage.tokenCount,
      tokenUsage: assistantMessage.tokenUsage,
      streaming: assistantMessage.streaming
    });
    
    conversation.messages.push(assistantMessage);

    chatLogger.info('Non-streaming response received successfully', {
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        assistantMessageLength: content.length,
        tokenUsage: tokenUsage
    });

    return {
      messageId: assistantMessage.id,
      content,
      tokenCount: assistantMessage.tokenCount,
      tokenUsage
    };
  }

  // Get conversation history
  async getConversationHistory(conversationId) {
    const conversation = await this.getConversation(conversationId);
    
    return {
      id: conversation.id,
      billInfo: conversation.billInfo,
      provider: conversation.provider,
      model: conversation.model,
      messages: conversation.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        tokenCount: msg.tokenCount,
        streaming: msg.streaming
      })),
      tokenCount: conversation.tokenCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };
  }

  // Update conversation context
  // Accepts multiple text parameters for backward compatibility
  async updateConversationContext(conversationId, newConfig, committeeReportText = '', hearingText = '', congressionalRecordText = '') {
    const conversation = await this.getConversation(conversationId);

    chatLogger.info(`Updating context for conversation ${conversationId}`, { newConfig });

    try {
      // Update provider and model
      conversation.provider = newConfig.provider || conversation.provider;
      conversation.model = newConfig.model || conversation.model;

      // Determine provided text based on content type or what was passed
      const providedText = hearingText || committeeReportText || congressionalRecordText || '';

      // Reassemble context with new configuration - type is auto-detected
      const newContext = await this.contextAssembler.assembleContext(
        conversation.billInfo,
        newConfig,
        providedText
      );

      // Update conversation in database
      await this.conversationRepository.updateConversation(conversationId, {
        provider: conversation.provider,
        model: conversation.model,
        context_config: newConfig,
        context_data: newContext,
        token_count: await this.llmProviders.countTokens(
          this.contextAssembler.contextToString(newContext),
          conversation.provider,
          conversation.model
        )
      });
      
      // Update local conversation object
      conversation.context = newContext;
      conversation.contextConfig = newConfig;
      conversation.tokenCount = await this.llmProviders.countTokens(
        this.contextAssembler.contextToString(newContext),
        conversation.provider,
        conversation.model
      );

      chatLogger.info(`Successfully updated context for conversation ${conversationId}`, {
        tokenCount: conversation.tokenCount,
        contextSections: newContext.sections.map(s => s.type)
      });

      const fullContextPrompt = this.contextAssembler.contextToString(newContext);

      return {
        tokenCount: conversation.tokenCount,
        contextSections: newContext.sections.map(s => ({
          type: s.type,
          title: s.title,
          version: s.version
        })),
        fullContextPrompt,
        contextConfig: {
          ...newConfig,
          provider: conversation.provider,
          model: conversation.model
        }
      };

    } catch (error) {
      chatLogger.error('Error updating conversation context:', { conversationId, error: error.message, stack: error.stack });
      throw new Error(`Failed to update context: ${error.message}`);
    }
  }

  // Estimate token count for new message
  async estimateMessageTokens(conversationId, message) {
    const conversation = await this.getConversation(conversationId);
    
    // Count tokens for the new message
    const messageTokens = await this.llmProviders.countTokens(message, conversation.provider, conversation.model);
    
    // Count tokens for current context + conversation history
    const contextTokens = conversation.tokenCount;
    const historyTokens = conversation.messages.reduce((total, msg) => {
      return total + (msg.tokenCount || 0);
    }, 0);
    
    return {
      messageTokens,
      contextTokens,
      historyTokens,
      totalTokens: messageTokens + contextTokens + historyTokens
    };
  }

  // List conversations
  async listConversations(limit = 50, offset = 0) {
    return await this.conversationRepository.listConversations(limit, offset);
  }

  // Delete conversation
  async deleteConversation(conversationId) {
    const deleted = await this.conversationRepository.deleteConversation(conversationId);
    
    if (deleted) {
      logger.info(`Conversation deleted: ${conversationId}`);
    }
    
    return deleted;
  }

  // Cleanup old conversations
  async cleanupOldConversations(olderThanDays = 30) {
    const deletedCount = await this.conversationRepository.cleanupOldConversations(olderThanDays);
    logger.info(`Cleaned up ${deletedCount} old conversations`);
    return deletedCount;
  }

  // Helper method to generate a content identifier for logging
  getContentIdentifier(contentInfo) {
    if (!contentInfo) return 'Unknown content';

    // Check explicit contentType first
    if (contentInfo.contentType === 'hearing' || contentInfo.jacketNumber) {
      return `Hearing ${contentInfo.jacketNumber || 'Unknown'}`;
    }

    if (contentInfo.contentType === 'committee-report' || (contentInfo.reportType && contentInfo.reportNumber)) {
      return `Committee Report ${contentInfo.reportType || ''} ${contentInfo.reportNumber || 'Unknown'}`;
    }

    if (contentInfo.contentType === 'congressional-record' || (contentInfo.volume && contentInfo.issueNumber)) {
      return `Congressional Record Vol. ${contentInfo.volume || '?'}, Issue ${contentInfo.issueNumber || '?'}`;
    }

    // Default to bill
    if (contentInfo.type && contentInfo.number) {
      return `Bill ${contentInfo.type?.toUpperCase()} ${contentInfo.number}`;
    }

    return `Content ${contentInfo.contentType || 'Unknown'}`;
  }
}

module.exports = { ChatService };