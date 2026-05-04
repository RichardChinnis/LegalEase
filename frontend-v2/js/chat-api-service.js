// Chat API Service - extends existing API service with chat-specific endpoints
class ChatAPIService {
    constructor(apiService) {
        this.api = apiService;
        this.baseURL = '/api/chat';
    }

    // Provider and model management
    async getProviders() {
        const response = await this.api.get(`${this.baseURL}/providers`);
        return response.data;
    }

    async getModels(provider) {
        const response = await this.api.get(`${this.baseURL}/providers/${provider}/models`);
        return response.data;
    }

    // Token estimation
    async estimateTokens(billInfo, contextConfig, provider, additionalText = '', committeeReportText = '', hearingText = '') {
        const response = await this.api.post(`${this.baseURL}/estimate-tokens`, {
            billInfo,
            contextConfig,
            provider,
            additionalText,
            committeeReportText,
            hearingText
        });
        return response.data;
    }

    // Enhanced cost analysis
    async getCostAnalysis(billInfo, contextConfig, provider, model, conversationOptions = {}) {
        const response = await this.api.post(`${this.baseURL}/cost-analysis`, {
            billInfo,
            contextConfig,
            provider,
            model,
            conversationOptions
        });
        return response.data;
    }

    // Conversation management
    async createConversation(billInfo, contextConfig, provider, model, textContent = '') {
        // Determine if this is a hearing or bill and set appropriate field
        const requestBody = {
            billInfo,
            contextConfig,
            provider,
            model
        };

        if (billInfo.contentType === 'hearing') {
            requestBody.hearingText = textContent;
        } else {
            requestBody.committeeReportText = textContent;
        }

        const response = await this.api.post(`${this.baseURL}/conversations`, requestBody);

        // The API service wraps POST responses in { data: ... }
        const conversationData = response.data;
        
        if (conversationData && conversationData.fullContextPrompt && typeof AppState !== 'undefined') {
            AppState.currentChatContext = conversationData.fullContextPrompt;
        }
        
        return conversationData;
    }

    async getConversation(conversationId) {
        const response = await this.api.get(`${this.baseURL}/conversations/${conversationId}`);
        return response.data;
    }

    async deleteConversation(conversationId) {
        const response = await this.api.delete(`${this.baseURL}/conversations/${conversationId}`);
        return response.data;
    }

    // Messaging
    async sendMessage(conversationId, message, options = {}) {
        const response = await this.api.post(`${this.baseURL}/conversations/${conversationId}/messages`, {
            message,
            maxTokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        });
        return response.data;
    }

    async streamMessage(conversationId, message, options = {}) {
        const response = await fetch(`${this.baseURL}/conversations/${conversationId}/messages/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify({
                message,
                maxTokens: options.maxTokens || 1000,
                temperature: options.temperature || 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        if (!response.body) {
            throw new Error('Response has no body or is not a stream.');
        }
        return response.body;
    }

    // Context management
    async updateContext(conversationId, config, committeeReportText = '', hearingText = '') {
        const requestBody = { 
            config: config, 
            committeeReportText,
            hearingText 
        };
        
        const response = await this.api.put(`${this.baseURL}/conversations/${conversationId}/context`, requestBody);
        
        const updatedData = response; // PUT returns JSON directly
        if (updatedData && updatedData.fullContextPrompt && typeof AppState !== 'undefined') {
            AppState.currentChatContext = updatedData.fullContextPrompt;
        }
        
        return updatedData;
    }

    async estimateMessageTokens(conversationId, message) {
        const response = await this.api.post(`${this.baseURL}/conversations/${conversationId}/estimate-tokens`, {
            message
        });
        return response.data;
    }
}

// Add POST, PUT, DELETE methods to the base API service if they don't exist
if (typeof API !== 'undefined' && API) {
    if (!API.post) {
        API.post = async function(endpoint, data) {
            try {
                const response = await fetch(`${this.base}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            } catch (error) {
                console.error(`[API.post] Error for ${endpoint}:`, error);
                throw error;
            }
        };
    }
    if (!API.put) {
        API.put = async function(endpoint, data) {
            try {
                const response = await fetch(`${this.base}${endpoint}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            } catch (error) {
                console.error(`[API.put] Error for ${endpoint}:`, error);
                throw error;
            }
        };
    }
    if (!API.delete) {
        API.delete = async function(endpoint) {
            try {
                const response = await fetch(`${this.base}${endpoint}`, { method: 'DELETE' });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            } catch (error) {
                console.error(`[API.delete] Error for ${endpoint}:`, error);
                throw error;
            }
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatAPIService;
} else {
    window.ChatAPIService = ChatAPIService;
}

// Initialize global chatAPI instance when API is available
document.addEventListener('DOMContentLoaded', () => {
    if (typeof API !== 'undefined' && API) {
        window.chatAPI = new ChatAPIService(API);
        console.log('[ChatAPIService] Global chatAPI initialized');
    }
});