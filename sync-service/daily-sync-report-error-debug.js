// Debug version with comprehensive error catching

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});

console.log('=== STARTING DEBUG VERSION ===');

try {
  console.log('1. Loading path module...');
  const path = require('path');
  console.log('✓ Path loaded');

  console.log('2. Loading logger...');
  const logger = require('./lib/logger');
  console.log('✓ Logger loaded');

  console.log('3. Loading EmailService...');
  const EmailService = require('./lib/email-service');
  console.log('✓ EmailService loaded');

  console.log('4. Loading SyncDataCollector...');
  const SyncDataCollector = require('./lib/sync-data-collector');
  console.log('✓ SyncDataCollector loaded');

  console.log('5. Loading email config...');
  const emailConfig = require('./config/email-config');
  console.log('✓ Email config loaded');
  console.log('Email config to:', emailConfig.email.to);

  console.log('6. Creating DailySyncReporter class...');

  class DailySyncReporter {
    constructor() {
      console.log('7. Initializing reporter...');
      this.emailService = new EmailService(emailConfig.email);
      this.dataCollector = new SyncDataCollector();
      this.config = emailConfig;
      console.log('✓ Reporter initialized');
    }

    async generateAndSendReport() {
      console.log('8. Starting report generation...');

      try {
        console.log('9. Collecting data...');
        const reportData = await this.dataCollector.collectAllData();
        console.log('✓ Data collected:', Object.keys(reportData));

        console.log('10. Sending email...');
        const emailResult = await this.emailService.sendDailyReport(reportData);
        console.log('✓ Email sent:', emailResult.messageId);

        return { success: true, messageId: emailResult.messageId };
      } catch (error) {
        console.error('Error in generateAndSendReport:', error.message);
        console.error('Stack:', error.stack);
        throw error;
      } finally {
        await this.cleanup();
      }
    }

    async cleanup() {
      console.log('11. Cleaning up...');
      try {
        await this.dataCollector.close();
        await this.emailService.close();
        console.log('✓ Cleanup complete');
      } catch (error) {
        console.error('Cleanup error:', error.message);
      }
    }
  }

  console.log('12. Running main function...');

  async function main() {
    const reporter = new DailySyncReporter();
    try {
      const result = await reporter.generateAndSendReport();
      console.log('✓ SUCCESS:', result);
      process.exit(0);
    } catch (error) {
      console.error('MAIN ERROR:', error.message);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  }

  main();

} catch (syncError) {
  console.error('SYNCHRONOUS ERROR:', syncError.message);
  console.error('Stack:', syncError.stack);
  process.exit(1);
}
