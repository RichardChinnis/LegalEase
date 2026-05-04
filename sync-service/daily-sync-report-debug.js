#!/usr/bin/env node

console.log('=== DEBUG SCRIPT STARTED ===');
console.log('Time:', new Date().toISOString());
console.log('Process ID:', process.pid);
console.log('Working directory:', process.cwd());
console.log('Node version:', process.version);
console.log('User ID:', process.getuid());
console.log('Group ID:', process.getgid());
console.log('Environment NODE_ENV:', process.env.NODE_ENV);
console.log('Arguments:', process.argv);

console.log('\n=== TESTING MODULE LOADING ===');

try {
  console.log('1. Loading path module...');
  const path = require('path');
  console.log('✓ Path module loaded');

  console.log('2. Testing file existence...');
  const fs = require('fs');
  const configPath = './config/email-config.js';
  const absoluteConfigPath = path.resolve(configPath);
  console.log('Config path (relative):', configPath);
  console.log('Config path (absolute):', absoluteConfigPath);

  if (fs.existsSync(absoluteConfigPath)) {
    console.log('✓ Config file exists');
    const stats = fs.statSync(absoluteConfigPath);
    console.log('Config file size:', stats.size, 'bytes');
    console.log('Config file mode:', stats.mode.toString(8));
  } else {
    console.log('✗ Config file does not exist');
  }

  console.log('3. Loading logger...');
  const logger = require('./lib/logger');
  console.log('✓ Logger loaded');

  console.log('4. Loading email-config...');
  const emailConfig = require('./config/email-config');
  console.log('✓ Email config loaded');
  console.log('Email config keys:', Object.keys(emailConfig));

  console.log('5. Loading EmailService...');
  const EmailService = require('./lib/email-service');
  console.log('✓ Email service loaded');

  console.log('6. Loading SyncDataCollector...');
  const SyncDataCollector = require('./lib/sync-data-collector');
  console.log('✓ Sync data collector loaded');

  console.log('\n=== TESTING SERVICE INITIALIZATION ===');

  console.log('7. Creating EmailService instance...');
  const emailService = new EmailService(emailConfig.email);
  console.log('✓ Email service instance created');

  console.log('8. Creating SyncDataCollector instance...');
  const dataCollector = new SyncDataCollector();
  console.log('✓ Data collector instance created');

  console.log('9. Testing database connection...');
  const testQuery = await dataCollector.db.query('SELECT 1 as test');
  console.log('✓ Database connection successful');

  console.log('10. Testing email service initialization...');
  const emailInitialized = await emailService.initialize();
  console.log('✓ Email service initialized:', emailInitialized);

  console.log('\n=== ALL TESTS PASSED ===');
  console.log('Script would normally continue with full report generation...');

  // Clean up
  await dataCollector.close();
  await emailService.close();

  console.log('=== DEBUG SCRIPT COMPLETED SUCCESSFULLY ===');
  process.exit(0);

} catch (error) {
  console.log('\n=== CRITICAL ERROR ===');
  console.log('Error type:', error.constructor.name);
  console.log('Error message:', error.message);
  console.log('Error code:', error.code);
  console.log('Error stack:');
  console.log(error.stack);

  if (error.code === 'MODULE_NOT_FOUND') {
    console.log('\nModule resolution debugging:');
    console.log('require.resolve.paths("./config/email-config"):', require.resolve.paths('./config/email-config'));
    try {
      console.log('require.resolve("./config/email-config"):', require.resolve('./config/email-config'));
    } catch (resolveError) {
      console.log('require.resolve failed:', resolveError.message);
    }
  }

  console.log('\n=== DEBUG SCRIPT FAILED ===');
  process.exit(1);
}
