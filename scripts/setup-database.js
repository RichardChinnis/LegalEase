#!/usr/bin/env node

// Load environment variables from backend/.env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const { DatabaseService } = require('../backend/services/database');
const { MigrationRunner } = require('../database/migrate');

async function setupDatabase() {
  console.log('Setting up Congress API database...\n');

  try {
    // Test database connection
    console.log('1. Testing database connection...');
    const db = new DatabaseService();
    await db.testConnection();
    console.log('✓ Database connection successful\n');
    await db.close();

    // Run migrations
    console.log('2. Running database migrations...');
    const migrationRunner = new MigrationRunner();
    await migrationRunner.runMigrations();
    console.log('\n✓ Database setup completed successfully');

    console.log('\n✅ Your Congress API application is now ready to use PostgreSQL for conversation storage!');
    console.log('\nDatabase configuration detected from backend/.env:');
    console.log(`   Host: ${process.env.DB_HOST}`);
    console.log(`   Port: ${process.env.DB_PORT}`);
    console.log(`   Database: ${process.env.DB_DATABASE}`);
    console.log(`   User: ${process.env.DB_USER}`);
    console.log('\n🚀 You can now start your application - conversations will persist in PostgreSQL!');

  } catch (error) {
    console.error('\n❌ Database setup failed:');
    console.error(error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\nTroubleshooting:');
      console.error('- Make sure PostgreSQL is running');
      console.error('- Check your database connection settings');
      console.error('- Verify the database "congress-api" exists');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };