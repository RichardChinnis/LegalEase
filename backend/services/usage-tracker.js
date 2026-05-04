// backend/services/usage-tracker.js

const { logger } = require('../logger');

class UsageTracker {
  constructor(dbConnection, eventEmitter) {
    this.activeConversations = new Map();
    this.dailyLimits = new Map(); // In a real app, this would be configurable
    this.costAlerts = new Map();
    this.db = dbConnection; // For persistent storage
    this.emitter = eventEmitter; // For real-time communication (e.g., WebSockets)

    // Set default limits
    this.dailyLimits.set('global', { cost: 50.00, tokens: 5000000 });
  }

  // Start tracking a new conversation
  trackConversationStart(conversationId, config) {
    if (!conversationId || !config) {
      logger.warn('UsageTracker: conversationId and config are required to start tracking.');
      return;
    }

    const conversationState = {
      startTime: Date.now(),
      provider: config.provider,
      model: config.model,
      initialCost: config.contextCost || 0,
      totalTokens: config.contextTokens || 0,
      totalCost: config.contextCost || 0,
      messageCount: 0,
      alerts: [],
      userId: config.userId || 'anonymous'
    };

    this.activeConversations.set(conversationId, conversationState);
    logger.info(`Started tracking conversation: ${conversationId}`, { model: config.model });

    // Persist session start to the database
    this.saveUsageSession(conversationId, conversationState);
  }

  // Track the cost of a single message exchange
  trackMessageCost(conversationId, inputTokens, outputTokens, cost) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) {
      logger.warn(`UsageTracker: Cannot track message cost for untracked conversation: ${conversationId}`);
      return;
    }

    conversation.totalTokens += inputTokens + outputTokens;
    conversation.totalCost += cost;
    conversation.messageCount++;
    conversation.lastUpdated = Date.now();

    // Check for and emit any real-time cost alerts
    this.checkCostAlerts(conversationId, conversation);

    // Persist the message-level usage data
    this.saveUsageMessage(conversationId, { inputTokens, outputTokens, cost });
  }

  // Check for cost overruns or other alert-worthy conditions
  checkCostAlerts(conversationId, conversation) {
    const alerts = [];
    const avgCostPerMessage = conversation.totalCost / conversation.messageCount;

    // Alert 1: High cost for a single message
    if (avgCostPerMessage > 0.05) { // $0.05
      alerts.push({
        type: 'high_message_cost',
        message: `High cost per message: $${avgCostPerMessage.toFixed(3)}`,
        level: 'warning'
      });
    }

    // Alert 2: High total cost for the conversation
    if (conversation.totalCost > 1.00) { // $1.00
      alerts.push({
        type: 'high_total_cost',
        message: `Conversation cost approaching limit: $${conversation.totalCost.toFixed(2)}`,
        level: 'danger'
      });
    }

    // In a real implementation, you would also check against user/global daily limits
    // const dailyUsage = this.getDailyUsage(conversation.userId);
    // if (dailyUsage.cost > this.dailyLimits.get('global').cost) { ... }

    if (alerts.length > 0) {
      conversation.alerts = alerts;
      this.emitCostAlerts(conversationId, alerts);
    }
  }

  // Emit alerts to the frontend via a dedicated channel
  emitCostAlerts(conversationId, alerts) {
    if (this.emitter) {
      this.emitter.emit(`conversation-alert:${conversationId}`, {
        type: 'cost_alert',
        alerts
      });
      logger.info(`Emitted ${alerts.length} cost alerts for conversation ${conversationId}`);
    }
  }

  // End tracking for a conversation
  trackConversationEnd(conversationId) {
    const conversation = this.activeConversations.get(conversationId);
    if (conversation) {
      conversation.endTime = Date.now();
      this.updateUsageSession(conversationId, conversation);
      this.activeConversations.delete(conversationId);
      logger.info(`Stopped tracking conversation: ${conversationId}`);
    }
  }

  // --- Database Persistence Methods ---

  async saveUsageSession(conversationId, sessionData) {
    if (!this.db) return;
    const query = `
      INSERT INTO usage_sessions (id, conversation_id, provider, model, start_time, total_cost, total_tokens, message_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    const values = [
      require('crypto').randomUUID(),
      conversationId,
      sessionData.provider,
      sessionData.model,
      new Date(sessionData.startTime),
      sessionData.totalCost,
      sessionData.totalTokens,
      sessionData.messageCount
    ];
    try {
      await this.db.query(query, values);
    } catch (error) {
      logger.error('Failed to save usage session to database:', error);
    }
  }

  async updateUsageSession(conversationId, sessionData) {
    if (!this.db) return;
    const query = `
      UPDATE usage_sessions
      SET end_time = $1, total_cost = $2, total_tokens = $3, message_count = $4
      WHERE conversation_id = $5
    `;
    const values = [
      new Date(sessionData.endTime),
      sessionData.totalCost,
      sessionData.totalTokens,
      sessionData.messageCount,
      conversationId
    ];
    try {
      await this.db.query(query, values);
    } catch (error) {
      logger.error('Failed to update usage session in database:', error);
    }
  }

  async saveUsageMessage(conversationId, messageData) {
    if (!this.db) return;
    // First, get the session_id for the given conversationId
    const sessionRes = await this.db.query('SELECT id FROM usage_sessions WHERE conversation_id = $1 ORDER BY start_time DESC LIMIT 1', [conversationId]);
    if (sessionRes.rows.length === 0) {
      logger.warn(`Could not find session for conversation_id ${conversationId} to save message usage.`);
      return;
    }
    const sessionId = sessionRes.rows[0].id;

    const query = `
      INSERT INTO usage_messages (id, session_id, input_tokens, output_tokens, cost)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const values = [
      require('crypto').randomUUID(),
      sessionId,
      messageData.inputTokens,
      messageData.outputTokens,
      messageData.cost
    ];
    try {
      await this.db.query(query, values);
    } catch (error) {
      logger.error('Failed to save usage message to database:', error);
    }
  }

  // --- Analytics Methods ---

  async getUsageStats(timeframe = 'day') {
    if (!this.db) {
      logger.warn('UsageTracker: Cannot get usage stats without a database connection.');
      return { error: 'Database not configured' };
    }
    // This would contain complex SQL queries to aggregate data
    return {
      totalCost: 0,
      totalTokens: 0,
      conversationCount: 0,
      averageCostPerConversation: 0,
      topModels: [],
      costBreakdown: {}
    };
  }
}

module.exports = { UsageTracker };
