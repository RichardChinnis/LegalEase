const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Tiktoken } = require('js-tiktoken/lite');
const o200k_base = require('js-tiktoken/ranks/o200k_base');
const Ollama = require('ollama');
const { logger } = require('../logger');
const fs = require('fs');
const path = require('path');

class LLMProviders {
  constructor() {
    this.providers = {
      openai: null,
      claude: null,
      gemini: null,
      ollama: null
    };
    
    this.tokenizers = {
      openai: null
    };
    
    this.modelConfigs = null;
    this.claudeModelsCache = null;
    this.claudeModelsLastUpdated = null;
    this.ollamaModelsCache = null;
    this.ollamaModelsLastUpdated = null;
    
    this.initializeProviders();
    this.loadModelConfigurations();
  }

  loadModelConfigurations() {
    try {
      const configPath = path.join(__dirname, '../config/models.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.modelConfigs = JSON.parse(configData);
      logger.info(`Model configurations loaded (version ${this.modelConfigs.version})`);
    } catch (error) {
      logger.error('Failed to load model configurations:', error);
      this.modelConfigs = this.getDefaultModelConfigs();
    }
  }
  
  getDefaultModelConfigs() {
    return {
      version: '0.0.0',
      openai: {},
      claude: {},
      gemini: {},
      ollama: {}
    };
  }
  
  async reloadModelConfigurations() {
    this.loadModelConfigurations();
    logger.info('Model configurations reloaded');
  }
  
  getModelConfig(provider, modelId) {
    return this.modelConfigs?.[provider]?.[modelId] || null;
  }
  
  initializeProviders() {
    // Initialize OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.providers.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      
      // Initialize OpenAI tokenizer
      this.tokenizers.openai = new Tiktoken(o200k_base);
      logger.info('OpenAI provider initialized');
    }

    // Initialize Anthropic Claude
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.claude = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      logger.info('Anthropic Claude provider initialized');
    }

    // Initialize Gemini
    if (process.env.GEMINI_API_KEY) {
      this.providers.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      logger.info('Gemini provider initialized');
    }

    // Initialize Ollama
    if (process.env.OLLAMA_BASE_URL) {
      this.providers.ollama = new Ollama.Ollama({ host: process.env.OLLAMA_BASE_URL });
      logger.info(`Ollama provider initialized for host: ${process.env.OLLAMA_BASE_URL}`);
    }
  }

  // Get available providers
  getAvailableProviders() {
    return Object.keys(this.providers).filter(key => this.providers[key] !== null);
  }

  // Get available models for a provider
  async getAvailableModels(provider) {
    switch (provider) {
      case 'openai':
        return this.getOpenAIModels();
      case 'claude':
        return this.getClaudeModels();
      case 'gemini':
        return this.getGeminiModels();
      case 'ollama':
        return this.getOllamaModels();
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async getOpenAIModels() {
    if (!this.providers.openai) {
      throw new Error('OpenAI provider not initialized');
    }

    const response = await this.providers.openai.models.list();
    const models = response.data; // Extract the array of models
    
    // Filter to only chat completion models and merge with configuration
    const chatModels = models
      .filter(model => model.id.includes('gpt') || model.id.includes('o1'))
      .map(model => {
        const config = this.getModelConfig('openai', model.id) || {
          contextLength: 8192,
          costPer1kTokens: { input: 0.001, output: 0.002 },
          family: 'unknown'
        };
        
        return {
          id: model.id,
          name: model.id,
          ...config,
          available: true
        };
      })
      .filter(model => !model.deprecated); // Filter out deprecated models

    return chatModels;
  }

  async getClaudeModels() {
    if (!this.providers.claude) {
      throw new Error('Claude provider not initialized');
    }

    const now = Date.now();
    if (this.claudeModelsCache && (now - this.claudeModelsLastUpdated < 24 * 60 * 60 * 1000)) {
      logger.info('Returning cached Claude models.');
      return this.claudeModelsCache;
    }

    try {
      logger.info('Fetching Claude models from API.');
      const apiModelsPage = await this.providers.claude.models.list();
      const apiModels = apiModelsPage.data;
      const localClaudeConfig = this.modelConfigs?.claude || {};

      const mergedModels = apiModels.map(apiModel => {
        const localConfig = localClaudeConfig[apiModel.id] || {};
        if (!localClaudeConfig[apiModel.id]) {
          logger.warn(`Model "${apiModel.id}" found in API but not in local config. Using API defaults.`);
        }
        return {
          id: apiModel.id,
          name: apiModel.id,
          ...localConfig, // Spread local config first
          contextLength: apiModel.context_length,
          available: true, // Mark as available since it's from the API
        };
      });

      // Add any models from local config that were not in the API response, and mark them as unavailable
      for (const modelId in localClaudeConfig) {
        if (!mergedModels.some(m => m.id === modelId)) {
          mergedModels.push({
            id: modelId,
            name: modelId,
            ...localClaudeConfig[modelId],
            available: false,
          });
          logger.warn(`Model "${modelId}" from local config not found in API response. Marked as unavailable.`);
        }
      }
      
      this.claudeModelsCache = mergedModels.filter(model => !model.deprecated);
      this.claudeModelsLastUpdated = now;

      return this.claudeModelsCache;
    } catch (error) {
      logger.error('Failed to fetch Claude models from API. Falling back to local config.', error);
      // Fallback to local config if API call fails
      const claudeConfig = this.modelConfigs?.claude || {};
      return Object.keys(claudeConfig)
        .map(modelId => ({
          id: modelId,
          name: modelId,
          ...claudeConfig[modelId],
          available: false, // Mark as unavailable due to API failure
        }))
        .filter(model => !model.deprecated);
    }
  }

  async getGeminiModels() {
    if (!this.providers.gemini) {
      throw new Error('Gemini provider not initialized');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Filter to generative models
    const geminiModels = data.models
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => {
        const modelId = model.name.replace('models/', '');
        return {
          id: modelId,
          name: model.displayName || modelId,
          contextLength: model.inputTokenLimit || 30720,
          costPer1kTokens: { input: 0.0005, output: 0.0015 } // Default pricing
        };
      });

    return geminiModels;
  }

  async getOllamaModels() {
    if (!this.providers.ollama) {
      throw new Error('Ollama provider not initialized');
    }

    const now = Date.now();
    if (this.ollamaModelsCache && (now - this.ollamaModelsLastUpdated < 24 * 60 * 60 * 1000)) {
      logger.info('Returning cached Ollama models.');
      return this.ollamaModelsCache;
    }

    try {
      logger.info('Fetching Ollama models from API.');
      const { models } = await this.providers.ollama.list();

      const detailedModels = await Promise.all(models.map(async (model) => {
        const [name, tag] = model.name.split(':');
        try {
          const showResponse = await this.providers.ollama.show({ name: model.name });
          const family = showResponse.details?.family || 'unknown';
          const contextLengthKey = `${family}.context_length`;
          const contextLength = showResponse.model_info?.[contextLengthKey] || 4096;

          return {
            id: model.name,
            name: `${name.charAt(0).toUpperCase() + name.slice(1)} (${tag})`,
            contextLength: contextLength,
            costPer1kTokens: { input: 0, output: 0 },
            lastModified: model.modified_at,
            family: family
          };
        } catch (error) {
          logger.warn(`Could not fetch details for Ollama model ${model.name}, using defaults.`, { error: error.message });
          return {
            id: model.name,
            name: `${name.charAt(0).toUpperCase() + name.slice(1)} (${tag})`,
            contextLength: 4096, // Fallback context length
            costPer1kTokens: { input: 0, output: 0 },
            lastModified: model.modified_at,
            family: 'unknown'
          };
        }
      }));

      detailedModels.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      
      this.ollamaModelsCache = detailedModels;
      this.ollamaModelsLastUpdated = now;

      return detailedModels;
    } catch (error) {
      logger.error('Error fetching Ollama models:', error);
      return [];
    }
  }


  // Enhanced token counting with model-specific selection logic
  async countTokens(text, provider = 'openai', model = null) {
    const startTime = Date.now();
    
    try {
      let tokenCount;
      const normalizedProvider = this.normalizeProviderName(provider);
      const selectedModel = this.selectOptimalModel(normalizedProvider, model);
      
      switch (normalizedProvider) {
        case 'openai':
          tokenCount = this.countOpenAITokens(text, selectedModel);
          break;
        case 'claude':
          tokenCount = await this.countClaudeTokensNative(text, selectedModel);
          break;
        case 'gemini':
          tokenCount = await this.countGeminiTokensNative(text, selectedModel);
          break;
        case 'ollama':
          // Ollama uses local models, estimate based on OpenAI tokenizer
          tokenCount = this.countOpenAITokensLocal(text);
          break;
        default:
          logger.warn(`Unknown provider ${provider}, using generic estimation`);
          tokenCount = this.estimateTokens(text);
      }
      
      const duration = Date.now() - startTime;
      logger.debug(`Token counting completed`, {
        provider: normalizedProvider,
        model: selectedModel,
        tokenCount,
        textLength: text.length,
        duration
      });
      
      return tokenCount;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.warn(`Token counting failed for ${provider}, using fallback:`, {
        error: error.message,
        duration,
        textLength: text.length
      });
      
      return this.countTokensFallback(text, provider);
    }
  }
  
  // Helper method to normalize provider names
  normalizeProviderName(provider) {
    const normalized = provider.toLowerCase().trim();
    
    // Handle common variations
    switch (normalized) {
      case 'anthropic':
        return 'claude';
      case 'google':
      case 'google-ai':
        return 'gemini';
      case 'openai':
      case 'gpt':
        return 'openai';
      default:
        return normalized;
    }
  }
  
  // Helper method to select optimal model for tokenization
  selectOptimalModel(provider, requestedModel) {
    // If a specific model is requested, use it directly.
    if (requestedModel) {
      return requestedModel;
    }
    
    // If no model is requested, select default models optimized for tokenization accuracy.
    logger.debug(`No model requested for tokenization, using default for provider ${provider}`);
    switch (provider) {
      case 'openai':
        return 'gpt-4o'; // Latest model with best tokenization
      case 'claude':
        return 'claude-3-5-sonnet-20241022'; // Latest Sonnet model
      case 'gemini':
        return 'gemini-1.5-pro'; // Best balance of accuracy and performance
      default:
        return null;
    }
  }
  
  // Enhanced fallback token counting with improved accuracy
  countTokensFallback(text, provider) {
    const normalizedProvider = this.normalizeProviderName(provider);
    
    try {
      switch (normalizedProvider) {
        case 'openai':
          return this.countOpenAITokensLocal(text);
        case 'claude':
          return this.countClaudeTokensEstimate(text);
        case 'gemini':
          return this.countGeminiTokensEstimate(text);
        case 'ollama':
          // Ollama models vary, but most are based on similar tokenizers
          return this.countOpenAITokensLocal(text);
        default:
          logger.debug(`Using generic fallback estimation for provider: ${provider}`);
          return this.estimateTokens(text);
      }
    } catch (error) {
      logger.error(`Fallback token counting failed for ${provider}:`, error);
      return this.estimateTokens(text); // Final fallback
    }
  }

  // OpenAI token counting (uses local tokenizer - most reliable)
  countOpenAITokens(text, model = null) {
    return this.countOpenAITokensLocal(text);
  }
  
  countOpenAITokensLocal(text) {
    if (!this.tokenizers.openai) {
      throw new Error('OpenAI tokenizer not initialized');
    }
    return this.tokenizers.openai.encode(text).length;
  }

  // Claude native token counting with enhanced error handling and model validation
  async countClaudeTokensNative(text, model = 'claude-3-5-sonnet-20241022') {
    if (!this.providers.claude) {
      throw new Error('Claude provider not initialized');
    }
    
    try {
      // Validate model name exists in our configuration
      const modelConfig = this.getModelConfig('claude', model);
      const validatedModel = model || 'claude-3-5-sonnet-20241022';
      
      // Enhanced token counting with proper error handling
      const response = await this.providers.claude.messages.countTokens({
        model: validatedModel,
        messages: [{ role: 'user', content: text }]
      });
      
      logger.debug(`Claude native token count successful`, {
        model: validatedModel,
        textLength: text.length,
        tokenCount: response.input_tokens
      });
      
      return response.input_tokens;
    } catch (error) {
      logger.warn('Claude native token counting failed, falling back to estimation:', {
        model: model,
        error: error.message,
        textLength: text.length
      });
      
      // Enhanced fallback with more accurate estimation
      return this.countClaudeTokensEstimate(text);
    }
  }
  
  countClaudeTokensEstimate(text) {
    // Enhanced estimation based on recent research (2024)
    // Claude tokenizer is generally more efficient than OpenAI's
    const openaiTokens = this.countOpenAITokensLocal(text);
    
    // Different multipliers based on text characteristics
    const textLength = text.length;
    let multiplier = 1.15; // Base multiplier for general text
    
    // Adjust multiplier based on text characteristics
    if (textLength < 1000) {
      // Short texts tend to have higher token efficiency in Claude
      multiplier = 1.10;
    } else if (textLength > 5000) {
      // Longer texts may have slightly different tokenization patterns
      multiplier = 1.20;
    }
    
    // Additional adjustment for code-heavy content
    if (text.includes('```') || text.includes('function') || text.includes('class ')) {
      multiplier *= 1.05; // Code content may tokenize differently
    }
    
    const estimatedTokens = Math.ceil(openaiTokens * multiplier);
    
    logger.debug(`Claude token estimation`, {
      textLength,
      openaiTokens,
      multiplier,
      estimatedTokens
    });
    
    return estimatedTokens;
  }

  // Gemini native token counting with enhanced error handling and model validation
  async countGeminiTokensNative(text, model = 'gemini-1.5-pro') {
    if (!this.providers.gemini) {
      throw new Error('Gemini provider not initialized');
    }
    
    try {
      // Validate model name exists in our configuration
      const modelConfig = this.getModelConfig('gemini', model);
      const validatedModel = model || 'gemini-1.5-pro';
      
      // Create model instance with proper configuration
      const genModel = this.providers.gemini.getGenerativeModel({ 
        model: validatedModel 
      });
      
      // Enhanced token counting with proper content structure
      // Use the new contents array format for better accuracy
      const result = await genModel.countTokens({
        contents: [{
          role: 'user',
          parts: [{ text: text }]
        }]
      });
      
      logger.debug(`Gemini native token count successful`, {
        model: validatedModel,
        textLength: text.length,
        totalTokens: result.totalTokens,
        cachedContentTokenCount: result.cachedContentTokenCount || 0
      });
      
      return result.totalTokens;
    } catch (error) {
      logger.warn('Gemini native token counting failed, falling back to estimation:', {
        model: model,
        error: error.message,
        textLength: text.length
      });
      
      // Enhanced fallback with more accurate estimation
      return this.countGeminiTokensEstimate(text);
    }
  }
  
  countGeminiTokensEstimate(text) {
    // Enhanced estimation based on 2024 research
    // Gemini tokenizer is generally similar to OpenAI but with some differences
    const openaiTokens = this.countOpenAITokensLocal(text);
    const textLength = text.length;
    
    // Base estimation: Gemini tokens ≈ 4 characters per token (as documented)
    // This gives us a character-based baseline
    const characterBasedTokens = Math.ceil(textLength / 4);
    
    // OpenAI-based estimation with multiplier
    let multiplier = 1.12; // Base multiplier for general text
    
    // Adjust based on text characteristics
    if (textLength < 500) {
      // Very short texts: use character-based for better accuracy
      multiplier = 1.08;
    } else if (textLength > 10000) {
      // Long texts may have more consistent patterns
      multiplier = 1.18;
    }
    
    // Additional adjustments for content type
    if (text.includes('```') || text.includes('function') || text.includes('class ')) {
      multiplier *= 1.03; // Code tokenization differences
    }
    
    // Multi-language or special character content
    if (/[^\x00-\x7F]/.test(text)) {
      multiplier *= 0.95; // Non-ASCII characters may be more efficiently tokenized
    }
    
    // Use the more conservative (higher) estimate between the two methods
    const openaiBasedTokens = Math.ceil(openaiTokens * multiplier);
    const estimatedTokens = Math.max(characterBasedTokens, openaiBasedTokens);
    
    logger.debug(`Gemini token estimation`, {
      textLength,
      openaiTokens,
      characterBasedTokens,
      multiplier,
      openaiBasedTokens,
      estimatedTokens
    });
    
    return estimatedTokens;
  }

  estimateTokens(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  // Chat completion methods
  async chatCompletion(provider, model, messages, options = {}) {
    switch (provider) {
      case 'openai':
        return this.openaiChatCompletion(model, messages, options);
      case 'claude':
        return this.claudeChatCompletion(model, messages, options);
      case 'gemini':
        return this.geminiChatCompletion(model, messages, options);
      case 'ollama':
        return this.ollamaChatCompletion(model, messages, options);
      default:
        throw new Error(`Chat completion not implemented for provider: ${provider}`);
    }
  }

  async openaiChatCompletion(model, messages, options = {}) {
    if (!this.providers.openai) {
      throw new Error('OpenAI provider not initialized');
    }

    const params = {
      model,
      messages,
      stream: options.stream || false,
      max_tokens: options.maxTokens || 1000,
      temperature: options.temperature || 0.7
    };

    if (options.stream) {
      const stream = await this.providers.openai.chat.completions.create(params);
      return stream;
    } else {
      const response = await this.providers.openai.chat.completions.create(params);
      return response;
    }
  }

  async claudeChatCompletion(model, messages, options = {}) {
    if (!this.providers.claude) {
      throw new Error('Claude provider not initialized');
    }

    // Convert OpenAI format to Claude format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const params = {
      model,
      max_tokens: options.maxTokens || 1000,
      messages: conversationMessages,
      stream: options.stream || false,
      temperature: options.temperature || 0.7
    };

    if (systemMessage) {
      params.system = systemMessage.content;
    }

    if (options.stream) {
      const stream = this.providers.claude.messages.stream(params);
      return stream;
    } else {
      const response = await this.providers.claude.messages.create(params);
      return response;
    }
  }

  async geminiChatCompletion(model, messages, options = {}) {
    if (!this.providers.gemini) {
      throw new Error('Gemini provider not initialized');
    }

    try {
      // 1. Extract system prompt and user/assistant messages
      const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
      const conversationMessages = messages.filter(m => m.role !== 'system');

      // 2. Sanitize and format history for Gemini's alternating role requirement
      const history = [];
      let currentRole = 'user';
      let currentParts = [];

      for (const msg of conversationMessages) {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        
        if (role === currentRole) {
          currentParts.push({ text: msg.content });
        } else {
          if (currentParts.length > 0) {
            history.push({ role: currentRole, parts: currentParts.map(p => ({ text: p.text })) });
          }
          currentRole = role;
          currentParts = [{ text: msg.content }];
        }
      }
      if (currentParts.length > 0) {
        history.push({ role: currentRole, parts: currentParts.map(p => ({ text: p.text })) });
      }
      
      // 3. Define safety settings
      const safetySettings = [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ];

      // 4. Get the model
      const geminiModel = this.providers.gemini.getGenerativeModel({ model, safetySettings });

      // 5. Configuration
      const generationConfig = {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 1000,
      };

      // 6. Separate the last message from history
      const lastMessage = history.pop();
      if (!lastMessage || lastMessage.role !== 'user') {
        throw new Error('The last message in the conversation must be from the user.');
      }

      // 7. Start chat with history and system instruction
      const chat = geminiModel.startChat({
        history: history,
        systemInstruction: {
          role: 'user',
          parts: [{ text: systemInstruction }],
        },
      });

      const messageContent = lastMessage.parts.map(p => p.text).join('\n');

      if (options.stream) {
        // Pass generationConfig explicitly to the stream call
        const result = await chat.sendMessageStream(messageContent, generationConfig);
        return result.stream;
      } else {
        // Pass generationConfig explicitly to the non-stream call
        const result = await chat.sendMessage(messageContent, generationConfig);
        const response = await result.response;
        
        return {
          content: [{ text: response.text() }],
          usage: {
            promptTokens: result.response.usageMetadata?.promptTokenCount || 0,
            completionTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: result.response.usageMetadata?.totalTokenCount || 0
          }
        };
      }
    } catch (error) {
      logger.error('Gemini chat completion error:', error);
      if (error.message.includes('SAFETY')) {
          throw new Error(`Gemini API error: The request was blocked by the safety policy. Details: ${error.message}`);
      }
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async ollamaChatCompletion(model, messages, options = {}) {
    if (!this.providers.ollama) {
      throw new Error('Ollama provider not initialized');
    }

    try {
      const ollamaMessages = messages.map(msg => ({
        role: msg.role === 'system' ? 'system' : (msg.role === 'assistant' ? 'assistant' : 'user'),
        content: msg.content,
      }));

      // Get model details to set context window
      const allModels = await this.getOllamaModels();
      const modelDetails = allModels.find(m => m.id === model);
      const contextLength = modelDetails?.contextLength || 4096; // Default to 4096 if not found

      const request = {
        model: model,
        messages: ollamaMessages,
        stream: options.stream || false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1000,
          num_ctx: contextLength
        },
      };

      if (options.stream) {
        const responseStream = await this.providers.ollama.chat(request);
        return responseStream; // This is already a stream of objects
      } else {
        const response = await this.providers.ollama.chat(request);
        return {
          content: [{ text: response.message.content }],
          usage: {
            promptTokens: response.prompt_eval_count || 0,
            completionTokens: response.eval_count || 0,
            totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
          },
        };
      }
    } catch (error) {
      logger.error('Ollama chat completion error:', error);
      throw new Error(`Ollama API error: ${error.message}`);
    }
  }

  // Cleanup method
  cleanup() {
    if (this.tokenizers.openai) {
      this.tokenizers.openai.free();
    }
  }
}

module.exports = { LLMProviders };
