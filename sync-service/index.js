const cron = require('node-cron');
const express = require('express');
const config = require('./config');
const logger = require('./lib/logger');
const BillSyncer = require('./syncers/bill-syncer');
const MemberSyncer = require('./syncers/member-syncer');
const CommitteeSyncer = require('./syncers/committee-syncer');
const CommitteeReportSyncer = require('./syncers/committee-report-syncer');
const HearingSyncer = require('./syncers/hearing-syncer');
const CommitteeMeetingSyncer = require('./syncers/committee-meeting-syncer');
const CongressionalRecordSyncer = require('./syncers/congressional-record-syncer');
const CommitteeMembershipSyncer = require('./syncers/committee-membership-syncer');
const { NewsIngestionService } = require('./services/news-ingestion-service');
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
          nextRun: job.nextRun || null,
          lastRun: job.lastRun || null,
          schedule: job.schedule
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

  // Schedule incremental bill sync (recent bills only)
  scheduleBillSync() {
    const schedule = config.sync.schedules.bills;
    logger.info(`Scheduling bill sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled incremental bill sync');
      this.jobs.get('bills').running = true;
      
      try {
        // Use the bill syncer for incremental updates
        const syncer = new BillSyncer();
        const results = await syncer.performIncrementalSync(null, 7);
        
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

  // Schedule member sync (current congress members only)
  scheduleMemberSync() {
    const schedule = config.sync.schedules.members;
    logger.info(`Scheduling member sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled member sync (current congress only)');
      this.jobs.get('members').running = true;

      try {
        const syncer = new MemberSyncer();
        // Only sync current congress members to stay within scope
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

  // Schedule committee sync
  scheduleCommitteeSync() {
    const schedule = config.sync.schedules.committees;
    logger.info(`Scheduling committee sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled committee sync');
      this.jobs.get('committees').running = true;
      
      try {
        const syncer = new CommitteeSyncer();
        const currentCongress = await syncer.client.getCurrentCongress();
        const results = await syncer.syncCommitteesByCongress(currentCongress);
        await syncer.close();
        
        logger.info('Scheduled committee sync completed', results);
      } catch (error) {
        logger.error('Scheduled committee sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('committees').running = false;
        this.jobs.get('committees').lastRun = new Date();
      }
    });

    this.jobs.set('committees', { 
      job, 
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule committee report sync
  scheduleCommitteeReportSync() {
    const schedule = config.sync.schedules.reports;
    logger.info(`Scheduling committee report sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled committee report sync');
      this.jobs.get('reports').running = true;
      
      try {
        const syncer = new CommitteeReportSyncer();
        const currentCongress = await syncer.client.getCurrentCongress();
        
        // For scheduled runs, sync only recent reports (last 2 days)
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        
        const results = await syncer.syncCommitteeReportsByCongress(
          currentCongress,
          { fromDate: twoDaysAgo.toISOString().split('T')[0] }
        );
        await syncer.close();
        
        logger.info('Scheduled committee report sync completed', results);
      } catch (error) {
        logger.error('Scheduled committee report sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('reports').running = false;
        this.jobs.get('reports').lastRun = new Date();
      }
    });

    this.jobs.set('reports', { 
      job, 
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule hearing sync
  scheduleHearingSync() {
    const schedule = config.sync.schedules.hearings;
    logger.info(`Scheduling hearing sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled hearing sync');
      this.jobs.get('hearings').running = true;
      
      try {
        const syncer = new HearingSyncer();
        // Use recent hearings sync for incremental updates (default 7 days)
        const results = await syncer.syncRecentHearings();
        await syncer.close();
        
        logger.info('Scheduled hearing sync completed', results);
      } catch (error) {
        logger.error('Scheduled hearing sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('hearings').running = false;
        this.jobs.get('hearings').lastRun = new Date();
      }
    });

    this.jobs.set('hearings', {
      job,
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule committee meeting sync
  scheduleCommitteeMeetingSync() {
    const schedule = config.sync.schedules['committee-meetings'];
    logger.info(`Scheduling committee meeting sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled committee meeting sync');
      this.jobs.get('committee-meetings').running = true;

      try {
        const syncer = new CommitteeMeetingSyncer();
        // Use recent meetings sync for incremental updates (default 7 days)
        const results = await syncer.syncRecentMeetings();
        await syncer.close();

        logger.info('Scheduled committee meeting sync completed', results);
      } catch (error) {
        logger.error('Scheduled committee meeting sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('committee-meetings').running = false;
        this.jobs.get('committee-meetings').lastRun = new Date();
      }
    });

    this.jobs.set('committee-meetings', {
      job,
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule Congressional Record sync
  scheduleCongressionalRecordSync() {
    const schedule = config.sync.schedules['congressional-record'];
    logger.info(`Scheduling Congressional Record sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled Congressional Record sync');
      this.jobs.get('congressional-record').running = true;
      
      try {
        const syncer = new CongressionalRecordSyncer();
        
        // For scheduled runs, sync recent CR issues and process references
        const results = await syncer.syncRecentCongressionalRecord({
          days: config.sync.incrementalDays['congressional-record'],
          syncArticles: true,
          syncContent: false // Don't fetch full content for scheduled runs
        });
        
        // Also process any unresolved references
        const refResults = await syncer.syncUnresolvedReferences();
        
        await syncer.close();
        
        logger.info('Scheduled Congressional Record sync completed', {
          issueSync: results,
          referenceSync: refResults
        });
      } catch (error) {
        logger.error('Scheduled Congressional Record sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('congressional-record').running = false;
        this.jobs.get('congressional-record').lastRun = new Date();
      }
    });

    this.jobs.set('congressional-record', {
      job,
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule News Ingestion (for spotlight suggestions)
  scheduleNewsIngestion() {
    const schedule = config.sync.schedules['news-ingestion'];
    logger.info(`Scheduling news ingestion with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled news ingestion');
      this.jobs.get('news-ingestion').running = true;

      try {
        const newsService = new NewsIngestionService();

        // Generate spotlight suggestions from news analysis
        const analysis = await newsService.generateSpotlightSuggestions();

        if (analysis.success) {
          // Store analysis results
          await newsService.storeAnalysisResults(analysis);

          // Auto-create spotlights if enabled
          if (config.newsIngestion.autoCreate) {
            const created = await newsService.autoCreateSpotlights(
              analysis.spotlightSuggestions,
              config.newsIngestion.minScore
            );

            logger.info('News ingestion completed', {
              itemsAnalyzed: analysis.newsItemsAnalyzed,
              suggestions: analysis.spotlightSuggestions.length,
              spotlightsCreated: created.length,
              topTopics: Object.keys(analysis.trendingTopics).slice(0, 3)
            });
          } else {
            logger.info('News ingestion completed (auto-create disabled)', {
              itemsAnalyzed: analysis.newsItemsAnalyzed,
              suggestions: analysis.spotlightSuggestions.length
            });
          }
        } else {
          logger.warn('News ingestion analysis failed', { error: analysis.error });
        }

        await newsService.close();
      } catch (error) {
        logger.error('Scheduled news ingestion failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('news-ingestion').running = false;
        this.jobs.get('news-ingestion').lastRun = new Date();
      }
    });

    this.jobs.set('news-ingestion', {
      job,
      schedule,
      running: false,
      lastRun: null
    });

    return job;
  }

  // Schedule Committee Membership sync (after member sync)
  scheduleCommitteeMembershipSync() {
    const schedule = config.sync.schedules['committee-membership'];
    logger.info(`Scheduling committee membership sync with cron: ${schedule}`);

    const job = cron.schedule(schedule, async () => {
      logger.info('Starting scheduled committee membership sync');
      this.jobs.get('committee-membership').running = true;

      try {
        const syncer = new CommitteeMembershipSyncer();
        const results = await syncer.sync();
        await syncer.close();

        logger.info('Scheduled committee membership sync completed', results);
      } catch (error) {
        logger.error('Scheduled committee membership sync failed', {
          error: error.message
        });
      } finally {
        this.jobs.get('committee-membership').running = false;
        this.jobs.get('committee-membership').lastRun = new Date();
      }
    });

    this.jobs.set('committee-membership', {
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
          // Only sync current congress members unless explicitly requested
          const results = options.includeHistorical ?
            await memberSyncer.syncAllMembers() :
            await memberSyncer.syncCurrentMembers();
          await memberSyncer.close();
          return results;
        } catch (error) {
          await memberSyncer.close();
          throw error;
        }
      
      case 'committees':
        const committeeSyncer = new CommitteeSyncer();
        try {
          const currentCongress = await committeeSyncer.client.getCurrentCongress();
          const results = await committeeSyncer.syncCommitteesByCongress(currentCongress);
          await committeeSyncer.close();
          return results;
        } catch (error) {
          await committeeSyncer.close();
          throw error;
        }
      
      case 'reports':
        const reportSyncer = new CommitteeReportSyncer();
        try {
          const currentCongress = await reportSyncer.client.getCurrentCongress();
          const results = await reportSyncer.syncCommitteeReportsByCongress(currentCongress);
          await reportSyncer.close();
          return results;
        } catch (error) {
          await reportSyncer.close();
          throw error;
        }
      
      case 'hearings':
        const hearingSyncer = new HearingSyncer();
        try {
          const results = options.comprehensive ?
            await hearingSyncer.syncAllHearings(options) :
            await hearingSyncer.syncRecentHearings(options);
          await hearingSyncer.close();
          return results;
        } catch (error) {
          await hearingSyncer.close();
          throw error;
        }

      case 'committee-meetings':
        const meetingSyncer = new CommitteeMeetingSyncer();
        try {
          const results = options.comprehensive ?
            await meetingSyncer.syncAllMeetings(options) :
            await meetingSyncer.syncRecentMeetings(options);
          await meetingSyncer.close();
          return results;
        } catch (error) {
          await meetingSyncer.close();
          throw error;
        }

      case 'congressional-record':
        const crSyncer = new CongressionalRecordSyncer();
        try {
          let results;
          if (options.type === 'issue' && options.volumeNumber && options.issueNumber) {
            // Sync specific issue
            results = await crSyncer.syncCongressionalRecordIssue(
              options.volumeNumber, 
              options.issueNumber, 
              options
            );
          } else if (options.type === 'references') {
            // Sync unresolved references only
            results = await crSyncer.syncUnresolvedReferences();
          } else {
            // Default to recent sync
            results = await crSyncer.syncRecentCongressionalRecord(options);
          }
          await crSyncer.close();
          return results;
        } catch (error) {
          await crSyncer.close();
          throw error;
        }

      case 'news-ingestion':
        const newsService = new NewsIngestionService();
        try {
          const analysis = await newsService.generateSpotlightSuggestions();
          if (analysis.success && options.autoCreate !== false) {
            await newsService.storeAnalysisResults(analysis);
            const created = await newsService.autoCreateSpotlights(
              analysis.spotlightSuggestions,
              options.minScore || config.newsIngestion.minScore
            );
            analysis.spotlightsCreated = created;
          }
          await newsService.close();
          return analysis;
        } catch (error) {
          await newsService.close();
          throw error;
        }

      case 'committee-membership':
        const membershipSyncer = new CommitteeMembershipSyncer();
        try {
          const results = await membershipSyncer.sync();
          await membershipSyncer.close();
          return results;
        } catch (error) {
          await membershipSyncer.close();
          throw error;
        }

      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  // Start all scheduled jobs
  start() {
    logger.info('Starting sync scheduler');

    // Schedule all sync jobs with proper dependency order
    // 1. Members first (bills depend on members)
    this.scheduleMemberSync();
    
    // 2. Committees (bills reference committees)
    this.scheduleCommitteeSync();
    
    // 3. Bills (committee reports depend on bills)
    this.scheduleBillSync();
    
    // 4. Committee Reports (depends on bills existing)
    this.scheduleCommitteeReportSync();
    
    // 5. Hearings (independent, can run anytime)
    this.scheduleHearingSync();

    // 6. Committee Meetings (independent, same schedule as hearings)
    this.scheduleCommitteeMeetingSync();

    // 7. Congressional Record (depends on bills having actions with CR references)
    this.scheduleCongressionalRecordSync();

    // 8. News Ingestion (for spotlight suggestions - independent, runs 3x daily)
    this.scheduleNewsIngestion();

    // 9. Committee Membership (monthly, 30 min after member sync)
    this.scheduleCommitteeMembershipSync();

    logger.info(`Sync scheduler started with ${this.jobs.size} jobs`);

    // Perform initial sync if specified
    if (process.argv.includes('--initial-sync')) {
      this.performInitialSync();
    }
  }

  // Perform initial sync on startup with proper ordering
  async performInitialSync() {
    logger.info('Performing initial sync on startup');

    try {
      // Check if we need to do initial sync
      const billStatus = await this.db.getSyncStatus('bills');
      
      if (!billStatus) {
        logger.info('No previous sync found, performing full initial sync in dependency order');

        // Sync in dependency order
        logger.info('Step 1/4: Syncing members (current congress only)...');
        await this.triggerSync('members');
        
        logger.info('Step 2/4: Syncing committees...');
        await this.triggerSync('committees');

        logger.info('Step 3/4: Syncing recent bills...');
        const billSyncer = new BillSyncer();
        await billSyncer.performIncrementalSync(null, 7);
        
        logger.info('Step 4/4: Initial sync complete');
      } else {
        const hoursSinceLastSync = 
          (Date.now() - new Date(billStatus.last_sync_at).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastSync > 24) {
          logger.info(`Last sync was ${hoursSinceLastSync.toFixed(1)} hours ago, performing incremental sync`);

          // Just sync recent bills for incremental update
          const billSyncer = new BillSyncer();
          await billSyncer.performIncrementalSync(null, 7);
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
Congress Sync Service - Improved Version

Usage: node index-improved.js [options]

Options:
  --initial-sync      Perform initial sync on startup (in dependency order)
  --entity <type>     Sync specific entity type (bills, members, committees, reports, hearings, committee-meetings, congressional-record, news-ingestion)
  --help              Show this help message

Scheduled Sync Times:
  - Members: Monthly on 1st at 3 AM (current congress only)
  - Committees: Weekly on Monday at 4 AM
  - Bills: Every 6 hours (incremental, recent 100 bills)
  - Committee Reports: Daily at 1 AM (last 30 days)
  - Hearings: Daily at 5 AM and 5 PM (recent 7 days)
  - Committee Meetings: Daily at 5 AM and 5 PM (recent 7 days, includes bill linkage)
  - Congressional Record: Daily at 7 AM (recent 7 days)
  - News Ingestion: Three times daily at 8 AM, 2 PM, 8 PM (spotlight suggestions)

Examples:
  node index.js                               # Start scheduler
  node index.js --initial-sync                # Start with full initial sync
  node index.js --entity members              # Manual member sync
  node index.js --entity hearings             # Manual hearing sync
  node index.js --entity committee-meetings   # Manual committee meeting sync
  node index.js --entity congressional-record # Manual CR sync
  node index.js --entity news-ingestion       # Manual news ingestion
  `);
  process.exit(0);
}

// Handle manual sync commands
if (args.includes('--entity')) {
  const entityIndex = args.indexOf('--entity');
  const entityType = args[entityIndex + 1];

  scheduler.triggerSync(entityType)
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
  logger.info('Sync service is running (improved version)');
}