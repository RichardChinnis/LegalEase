#!/usr/bin/env node
/**
 * Database Migration Runner
 * Usage: node migrate.js [up|down] [migration_name]
 * Examples:
 *   node migrate.js up 001_add_congressional_schema
 *   node migrate.js down 001_add_congressional_schema
 *   node migrate.js up (runs all pending migrations)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseService } = require('../services/database');
const { logger } = require('../logger');

class MigrationRunner {
  constructor() {
    this.db = new DatabaseService();
    this.migrationDir = __dirname;
  }

  async ensureMigrationTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id VARCHAR(255) PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    try {
      await this.db.query(createTableSQL);
      logger.info('Migration tracking table ensured');
    } catch (error) {
      logger.error('Failed to create migration tracking table', { error: error.message });
      throw error;
    }
  }

  async getAppliedMigrations() {
    try {
      const result = await this.db.query('SELECT migration_id FROM schema_migrations ORDER BY applied_at');
      return result.rows.map(row => row.migration_id);
    } catch (error) {
      logger.error('Failed to get applied migrations', { error: error.message });
      return [];
    }
  }

  async getPendingMigrations() {
    const applied = await this.getAppliedMigrations();
    const allMigrations = fs.readdirSync(this.migrationDir)
      .filter(file => file.match(/^\d{3}_.*\.sql$/) && !file.includes('_rollback'))
      .map(file => file.replace('.sql', ''))
      .sort();
    
    return allMigrations.filter(migration => !applied.includes(migration));
  }

  async runMigration(migrationName) {
    const migrationFile = path.join(this.migrationDir, `${migrationName}.sql`);
    
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found: ${migrationFile}`);
    }

    logger.info(`Running migration: ${migrationName}`);
    
    try {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      await this.db.query(sql);
      logger.info(`Migration completed successfully: ${migrationName}`);
    } catch (error) {
      logger.error(`Migration failed: ${migrationName}`, { error: error.message });
      throw error;
    }
  }

  async rollbackMigration(migrationName) {
    const rollbackFile = path.join(this.migrationDir, `${migrationName}_rollback.sql`);
    
    if (!fs.existsSync(rollbackFile)) {
      throw new Error(`Rollback file not found: ${rollbackFile}`);
    }

    logger.info(`Rolling back migration: ${migrationName}`);
    
    try {
      const sql = fs.readFileSync(rollbackFile, 'utf8');
      await this.db.query(sql);
      logger.info(`Migration rolled back successfully: ${migrationName}`);
    } catch (error) {
      logger.error(`Migration rollback failed: ${migrationName}`, { error: error.message });
      throw error;
    }
  }

  async runAllPendingMigrations() {
    await this.ensureMigrationTable();
    const pending = await this.getPendingMigrations();
    
    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Running ${pending.length} pending migrations: ${pending.join(', ')}`);
    
    for (const migration of pending) {
      await this.runMigration(migration);
    }
    
    logger.info('All migrations completed successfully');
  }

  async showStatus() {
    await this.ensureMigrationTable();
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();
    
    console.log('\n=== Migration Status ===');
    console.log(`Applied migrations (${applied.length}):`);
    applied.forEach(migration => console.log(`  ✓ ${migration}`));
    
    console.log(`\nPending migrations (${pending.length}):`);
    pending.forEach(migration => console.log(`  ○ ${migration}`));
    
    if (pending.length === 0) {
      console.log('\n🎉 All migrations are up to date!');
    }
  }

  async close() {
    await this.db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const migrationName = args[1];

  const runner = new MigrationRunner();

  try {
    await runner.db.testConnection();
    
    switch (command) {
      case 'up':
        if (migrationName) {
          await runner.ensureMigrationTable();
          await runner.runMigration(migrationName);
        } else {
          await runner.runAllPendingMigrations();
        }
        break;
        
      case 'down':
        if (!migrationName) {
          throw new Error('Migration name is required for rollback');
        }
        await runner.rollbackMigration(migrationName);
        break;
        
      case 'status':
        await runner.showStatus();
        break;
        
      default:
        console.log('Usage: node migrate.js [up|down|status] [migration_name]');
        console.log('');
        console.log('Commands:');
        console.log('  up                    - Run all pending migrations');
        console.log('  up <migration_name>   - Run specific migration');
        console.log('  down <migration_name> - Rollback specific migration');
        console.log('  status                - Show migration status');
        console.log('');
        console.log('Examples:');
        console.log('  node migrate.js status');
        console.log('  node migrate.js up');
        console.log('  node migrate.js up 001_add_congressional_schema');
        console.log('  node migrate.js down 001_add_congressional_schema');
        process.exit(1);
    }
    
  } catch (error) {
    logger.error('Migration command failed', { error: error.message });
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await runner.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { MigrationRunner };