#!/usr/bin/env node

/**
 * Test script for the daily sync report system
 * This script tests the email generation and sending functionality
 */

const path = require('path');
const logger = require('./lib/logger');
const EmailService = require('./lib/email-service');
const SyncDataCollector = require('./lib/sync-data-collector');
const emailConfig = require('./config/email-config');

async function runTest() {
  console.log('Congress API Daily Report Test');
  console.log('==============================\n');

  let dataCollector;
  let emailService;

  try {
    // Initialize services
    console.log('1. Initializing services...');
    dataCollector = new SyncDataCollector();
    emailService = new EmailService(emailConfig.email);

    // Test database connectivity
    console.log('2. Testing database connectivity...');
    const testData = await dataCollector.db.query('SELECT 1 as test');
    console.log('✓ Database connection successful\n');

    // Test data collection
    console.log('3. Testing data collection...');
    const startTime = Date.now();
    const reportData = await dataCollector.collectAllData();
    const collectionTime = Date.now() - startTime;

    console.log(`✓ Data collection completed in ${collectionTime}ms`);
    console.log(`  - Sync items: ${reportData.syncSummary.length}`);
    console.log(`  - Errors found: ${reportData.errors.length}`);
    console.log(`  - Total records processed: ${reportData.executiveSummary.totalRecordsProcessed}`);
    console.log(`  - Success rate: ${reportData.executiveSummary.successRate}%\n`);

    // Test email service initialization
    console.log('4. Testing email service...');
    const emailInitialized = await emailService.initialize();

    if (emailInitialized) {
      console.log('✓ Email service initialized successfully\n');
    } else {
      console.log('⚠ Email service initialization failed (check SMTP configuration)\n');
    }

    // Generate sample report data for testing
    console.log('5. Generating test report...');
    const testReportData = generateTestData();

    // Test HTML generation
    console.log('6. Testing HTML report generation...');
    const htmlReport = emailService.generateHtmlReport(testReportData);
    console.log(`✓ HTML report generated (${htmlReport.length} characters)\n`);

    // Test text generation
    console.log('7. Testing text report generation...');
    const textReport = emailService.generateTextReport(testReportData);
    console.log(`✓ Text report generated (${textReport.length} characters)\n`);

    // Ask user if they want to send a test email
    if (process.argv.includes('--send-email')) {
      console.log('8. Sending test email...');

      try {
        const emailResult = await emailService.sendDailyReport(testReportData);
        console.log('✓ Test email sent successfully!');
        console.log(`  Message ID: ${emailResult.messageId}`);
        console.log(`  Recipients: ${emailResult.recipients}\n`);
      } catch (emailError) {
        console.log('✗ Email sending failed:');
        console.log(`  Error: ${emailError.message}\n`);

        // Show configuration help
        console.log('Email Configuration Help:');
        console.log('- Check that your SMTP server is configured properly');
        console.log('- Verify email settings in config/email-config.js');
        console.log('- Ensure the EMAIL_TO address is valid');
        console.log('- For local testing, make sure postfix/sendmail is installed\n');
      }
    } else {
      console.log('8. Skipping email sending (use --send-email to test)');
      console.log('   Email configuration:');
      console.log(`   - SMTP Host: ${emailConfig.smtp.host}:${emailConfig.smtp.port}`);
      console.log(`   - From: ${emailConfig.email.from}`);
      console.log(`   - To: ${emailConfig.email.to}`);
      console.log(`   - Subject: ${emailConfig.email.subject}\n`);
    }

    // Test with real data if requested
    if (process.argv.includes('--use-real-data')) {
      console.log('9. Testing with real sync data...');

      try {
        const realReportData = await dataCollector.collectAllData();

        if (process.argv.includes('--send-real-email')) {
          const emailResult = await emailService.sendDailyReport(realReportData);
          console.log('✓ Real data email sent successfully!');
          console.log(`  Message ID: ${emailResult.messageId}`);
          console.log(`  Total sync items: ${realReportData.syncSummary.length}`);
          console.log(`  Errors included: ${realReportData.errors.length}\n`);
        } else {
          console.log('✓ Real data collected successfully');
          console.log('   Use --send-real-email to send with real data\n');
        }
      } catch (realDataError) {
        console.log('✗ Real data collection failed:');
        console.log(`  Error: ${realDataError.message}\n`);
      }
    }

    console.log('Test Summary:');
    console.log('=============');
    console.log('✓ Database connectivity: PASS');
    console.log('✓ Data collection: PASS');
    console.log(`${emailInitialized ? '✓' : '⚠'} Email service: ${emailInitialized ? 'PASS' : 'WARNING'}`);
    console.log('✓ Report generation: PASS');

    if (process.argv.includes('--send-email') || process.argv.includes('--send-real-email')) {
      console.log('\nIf the email was sent successfully, check your inbox!');
    } else {
      console.log('\nTo send a test email, run: node test-daily-report.js --send-email');
      console.log('To send with real data: node test-daily-report.js --use-real-data --send-real-email');
    }

  } catch (error) {
    console.error('\n✗ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    if (dataCollector) {
      await dataCollector.close();
    }
    if (emailService) {
      await emailService.close();
    }
  }
}

function generateTestData() {
  return {
    reportDate: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    executiveSummary: {
      overallSuccess: true,
      successfulSyncs: 5,
      totalSyncs: 6,
      totalRecordsProcessed: 12450,
      totalInserts: 234,
      totalUpdates: 1456,
      totalErrors: 2,
      successRate: 83
    },
    syncSummary: [
      {
        entityType: 'Bills',
        success: true,
        lastSync: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        recordsProcessed: 150,
        recordsInserted: 12,
        recordsFailed: 0,
        duration: 45000,
        errorCount: 0
      },
      {
        entityType: 'Members',
        success: true,
        lastSync: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
        recordsProcessed: 535,
        recordsInserted: 5,
        recordsFailed: 0,
        duration: 12000,
        errorCount: 0
      },
      {
        entityType: 'Committees',
        success: false,
        lastSync: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
        recordsProcessed: 45,
        recordsInserted: 0,
        recordsFailed: 2,
        duration: 8000,
        errorCount: 2,
        errorMessage: 'API rate limit exceeded'
      },
      {
        entityType: 'Congressional Record',
        success: true,
        lastSync: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        recordsProcessed: 23,
        recordsInserted: 23,
        recordsFailed: 0,
        duration: 67000,
        errorCount: 0
      },
      {
        entityType: 'Committee Reports',
        success: true,
        lastSync: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        recordsProcessed: 8,
        recordsInserted: 8,
        recordsFailed: 0,
        duration: 15000,
        errorCount: 0
      },
      {
        entityType: 'Hearings',
        success: true,
        lastSync: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        recordsProcessed: 12,
        recordsInserted: 4,
        recordsFailed: 0,
        duration: 22000,
        errorCount: 0
      }
    ],
    backupStatus: {
      success: true,
      lastBackup: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
      size: '2.3 GB',
      totalBackups: 15
    },
    systemHealth: {
      servicesRunning: true,
      activeServices: 3,
      totalServices: 4,
      dbConnections: 12,
      dbConnected: true,
      uptime: 'up 5 days, 14 hours, 23 minutes'
    },
    errors: [
      {
        type: 'Committee Sync Error',
        message: 'API rate limit exceeded for committees endpoint',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      },
      {
        type: 'System Service Warning',
        message: 'High memory usage detected in sync service',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      }
    ],
    performance: {
      dbSize: '4.2 GB',
      avgSyncTime: '28.5s',
      fastestSync: '8.0s',
      slowestSync: '67.0s',
      reportGenerationTime: 1250,
      totalTables: 48
    }
  };
}

// Show usage information
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Congress API Daily Report Test Script');
  console.log('=====================================\n');
  console.log('Usage: node test-daily-report.js [options]\n');
  console.log('Options:');
  console.log('  --send-email         Send a test email with sample data');
  console.log('  --use-real-data      Test with real sync data from database');
  console.log('  --send-real-email    Send email with real sync data');
  console.log('  --help, -h           Show this help message\n');
  console.log('Examples:');
  console.log('  node test-daily-report.js                    # Basic test (no email)');
  console.log('  node test-daily-report.js --send-email       # Test with sample email');
  console.log('  node test-daily-report.js --use-real-data --send-real-email  # Full test');
  process.exit(0);
}

// Run the test
runTest();