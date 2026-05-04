const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');

class CommitteeSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
  }

  // Transform API committee data to database format
  transformCommitteeData(apiData) {
    try {
      const committee = apiData.committee || apiData;
      
      // Map chamber values to database enum
      let chamber = null;
      if (committee.chamber) {
        const chamberValue = committee.chamber.toLowerCase();
        if (chamberValue === 'house' || chamberValue === 'house of representatives') {
          chamber = 'House';
        } else if (chamberValue === 'senate') {
          chamber = 'Senate';
        } else if (chamberValue === 'joint') {
          chamber = 'Joint';
        } else {
          chamber = 'NoChamber';
        }
      }
      
      return {
        system_code: committee.systemCode,
        name: committee.name,
        chamber: chamber,
        committee_type_code: committee.committeeTypeCode,
        is_current: true, // Assume current if we're getting it from API
        parent_committee_code: committee.parent?.systemCode || null,
        api_update_date: committee.updateDate ? new Date(committee.updateDate) : new Date()
      };
    } catch (error) {
      logger.error('Failed to transform committee data', { 
        error: error.message,
        systemCode: apiData.systemCode || 'unknown'
      });
      throw error;
    }
  }

  // Upsert committee data
  async upsertCommittee(committeeData) {
    const query = `
      INSERT INTO committee (
        system_code, name, chamber, committee_type_code,
        is_current, parent_committee_code, api_update_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (system_code) DO UPDATE SET
        name = EXCLUDED.name,
        chamber = EXCLUDED.chamber,
        committee_type_code = EXCLUDED.committee_type_code,
        is_current = EXCLUDED.is_current,
        parent_committee_code = EXCLUDED.parent_committee_code,
        api_update_date = EXCLUDED.api_update_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING system_code, (xmax = 0) AS inserted`;

    return await this.db.query(query, [
      committeeData.system_code,
      committeeData.name,
      committeeData.chamber,
      committeeData.committee_type_code,
      committeeData.is_current,
      committeeData.parent_committee_code,
      committeeData.api_update_date
    ]);
  }

  // Sync committees from a specific chamber
  async syncCommitteesByChamber(chamber) {
    logger.info(`Starting sync of ${chamber} committees`);
    
    try {
      // Get all committees with pagination
      const committees = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const response = await this.client.getCommittees(chamber.toLowerCase(), { 
          limit: 250,
          offset: offset
        });
        
        const batchCommittees = response.committees || [];
        committees.push(...batchCommittees);
        
        logger.info(`Fetched ${batchCommittees.length} ${chamber} committees (total: ${committees.length})`);
        
        // Check if we have more pages
        hasMore = batchCommittees.length === 250;
        offset += 250;
        
        // Small delay between pagination requests
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Found ${committees.length} ${chamber} committees to sync`);
      
      // Process committees in dependency order (parents first, then subcommittees)
      await this.processCommitteesInOrder(committees);
      
      logger.info(`${chamber} committee sync completed`, {
        inserted: this.stats.inserted,
        updated: this.stats.updated,
        failed: this.stats.failed
      });
      
      return this.stats;
    } catch (error) {
      logger.error(`Failed to sync ${chamber} committees`, { error: error.message });
      throw error;
    }
  }

  // Process committees in correct order (parents first, then subcommittees)
  async processCommitteesInOrder(committees) {
    logger.info(`Processing ${committees.length} committees in dependency order`);
    
    // Separate parent committees (no parent_committee_code) from subcommittees
    const parentCommittees = committees.filter(c => !c.parent?.systemCode);
    const subcommittees = committees.filter(c => c.parent?.systemCode);
    
    logger.info(`Found ${parentCommittees.length} parent committees and ${subcommittees.length} subcommittees`);
    
    // First, insert all parent committees
    logger.info('Step 1: Inserting parent committees...');
    await this.processCommitteeBatch(parentCommittees);
    
    // Then, insert subcommittees (their parents should now exist)
    logger.info('Step 2: Inserting subcommittees...');
    await this.processCommitteeBatch(subcommittees);
    
    logger.info('Committee dependency ordering complete');
  }

  // Process a batch of committees
  async processCommitteeBatch(committees) {
    for (let i = 0; i < committees.length; i++) {
      const committee = committees[i];
      try {
        const transformedCommittee = this.transformCommitteeData(committee);
        const result = await this.upsertCommittee(transformedCommittee);
        
        if (result.rows[0].inserted) {
          this.stats.inserted++;
        } else {
          this.stats.updated++;
        }
        
        // Small delay between individual committee processing
        if (i < committees.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({
          systemCode: committee.systemCode,
          error: error.message
        });
        logger.warn('Failed to sync committee', { 
          systemCode: committee.systemCode,
          error: error.message 
        });
      }
    }
  }

  // Sync all current committees from both chambers
  async syncAllCurrentCommittees() {
    const startTime = Date.now();
    logger.info('Starting comprehensive sync of all current committees');

    try {
      // Reset stats for this sync
      this.stats = {
        inserted: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      // Sync House, Senate, and Joint committees in parallel for efficiency
      const [houseStats, senateStats, jointStats] = await Promise.all([
        this.syncCommitteesByChamber('house').catch(err => {
          logger.error('House committee sync failed', { error: err.message });
          return { inserted: 0, updated: 0, failed: 0, errors: [err.message] };
        }),
        this.syncCommitteesByChamber('senate').catch(err => {
          logger.error('Senate committee sync failed', { error: err.message });
          return { inserted: 0, updated: 0, failed: 0, errors: [err.message] };
        }),
        this.syncCommitteesByChamber('joint').catch(err => {
          logger.error('Joint committee sync failed', { error: err.message });
          return { inserted: 0, updated: 0, failed: 0, errors: [err.message] };
        })
      ]);

      // Combine stats
      const totalStats = {
        inserted: houseStats.inserted + senateStats.inserted + jointStats.inserted,
        updated: houseStats.updated + senateStats.updated + jointStats.updated,
        failed: houseStats.failed + senateStats.failed + jointStats.failed,
        errors: [...houseStats.errors, ...senateStats.errors, ...jointStats.errors]
      };

      const duration = Date.now() - startTime;

      // Update sync status on success
      await this.db.updateSyncStatus('committees', {
        success: true,
        records_synced: totalStats.inserted + totalStats.updated,
        records_failed: totalStats.failed,
        duration,
        metadata: {
          house: houseStats,
          senate: senateStats,
          joint: jointStats
        }
      });

      logger.info('All committee sync completed', {
        ...totalStats,
        duration: `${duration}ms`
      });

      return totalStats;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update sync status on failure
      await this.db.updateSyncStatus('committees', {
        success: false,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        error: error.message,
        metadata: {}
      });

      logger.error('Failed to sync all committees', {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  // Sync committees by congress (delegates to syncAllCurrentCommittees)
  async syncCommitteesByCongress(congress) {
    logger.info(`Starting committee sync for congress ${congress}`);
    // For now, sync all current committees regardless of congress parameter
    // since committees don't change frequently within a congress
    return await this.syncAllCurrentCommittees();
  }

  // Close database connection
  async close() {
    await this.db.close();
  }
}

module.exports = CommitteeSyncer;