// Usage Tracker Service - Real-time cost monitoring and analytics
class UsageTracker {
    constructor(tokenEstimator, chatAPI) {
        this.tokenEstimator = tokenEstimator;
        this.chatAPI = chatAPI;
        this.isTracking = false;
        this.sessionData = {
            startTime: null,
            conversations: [],
            totalCost: 0,
            totalTokens: 0,
            messageCount: 0
        };
        
        // Real-time tracking data
        this.currentConversation = null;
        this.realtimeCallbacks = new Set();
        this.alertCallbacks = new Set();
        this.updateInterval = null;
        
        // Usage statistics
        this.dailyStats = new Map();
        this.modelUsage = new Map();
        this.providerUsage = new Map();
        
        // Alert thresholds
        this.alertThresholds = {
            dailyCost: 5.00,
            conversationCost: 1.00,
            tokenLimit: 100000,
            costPerToken: 0.0001
        };
        
        // Storage keys
        this.storageKeys = {
            sessionData: 'usage_tracker_session',
            dailyStats: 'usage_tracker_daily',
            alertThresholds: 'usage_tracker_alerts',
            preferences: 'usage_tracker_preferences'
        };
        
        this.loadStoredData();
    }
    
    // Start tracking a new session
    startTracking() {
        if (this.isTracking) {
            return;
        }
        
        this.isTracking = true;
        this.sessionData = {
            startTime: Date.now(),
            conversations: [],
            totalCost: 0,
            totalTokens: 0,
            messageCount: 0
        };
        
        // Start periodic updates
        this.updateInterval = setInterval(() => {
            this.updateRealtimeData();
        }, 1000); // Update every second
        
        this.notifyRealtimeUpdate('session_started', this.sessionData);
    }
    
    // Stop tracking session
    stopTracking() {
        if (!this.isTracking) {
            return;
        }
        
        this.isTracking = false;
        
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        // Save final session data
        this.saveSessionData();
        
        this.notifyRealtimeUpdate('session_ended', this.sessionData);
    }
    
    // Track the start of a conversation
    startConversation(billInfo, provider, model, contextConfig) {
        if (!this.isTracking) {
            this.startTracking();
        }
        
        this.currentConversation = {
            id: this.generateConversationId(),
            billInfo,
            provider,
            model,
            contextConfig,
            startTime: Date.now(),
            messages: [],
            totalCost: 0,
            totalTokens: 0,
            status: 'active'
        };
        
        this.sessionData.conversations.push(this.currentConversation);
        
        this.notifyRealtimeUpdate('conversation_started', this.currentConversation);
        
        return this.currentConversation.id;
    }
    
    // Track a message in the current conversation
    async trackMessage(messageData) {
        if (!this.currentConversation || !this.isTracking) {
            return;
        }
        
        const conversationId = this.currentConversation.id;
        
        try {
            // Calculate actual token usage and cost
            const tokenAnalysis = await this.analyzeMessageTokens(messageData);
            const costAnalysis = await this.calculateMessageCost(messageData, tokenAnalysis);
            
            const trackedMessage = {
                id: this.generateMessageId(),
                conversationId,
                timestamp: Date.now(),
                type: messageData.type || 'user', // 'user' or 'assistant'
                content: messageData.content,
                tokenUsage: tokenAnalysis,
                cost: costAnalysis,
                provider: this.currentConversation.provider,
                model: this.currentConversation.model
            };
            
            // Add to current conversation
            this.currentConversation.messages.push(trackedMessage);
            this.currentConversation.totalCost += costAnalysis.total;
            this.currentConversation.totalTokens += tokenAnalysis.total;
            
            // Update session totals
            this.sessionData.totalCost += costAnalysis.total;
            this.sessionData.totalTokens += tokenAnalysis.total;
            this.sessionData.messageCount++;
            
            // Update usage statistics
            this.updateUsageStats(trackedMessage);
            
            // Check for alerts
            this.checkAlerts(trackedMessage);
            
            // Save data
            this.saveSessionData();
            
            this.notifyRealtimeUpdate('message_tracked', trackedMessage);
            
            return trackedMessage;
            
        } catch (error) {
            throw error;
        }
    }
    
    // End the current conversation
    endConversation() {
        if (!this.currentConversation) {
            return;
        }
        
        this.currentConversation.endTime = Date.now();
        this.currentConversation.duration = this.currentConversation.endTime - this.currentConversation.startTime;
        this.currentConversation.status = 'completed';
        
        const conversationSummary = {
            id: this.currentConversation.id,
            duration: this.currentConversation.duration,
            messageCount: this.currentConversation.messages.length,
            totalCost: this.currentConversation.totalCost,
            totalTokens: this.currentConversation.totalTokens,
            averageCostPerMessage: this.currentConversation.totalCost / Math.max(1, this.currentConversation.messages.length),
            provider: this.currentConversation.provider,
            model: this.currentConversation.model
        };
        
        this.notifyRealtimeUpdate('conversation_ended', conversationSummary);
        
        this.currentConversation = null;
        return conversationSummary;
    }
    
    // Analyze token usage for a message
    async analyzeMessageTokens(messageData) {
        try {
            let inputTokens = 0;
            let outputTokens = 0;
            
            if (messageData.type === 'user') {
                // For user messages, count input tokens
                inputTokens = await this.tokenEstimator.estimateTokens(
                    messageData.content,
                    this.currentConversation.provider,
                    this.currentConversation.model
                );
            } else {
                // For assistant messages, count output tokens
                outputTokens = await this.tokenEstimator.estimateTokens(
                    messageData.content,
                    this.currentConversation.provider,
                    this.currentConversation.model
                );
            }
            
            return {
                input: inputTokens,
                output: outputTokens,
                total: inputTokens + outputTokens
            };
            
        } catch (error) {
            // Fallback to character-based estimation
            const estimatedTokens = Math.ceil(messageData.content.length / 4);
            return {
                input: messageData.type === 'user' ? estimatedTokens : 0,
                output: messageData.type === 'assistant' ? estimatedTokens : 0,
                total: estimatedTokens
            };
        }
    }
    
    // Calculate cost for a message
    async calculateMessageCost(messageData, tokenAnalysis) {
        try {
            // Get current model pricing
            const modelConfig = await this.getModelConfig(
                this.currentConversation.provider,
                this.currentConversation.model
            );
            
            if (!modelConfig || !modelConfig.costPer1kTokens) {
                return { input: 0, output: 0, total: 0 };
            }
            
            const inputCost = (tokenAnalysis.input / 1000) * modelConfig.costPer1kTokens.input;
            let outputCost = (tokenAnalysis.output / 1000) * modelConfig.costPer1kTokens.output;
            
            // Apply output multipliers for reasoning models
            if (modelConfig.outputMultiplier) {
                outputCost *= modelConfig.outputMultiplier;
            }
            
            return {
                input: inputCost,
                output: outputCost,
                total: inputCost + outputCost,
                tokensUsed: tokenAnalysis.total,
                pricePerToken: (inputCost + outputCost) / Math.max(1, tokenAnalysis.total)
            };
            
        } catch (error) {
            return { input: 0, output: 0, total: 0 };
        }
    }
    
    // Get model configuration
    async getModelConfig(provider, modelId) {
        try {
            const response = await this.chatAPI.getModels(provider);
            const models = response.models || [];
            return models.find(m => m.id === modelId);
        } catch (error) {
            return null;
        }
    }
    
    // Update usage statistics
    updateUsageStats(message) {
        const today = new Date().toISOString().split('T')[0];
        const providerModel = `${message.provider}/${message.model}`;
        
        // Daily stats
        if (!this.dailyStats.has(today)) {
            this.dailyStats.set(today, {
                date: today,
                totalCost: 0,
                totalTokens: 0,
                messageCount: 0,
                conversations: 0,
                providers: new Set(),
                models: new Set()
            });
        }
        
        const dailyStat = this.dailyStats.get(today);
        dailyStat.totalCost += message.cost.total;
        dailyStat.totalTokens += message.tokenUsage.total;
        dailyStat.messageCount++;
        dailyStat.providers.add(message.provider);
        dailyStat.models.add(providerModel);
        
        // Model usage stats
        if (!this.modelUsage.has(providerModel)) {
            this.modelUsage.set(providerModel, {
                provider: message.provider,
                model: message.model,
                totalCost: 0,
                totalTokens: 0,
                messageCount: 0,
                averageCostPerMessage: 0,
                averageCostPerToken: 0,
                lastUsed: null
            });
        }
        
        const modelStat = this.modelUsage.get(providerModel);
        modelStat.totalCost += message.cost.total;
        modelStat.totalTokens += message.tokenUsage.total;
        modelStat.messageCount++;
        modelStat.averageCostPerMessage = modelStat.totalCost / modelStat.messageCount;
        modelStat.averageCostPerToken = modelStat.totalCost / Math.max(1, modelStat.totalTokens);
        modelStat.lastUsed = Date.now();
        
        // Provider usage stats
        if (!this.providerUsage.has(message.provider)) {
            this.providerUsage.set(message.provider, {
                provider: message.provider,
                totalCost: 0,
                totalTokens: 0,
                messageCount: 0,
                modelCount: 0,
                models: new Set()
            });
        }
        
        const providerStat = this.providerUsage.get(message.provider);
        providerStat.totalCost += message.cost.total;
        providerStat.totalTokens += message.tokenUsage.total;
        providerStat.messageCount++;
        providerStat.models.add(message.model);
        providerStat.modelCount = providerStat.models.size;
        
        this.saveUsageStats();
    }
    
    // Check for alerts and warnings
    checkAlerts(message) {
        const alerts = [];
        const today = new Date().toISOString().split('T')[0];
        const dailyStat = this.dailyStats.get(today);
        
        // Daily cost alert
        if (dailyStat && dailyStat.totalCost > this.alertThresholds.dailyCost) {
            alerts.push({
                type: 'daily_cost_exceeded',
                level: 'warning',
                message: `Daily cost limit exceeded: $${dailyStat.totalCost.toFixed(2)} > $${this.alertThresholds.dailyCost.toFixed(2)}`,
                data: { current: dailyStat.totalCost, threshold: this.alertThresholds.dailyCost }
            });
        }
        
        // Conversation cost alert
        if (this.currentConversation && this.currentConversation.totalCost > this.alertThresholds.conversationCost) {
            alerts.push({
                type: 'conversation_cost_high',
                level: 'warning',
                message: `Current conversation cost is high: $${this.currentConversation.totalCost.toFixed(2)}`,
                data: { 
                    conversationId: this.currentConversation.id,
                    cost: this.currentConversation.totalCost,
                    threshold: this.alertThresholds.conversationCost
                }
            });
        }
        
        // High cost per token alert
        if (message.cost.pricePerToken > this.alertThresholds.costPerToken) {
            alerts.push({
                type: 'high_cost_per_token',
                level: 'info',
                message: `High cost per token detected: $${message.cost.pricePerToken.toFixed(6)} per token`,
                data: { 
                    costPerToken: message.cost.pricePerToken,
                    provider: message.provider,
                    model: message.model
                }
            });
        }
        
        // Notify alerts
        alerts.forEach(alert => {
            this.notifyAlert(alert);
        });
    }
    
    // Real-time data updates
    updateRealtimeData() {
        if (!this.isTracking) {
            return;
        }
        
        const realtimeData = {
            sessionActive: this.isTracking,
            sessionDuration: Date.now() - this.sessionData.startTime,
            sessionStats: {
                totalCost: this.sessionData.totalCost,
                totalTokens: this.sessionData.totalTokens,
                messageCount: this.sessionData.messageCount,
                conversationCount: this.sessionData.conversations.length
            },
            currentConversation: this.currentConversation ? {
                id: this.currentConversation.id,
                duration: Date.now() - this.currentConversation.startTime,
                messageCount: this.currentConversation.messages.length,
                cost: this.currentConversation.totalCost,
                tokens: this.currentConversation.totalTokens
            } : null,
            dailyStats: this.getDailyStats(),
            topModels: this.getTopModels(5),
            recentActivity: this.getRecentActivity(10)
        };
        
        this.notifyRealtimeUpdate('data_update', realtimeData);
    }
    
    // Get daily statistics
    getDailyStats() {
        const today = new Date().toISOString().split('T')[0];
        const dailyStat = this.dailyStats.get(today);
        
        if (!dailyStat) {
            return {
                date: today,
                totalCost: 0,
                totalTokens: 0,
                messageCount: 0,
                conversationCount: 0,
                uniqueProviders: 0,
                uniqueModels: 0
            };
        }
        
        return {
            date: today,
            totalCost: dailyStat.totalCost,
            totalTokens: dailyStat.totalTokens,
            messageCount: dailyStat.messageCount,
            conversationCount: this.sessionData.conversations.length,
            uniqueProviders: dailyStat.providers.size,
            uniqueModels: dailyStat.models.size
        };
    }
    
    // Get top models by usage
    getTopModels(limit = 5) {
        return Array.from(this.modelUsage.values())
            .sort((a, b) => b.totalCost - a.totalCost)
            .slice(0, limit)
            .map(model => ({
                provider: model.provider,
                model: model.model,
                totalCost: model.totalCost,
                messageCount: model.messageCount,
                averageCostPerMessage: model.averageCostPerMessage,
                lastUsed: model.lastUsed
            }));
    }
    
    // Get recent activity
    getRecentActivity(limit = 10) {
        const allMessages = [];
        
        this.sessionData.conversations.forEach(conv => {
            conv.messages.forEach(msg => {
                allMessages.push({
                    id: msg.id,
                    conversationId: msg.conversationId,
                    timestamp: msg.timestamp,
                    type: msg.type,
                    cost: msg.cost.total,
                    tokens: msg.tokenUsage.total,
                    provider: msg.provider,
                    model: msg.model
                });
            });
        });
        
        return allMessages
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }
    
    // Callback registration for real-time updates
    onRealtimeUpdate(callback) {
        this.realtimeCallbacks.add(callback);
        return () => this.realtimeCallbacks.delete(callback);
    }
    
    onAlert(callback) {
        this.alertCallbacks.add(callback);
        return () => this.alertCallbacks.delete(callback);
    }
    
    // Notify callbacks
    notifyRealtimeUpdate(eventType, data) {
        const event = { type: eventType, data, timestamp: Date.now() };
        this.realtimeCallbacks.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
            }
        });
    }
    
    notifyAlert(alert) {
        this.alertCallbacks.forEach(callback => {
            try {
                callback(alert);
            } catch (error) {
            }
        });
    }
    
    // Data persistence
    saveSessionData() {
        try {
            localStorage.setItem(this.storageKeys.sessionData, JSON.stringify(this.sessionData));
        } catch (error) {
        }
    }
    
    saveUsageStats() {
        try {
            const dailyStatsArray = Array.from(this.dailyStats.entries()).map(([date, stats]) => [
                date,
                {
                    ...stats,
                    providers: Array.from(stats.providers),
                    models: Array.from(stats.models)
                }
            ]);
            
            const modelUsageArray = Array.from(this.modelUsage.entries());
            const providerUsageArray = Array.from(this.providerUsage.entries()).map(([provider, stats]) => [
                provider,
                {
                    ...stats,
                    models: Array.from(stats.models)
                }
            ]);
            
            localStorage.setItem(this.storageKeys.dailyStats, JSON.stringify(dailyStatsArray));
            localStorage.setItem('usage_tracker_models', JSON.stringify(modelUsageArray));
            localStorage.setItem('usage_tracker_providers', JSON.stringify(providerUsageArray));
        } catch (error) {
        }
    }
    
    loadStoredData() {
        try {
            // Load session data
            const sessionData = localStorage.getItem(this.storageKeys.sessionData);
            if (sessionData) {
                this.sessionData = JSON.parse(sessionData);
            }
            
            // Load daily stats
            const dailyStats = localStorage.getItem(this.storageKeys.dailyStats);
            if (dailyStats) {
                const parsedStats = JSON.parse(dailyStats);
                this.dailyStats = new Map(parsedStats.map(([date, stats]) => [
                    date,
                    {
                        ...stats,
                        providers: new Set(stats.providers),
                        models: new Set(stats.models)
                    }
                ]));
            }
            
            // Load model usage
            const modelUsage = localStorage.getItem('usage_tracker_models');
            if (modelUsage) {
                this.modelUsage = new Map(JSON.parse(modelUsage));
            }
            
            // Load provider usage
            const providerUsage = localStorage.getItem('usage_tracker_providers');
            if (providerUsage) {
                const parsedProviders = JSON.parse(providerUsage);
                this.providerUsage = new Map(parsedProviders.map(([provider, stats]) => [
                    provider,
                    {
                        ...stats,
                        models: new Set(stats.models)
                    }
                ]));
            }
            
            // Load alert thresholds
            const thresholds = localStorage.getItem(this.storageKeys.alertThresholds);
            if (thresholds) {
                this.alertThresholds = { ...this.alertThresholds, ...JSON.parse(thresholds) };
            }
            
        } catch (error) {
        }
    }
    
    // Utility methods
    generateConversationId() {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Configuration methods
    setAlertThresholds(thresholds) {
        this.alertThresholds = { ...this.alertThresholds, ...thresholds };
        try {
            localStorage.setItem(this.storageKeys.alertThresholds, JSON.stringify(this.alertThresholds));
        } catch (error) {
        }
    }
    
    getAlertThresholds() {
        return { ...this.alertThresholds };
    }
    
    // Analytics and reporting methods
    generateReport(startDate, endDate) {
        const start = new Date(startDate).getTime();
        const end = new Date(endDate).getTime();
        
        const relevantConversations = this.sessionData.conversations.filter(conv => 
            conv.startTime >= start && conv.startTime <= end
        );
        
        const totalCost = relevantConversations.reduce((sum, conv) => sum + conv.totalCost, 0);
        const totalTokens = relevantConversations.reduce((sum, conv) => sum + conv.totalTokens, 0);
        const totalMessages = relevantConversations.reduce((sum, conv) => sum + conv.messages.length, 0);
        
        return {
            period: { startDate, endDate },
            summary: {
                conversationCount: relevantConversations.length,
                totalCost: totalCost,
                totalTokens: totalTokens,
                totalMessages: totalMessages,
                averageCostPerConversation: totalCost / Math.max(1, relevantConversations.length),
                averageCostPerMessage: totalCost / Math.max(1, totalMessages),
                averageTokensPerMessage: totalTokens / Math.max(1, totalMessages)
            },
            conversations: relevantConversations,
            topModels: this.getTopModelsInPeriod(relevantConversations),
            dailyBreakdown: this.getDailyBreakdownInPeriod(start, end)
        };
    }
    
    getTopModelsInPeriod(conversations) {
        const modelStats = new Map();
        
        conversations.forEach(conv => {
            const key = `${conv.provider}/${conv.model}`;
            if (!modelStats.has(key)) {
                modelStats.set(key, {
                    provider: conv.provider,
                    model: conv.model,
                    conversationCount: 0,
                    totalCost: 0,
                    totalTokens: 0,
                    messageCount: 0
                });
            }
            
            const stats = modelStats.get(key);
            stats.conversationCount++;
            stats.totalCost += conv.totalCost;
            stats.totalTokens += conv.totalTokens;
            stats.messageCount += conv.messages.length;
        });
        
        return Array.from(modelStats.values())
            .sort((a, b) => b.totalCost - a.totalCost);
    }
    
    getDailyBreakdownInPeriod(startTime, endTime) {
        const breakdown = new Map();
        
        for (const [date, stats] of this.dailyStats.entries()) {
            const dateTime = new Date(date).getTime();
            if (dateTime >= startTime && dateTime <= endTime) {
                breakdown.set(date, {
                    date,
                    totalCost: stats.totalCost,
                    totalTokens: stats.totalTokens,
                    messageCount: stats.messageCount,
                    providerCount: stats.providers.size,
                    modelCount: stats.models.size
                });
            }
        }
        
        return Array.from(breakdown.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UsageTracker;
} else {
    window.UsageTracker = UsageTracker;
}