#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Load environment variables from backend/.env
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const { DatabaseService } = require('../backend/services/database');

class MigrationRunner {
  constructor() {
    // Use direct database configuration from config
    const config = require('../backend/config');
    this.database = new DatabaseService(config.database);
    this.migrationsDir = path.join(__dirname, 'migrations');
  }

  async createMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    await this.database.query(query);
    console.log('Migrations table ready');
  }

  async getExecutedMigrations() {
    try {
      const result = await this.database.query('SELECT filename FROM migrations ORDER BY id');
      return result.rows.map(row => row.filename);
    } catch (error) {
      // If migrations table doesn't exist, return empty array
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }

  async getPendingMigrations() {
    const files = await fs.readdir(this.migrationsDir);
    const migrationFiles = files
      .filter(file => file.endsWith('.sql') && !file.includes('_rollback'))
      .sort();

    const executed = await this.getExecutedMigrations();
    return migrationFiles.filter(file => !executed.includes(file));
  }

  async executeMigration(filename) {
    const filePath = path.join(this.migrationsDir, filename);
    const sql = await fs.readFile(filePath, 'utf-8');

    console.log(`Executing migration: ${filename}`);

    await this.database.transaction(async (client) => {
      // Execute the migration SQL
      await client.query(sql);
      
      // Record the migration as executed
      await client.query(
        'INSERT INTO migrations (filename) VALUES ($1)',
        [filename]
      );
    });

    console.log(`✓ Migration completed: ${filename}`);
  }

  async runMigrations() {
    try {
      console.log('Starting database migration...');
      
      // Test database connection
      await this.database.testConnection();
      
      // Create migrations table if it doesn't exist
      await this.createMigrationsTable();
      
      // Get pending migrations
      const pending = await this.getPendingMigrations();
      
      if (pending.length === 0) {
        console.log('No pending migrations');
        return;
      }

      console.log(`Found ${pending.length} pending migrations:`);
      pending.forEach(file => console.log(`  - ${file}`));
      
      // Execute each migration
      for (const filename of pending) {
        await this.executeMigration(filename);
      }
      
      console.log('\n✓ All migrations completed successfully');
      
    } catch (error) {
      console.error('Migration failed:', error.message);
      process.exit(1);
    } finally {
      await this.database.close();
    }
  }

  async rollbackLastMigration() {
    try {
      console.log('Rolling back last migration...');
      
      await this.database.testConnection();
      
      const result = await this.database.query(
        'SELECT filename FROM migrations ORDER BY id DESC LIMIT 1'
      );
      
      if (result.rows.length === 0) {
        console.log('No migrations to rollback');
        return;
      }
      
      const lastMigration = result.rows[0].filename;
      console.log(`Rolling back: ${lastMigration}`);
      
      // Check if rollback file exists
      const rollbackFile = lastMigration.replace('.sql', '_rollback.sql');
      const rollbackPath = path.join(this.migrationsDir, rollbackFile);
      
      try {
        const rollbackSql = await fs.readFile(rollbackPath, 'utf-8');
        
        await this.database.transaction(async (client) => {
          // Execute rollback SQL
          await client.query(rollbackSql);
          
          // Remove migration record
          await client.query(
            'DELETE FROM migrations WHERE filename = $1',
            [lastMigration]
          );
        });
        
        console.log(`✓ Rollback completed: ${lastMigration}`);
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.error(`Rollback file not found: ${rollbackFile}`);
          console.error('Manual rollback required');
        } else {
          throw error;
        }
      }
      
    } catch (error) {
      console.error('Rollback failed:', error.message);
      process.exit(1);
    } finally {
      await this.database.close();
    }
  }
}

// Command line interface
async function main() {
  const command = process.argv[2];
  const runner = new MigrationRunner();
  
  switch (command) {
    case 'up':
    case undefined:
      await runner.runMigrations();
      break;
      
    case 'rollback':
      await runner.rollbackLastMigration();
      break;
      
    default:
      console.log('Usage:');
      console.log('  node migrate.js up       - Run pending migrations');
      console.log('  node migrate.js rollback - Rollback last migration');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MigrationRunner };