const { Pool } = require('pg');
const { logger } = require('../logger');

class DatabaseService {
  constructor(config = {}) {
    this.config = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || process.env.DB_PORT || 5432,
      database: config.database || process.env.DB_DATABASE || process.env.DB_NAME || 'congress-api',
      user: config.user || process.env.DB_USER || 'congress_api_backend',
      password: config.password || process.env.DB_PASSWORD || '',
      max: config.maxConnections || 20,
      idleTimeoutMillis: config.idleTimeout || 30000,
      connectionTimeoutMillis: config.connectionTimeout || 5000,
      ssl: (config.ssl || process.env.DB_SSL === 'true') ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false
    };

    this.pool = new Pool(this.config);
    this.setupPoolEventHandlers();
  }

  setupPoolEventHandlers() {
    this.pool.on('connect', (client) => {
      logger.debug('Database client connected', { 
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount 
      });
    });

    this.pool.on('error', (err, client) => {
      logger.error('Database pool error', { error: err.message, stack: err.stack });
    });

    this.pool.on('remove', (client) => {
      logger.debug('Database client removed', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      });
    });
  }

  async query(text, params = []) {
    const start = Date.now();
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Database query executed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params: params.length > 0 ? '[' + params.length + ' params]' : 'none',
        duration: `${duration}ms`,
        rows: result.rowCount
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Database query error', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params: params.length > 0 ? '[' + params.length + ' params]' : 'none',
        duration: `${duration}ms`,
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Database transaction rolled back', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection() {
    try {
      const result = await this.query('SELECT NOW() as current_time, version() as version');
      logger.info('Database connection test successful', {
        currentTime: result.rows[0].current_time,
        version: result.rows[0].version.split(' ')[0]
      });
      return true;
    } catch (error) {
      logger.error('Database connection test failed', {
        error: error.message,
        config: {
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user
        }
      });
      throw error;
    }
  }

  async getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };
  }

  async close() {
    try {
      await this.pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database pool', { error: error.message });
      throw error;
    }
  }
}

// Conversation-specific database operations
class ConversationRepository {
  constructor(database) {
    this.db = database;
  }

  async createConversation(conversationData) {
    const {
      id,
      billInfo,
      provider,
      model,
      contextConfig,
      context,
      tokenCount,
      isHearing = false
    } = conversationData;

    const query = `
      INSERT INTO chat_conversations (
        id, bill_type, bill_number, bill_congress, bill_title, jacket_number,
        provider, model, context_config, context_data, token_count, is_hearing
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const params = [
      id,
      billInfo.type || null,
      billInfo.number || null,
      billInfo.congress || null,
      billInfo.title || null,
      billInfo.jacketNumber || null,
      provider,
      model,
      JSON.stringify(contextConfig),
      JSON.stringify(context),
      tokenCount,
      isHearing
    ];

    const result = await this.db.query(query, params);
    return result.rows[0];
  }

  async getConversation(conversationId) {
    const query = `
      SELECT c.*, 
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', m.id,
                   'role', m.role,
                   'content', m.content,
                   'tokenCount', m.token_count,
                   'tokenUsage', m.token_usage,
                   'streaming', m.streaming,
                   'timestamp', m.created_at,
                   'error', m.error_message
                 ) ORDER BY m.created_at
               ) FILTER (WHERE m.id IS NOT NULL),
               '[]'::json
             ) as messages
      FROM chat_conversations c
      LEFT JOIN chat_messages m ON c.id = m.conversation_id
      WHERE c.id = $1
      GROUP BY c.id
    `;

    const result = await this.db.query(query, [conversationId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.mapRowToConversation(row);
  }

  async updateConversation(conversationId, updates) {
    const allowedFields = ['provider', 'model', 'context_config', 'context_data', 'token_count'];
    const setClause = [];
    const params = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex}`);
        params.push(typeof value === 'object' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    });

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(conversationId);
    const query = `
      UPDATE chat_conversations 
      SET ${setClause.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query(query, params);
    return result.rows[0];
  }

  async addMessage(conversationId, messageData) {
    const {
      id,
      role,
      content,
      tokenCount,
      tokenUsage,
      streaming = false,
      errorMessage = null
    } = messageData;

    const query = `
      INSERT INTO chat_messages (
        id, conversation_id, role, content, token_count, 
        token_usage, streaming, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const params = [
      id,
      conversationId,
      role,
      content,
      tokenCount,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      streaming,
      errorMessage
    ];

    const result = await this.db.query(query, params);
    return result.rows[0];
  }

  async updateMessage(messageId, updates) {
    const allowedFields = ['content', 'token_count', 'token_usage', 'streaming', 'error_message'];
    const setClause = [];
    const params = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        setClause.push(`${dbField} = $${paramIndex}`);
        params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
        paramIndex++;
      }
    });

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(messageId);
    const query = `
      UPDATE chat_messages 
      SET ${setClause.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query(query, params);
    return result.rows[0];
  }

  async deleteConversation(conversationId) {
    // Messages will be deleted automatically due to CASCADE
    const query = 'DELETE FROM chat_conversations WHERE id = $1 RETURNING id';
    const result = await this.db.query(query, [conversationId]);
    return result.rows.length > 0;
  }

  async listConversations(limit = 50, offset = 0) {
    const query = `
      SELECT * FROM chat_conversation_summaries
      ORDER BY updated_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.db.query(query, [limit, offset]);
    return result.rows;
  }

  async cleanupOldConversations(olderThanDays = 30) {
    const query = `
      DELETE FROM chat_conversations
      WHERE updated_at < NOW() - INTERVAL '1 day' * $1
      RETURNING id
    `;

    const result = await this.db.query(query, [olderThanDays]);
    return result.rows.length;
  }

  mapRowToConversation(row) {
    return {
      id: row.id,
      billInfo: {
        type: row.bill_type,
        number: row.bill_number,
        congress: row.bill_congress,
        title: row.bill_title,
        jacketNumber: row.jacket_number
      },
      provider: row.provider,
      model: row.model,
      contextConfig: row.context_config,
      context: row.context_data,
      messages: row.messages || [],
      tokenCount: row.token_count,
      isHearing: row.is_hearing,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = { DatabaseService, ConversationRepository };
