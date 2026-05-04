const cron = require('node-cron');
const express = require('express');
const config = require('./config');
const logger = require('./lib/logger');
const BillSyncer = require('./syncers/bill-syncer');
const MemberSyncer = require('./syncers/member-syncer');
const DatabaseService = require('./lib/database');

class SyncScheduler {
  constructor() {
    this.jobs = new Map();
    this.db = new DatabaseService();
    this.app = express();
    this.setupHealthCheck();
  }

  setupHealthCheck() {
    this.app.get(config.healthCheck.path, async (req, res) => {
      try {
        const dbConnected = await this.db.testConnection();
        const jobs = Array.from(this.jobs.entries()).map(([name, job]) => ({
          name,
          running: job.running || false,
          nextRun: job.nextRun || null
        }));

        res.json({
          status: dbConnected ? 'healthy' : 'unhealthy',
          database: dbConnected ? 'connected' : 'disconnected',
          jobs,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });

    this.app.listen(config.healthCheck.port, () => {
      logger.info(`Health check endpoint listening on port ${config.healthCheck.port}`);
    });
  }

  // Schedule bill sync
  scheduleBillSync() {
    const schedule = config.sync.schedules.bills;
    logger.info(`Scheduling bill sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled bill sync');
      this.jobs.get('bills').running = true;
      
      try {
        const syncer = new BillSyncer();
        const results = await syncer.sync({
          full: false,
          congress: null  // Let syncer auto-detect current congress
        });
        await syncer.close();
        
        logger.info('Scheduled bill sync completed', results);
      } catch (error) {
        logger.error('Scheduled bill sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('bills').running = false;
        this.jobs.get('bills').lastRun = new Date();
      }
    });

    this.jobs.set('bills', { 
      job, 
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule member sync
  scheduleMemberSync() {
    const schedule = config.sync.schedules.members;
    logger.info(`Scheduling member sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled member sync');
      this.jobs.get('members').running = true;
      
      try {
        const syncer = new MemberSyncer();
        const results = await syncer.syncCurrentMembers();
        await syncer.close();
        
        logger.info('Scheduled member sync completed', results);
      } catch (error) {
        logger.error('Scheduled member sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('members').running = false;
        this.jobs.get('members').lastRun = new Date();
      }
    });

    this.jobs.set('members', { 
      job, 
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Manual sync trigger
  async triggerSync(entityType, options = {}) {
    logger.info(`Manual sync triggered for ${entityType}`, options);

    switch (entityType) {
      case 'bills':
        const billSyncer = new BillSyncer();
        try {
          const results = await billSyncer.sync(options);
          await billSyncer.close();
          return results;
        } catch (error) {
          await billSyncer.close();
          throw error;
        }
      
      case 'members':
        const memberSyncer = new MemberSyncer();
        try {
          const results = await memberSyncer.syncCurrentMembers();
          await memberSyncer.close();
          return results;
        } catch (error) {
          await memberSyncer.close();
          throw error;
        }
      
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  // Start all scheduled jobs
  start() {
    logger.info('Starting sync scheduler');

    // Schedule all sync jobs
    this.scheduleBillSync();
    this.scheduleMemberSync();
    
    // Add more entity syncers here as they're implemented
    // this.scheduleAmendmentSync();
    // this.scheduleActionSync();
    // this.scheduleHearingSync();

    logger.info(`Sync scheduler started with ${this.jobs.size} jobs`);

    // Perform initial sync if specified
    if (process.argv.includes('--initial-sync')) {
      this.performInitialSync();
    }
  }

  // Perform initial sync on startup
  async performInitialSync() {
    logger.info('Performing initial sync on startup');

    try {
      // Check if we need to do initial sync
      const billStatus = await this.db.getSyncStatus('bills');
      
      if (!billStatus) {
        logger.info('No previous bill sync found, performing full initial sync');
        await this.triggerSync('bills', { 
          full: true, 
          congress: null  // Auto-detect current congress
        });
      } else {
        const hoursSinceLastSync = 
          (Date.now() - new Date(billStatus.last_sync_at).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastSync > 24) {
          logger.info(`Last sync was ${hoursSinceLastSync.toFixed(1)} hours ago, performing incremental sync`);
          await this.triggerSync('bills', { 
            full: false, 
            congress: null  // Auto-detect current congress
          });
        } else {
          logger.info(`Last sync was ${hoursSinceLastSync.toFixed(1)} hours ago, skipping initial sync`);
        }
      }
    } catch (error) {
      logger.error('Initial sync failed', {
        error: error.message
      });
    }
  }

  // Stop all scheduled jobs
  stop() {
    logger.info('Stopping sync scheduler');

    for (const [name, jobInfo] of this.jobs.entries()) {
      jobInfo.job.stop();
      logger.info(`Stopped job: ${name}`);
    }

    this.db.close();
    logger.info('Sync scheduler stopped');
  }
}

// Handle process signals
const scheduler = new SyncScheduler();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  scheduler.stop();
  process.exit(0);
});

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
Congress Sync Service

Usage: node index.js [options]

Options:
  --full              Perform full sync instead of incremental
  --incremental       Perform incremental sync (default)
  --initial-sync      Perform initial sync on startup
  --congress <num>    Specify congress number (default: auto-detect current)
  --entity <type>     Sync specific entity type (bills, members, amendments, etc.)
  --help              Show this help message

Examples:
  node index.js                           # Start scheduler with default settings
  node index.js --initial-sync            # Start scheduler and perform initial sync
  node index.js --full --congress 117     # Perform full sync of 117th Congress
  node index.js --entity bills --full     # Perform full sync of bills only
  node index.js --entity members          # Perform member sync manually
  `);
  process.exit(0);
}

// Handle manual sync commands
if (args.includes('--entity')) {
  const entityIndex = args.indexOf('--entity');
  const entityType = args[entityIndex + 1];
  
  const options = {
    full: args.includes('--full'),
    congress: null  // Auto-detect current congress
  };

  if (args.includes('--congress')) {
    const congressIndex = args.indexOf('--congress');
    options.congress = parseInt(args[congressIndex + 1]);
  }

  scheduler.triggerSync(entityType, options)
    .then(results => {
      logger.info('Manual sync completed', results);
      process.exit(0);
    })
    .catch(error => {
      logger.error('Manual sync failed', { error: error.message });
      process.exit(1);
    });
} else {
  // Start the scheduler
  scheduler.start();
  logger.info('Sync service is running');
}