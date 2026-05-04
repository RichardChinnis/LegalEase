#!/usr/bin/env node

/**
 * Daily Congressional Record Sync
 * 
 * Production script that syncs the 2 most recent Congressional Record issues daily.
 * Incorporates all lessons learned from pagination fixes, uniqueness detection,
 * and database constraint handling.
 * 
 * Features:
 * - Syncs only the 2 most recent issues
 * - Proper pagination with article counting fix
 * - Enhanced uniqueness detection with text_url
 * - Real API date handling to avoid constraints
 * - Robust error handling and logging
 * - Safe for daily cron execution
 */

const CongressionalRecordSyncer = require('./syncers/congressional-record-syncer');
const logger = require('./lib/logger');

class DailyCongressionalRecordSync {
  constructor() {
    this.syncer = new CongressionalRecordSyncer();
    this.stats = {
      issuesProcessed: 0,
      totalArticlesStored: 0,
      errors: []
    };
  }

  /**
   * Map API section names to database enum values
   */
  mapSectionName(apiSectionName) {
    const sectionMap = {
      'Daily Digest': 'Daily Digest',
      'Extensions of Remarks Section': 'Extensions of Remarks',
      'House Section': 'House',
      'Senate Section': 'Senate'
    };
    
    return sectionMap[apiSectionName] || 'Senate'; // Default fallback
  }

  /**
   * Get the 2 most recent Congressional Record issues
   */
  async getRecentIssues() {
    logger.info('📡 Fetching 2 most recent Congressional Record issues...');

    try {
      // Note: The API returns issues sorted by most recent by default
      // The API does NOT support a 'sort' parameter
      const response = await this.syncer.client.makeRequest('/daily-congressional-record', {
        limit: 10 // Get a few extra in case some aren't from current congress
      });

      if (!response.dailyCongressionalRecord || response.dailyCongressionalRecord.length === 0) {
        throw new Error('No Congressional Record issues found');
      }

      // Filter for 119th Congress and take the 2 most recent
      const recentIssues = response.dailyCongressionalRecord
        .filter(issue => parseInt(issue.congress) === 119)
        .slice(0, 2)
        .map(issue => ({
          volume: parseInt(issue.volumeNumber),
          issue: parseInt(issue.issueNumber),
          date: issue.issueDate,
          congress: parseInt(issue.congress),
          session: parseInt(issue.sessionNumber),
          apiData: issue
        }));

      if (recentIssues.length === 0) {
        throw new Error('No 119th Congress issues found in recent issues');
      }

      logger.info(`✅ Found ${recentIssues.length} recent 119th Congress issues:`);
      recentIssues.forEach((issue, idx) => {
        logger.info(`   ${idx + 1}. Volume ${issue.volume}, Issue ${issue.issue} (${issue.date})`);
      });

      return recentIssues;

    } catch (error) {
      logger.error('❌ Failed to get recent Congressional Record issues', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if an issue already exists in the database
   */
  async checkIssueExists(volume, issue) {
    try {
      const query = `
        SELECT i.issue_id, COUNT(a.article_id) as article_count
        FROM congressional_record_issue i
        JOIN congressional_record_volume v ON i.volume_id = v.volume_id
        LEFT JOIN congressional_record_section s ON i.issue_id = s.issue_id
        LEFT JOIN congressional_record_article a ON s.section_id = a.section_id
        WHERE v.volume_number = $1 AND i.issue_number = $2
        GROUP BY i.issue_id
      `;
      
      const result = await this.syncer.db.query(query, [volume, issue]);
      
      if (result.rows.length > 0) {
        const existingCount = parseInt(result.rows[0].article_count);
        return { exists: true, articleCount: existingCount };
      }
      
      return { exists: false, articleCount: 0 };
      
    } catch (error) {
      logger.warn('Failed to check issue existence', { volume, issue, error: error.message });
      return { exists: false, articleCount: 0 };
    }
  }

  /**
   * Process articles for a single issue with fixed pagination
   */
  async processIssueArticles(volume, issue) {
    let allSections = [];
    let offset = 0;
    const limit = 250;
    let hasMore = true;
    let pageNum = 1;

    logger.info(`   📄 Fetching articles for Volume ${volume}, Issue ${issue}...`);

    while (hasMore) {
      try {
        const response = await this.syncer.client.getCongressionalRecordArticles(volume, issue, {
          offset,
          limit
        });

        if (!response.articles || !Array.isArray(response.articles)) {
          hasMore = false;
          continue;
        }

        const sections = response.articles;
        allSections.push(...sections);

        // FIXED PAGINATION: Count total articles across all sections on this page
        const articleCountOnPage = sections.reduce((sum, section) => {
          return sum + (section.sectionArticles ? section.sectionArticles.length : 0);
        }, 0);

        logger.info(`   📄 Page ${pageNum}: ${sections.length} sections, ${articleCountOnPage} articles`);

        // Check if there are more pages - if we got exactly the limit, there might be more
        hasMore = articleCountOnPage === limit;
        offset += limit;
        pageNum++;

      } catch (error) {
        logger.error(`❌ Error fetching articles for Volume ${volume}, Issue ${issue}`, {
          volume, issue, offset, limit, error: error.message
        });
        throw error;
      }
    }

    const totalArticles = allSections.reduce((sum, section) => {
      return sum + (section.sectionArticles ? section.sectionArticles.length : 0);
    }, 0);

    logger.info(`   📊 Total articles found: ${totalArticles} across ${allSections.length} sections`);
    return allSections;
  }

  /**
   * Clean up existing data for an issue if it exists
   */
  async cleanupExistingData(volume, issue) {
    try {
      const existingQuery = `
        SELECT v.volume_id, i.issue_id 
        FROM congressional_record_volume v 
        JOIN congressional_record_issue i ON v.volume_id = i.volume_id 
        WHERE v.volume_number = $1 AND i.issue_number = $2
      `;
      
      const existingResult = await this.syncer.db.query(existingQuery, [volume, issue]);
      
      if (existingResult.rows.length > 0) {
        const { issue_id } = existingResult.rows[0];
        
        await this.syncer.db.query(
          'DELETE FROM congressional_record_issue WHERE issue_id = $1', 
          [issue_id]
        );
        
        logger.info(`   🧹 Cleaned up existing data for Volume ${volume}, Issue ${issue}`);
      }
      
    } catch (error) {
      logger.warn('Failed to clean up existing data', { volume, issue, error: error.message });
    }
  }

  /**
   * Store sections and articles for an issue with all improvements
   */
  async storeSectionsAndArticles(volume, issue, sections, apiIssueData) {
    logger.info(`   💾 Storing ${sections.length} sections and articles...`);

    try {
      // Create or get volume record
      const volumeData = {
        volume_number: volume,
        congress: parseInt(apiIssueData.congress),
        session_number: parseInt(apiIssueData.sessionNumber),
        year: new Date(apiIssueData.issueDate).getFullYear(),
        metadata: JSON.stringify({ 
          sync_source: 'daily_sync',
          sync_timestamp: new Date().toISOString()
        })
      };

      const volumeResult = await this.syncer.db.upsertCongressionalRecordVolume(volumeData);

      // Create issue record with real API date to avoid constraints
      const issueData = {
        volume_id: volumeResult.volume_id,
        issue_number: issue,
        issue_date: new Date(apiIssueData.issueDate),
        congress: parseInt(apiIssueData.congress),
        session_number: parseInt(apiIssueData.sessionNumber),
        metadata: JSON.stringify({ 
          sync_source: 'daily_sync',
          sync_timestamp: new Date().toISOString(),
          original_issue_data: apiIssueData
        })
      };

      const issueResult = await this.syncer.db.upsertCongressionalRecordIssue(issueData);

      let totalStoredArticles = 0;

      // Process each section
      for (const section of sections) {
        const sectionArticles = section.sectionArticles || [];
        
        if (sectionArticles.length === 0) continue;

        // Map section name to database enum
        const dbSectionName = this.mapSectionName(section.name);
        
        // Get start/end pages from articles
        const startPage = sectionArticles[0]?.startPage || 'S1';
        const endPage = sectionArticles[sectionArticles.length - 1]?.endPage || startPage;

        // Create section record
        const sectionData = {
          issue_id: issueResult.issue_id,
          name: dbSectionName,
          start_page: startPage,
          end_page: endPage,
          metadata: JSON.stringify({ 
            original_name: section.name,
            article_count: sectionArticles.length,
            sync_source: 'daily_sync'
          })
        };

        const sectionResult = await this.syncer.db.upsertCongressionalRecordSection(sectionData);

        // Store articles for this section with enhanced uniqueness detection
        for (let articleIdx = 0; articleIdx < sectionArticles.length; articleIdx++) {
          const article = sectionArticles[articleIdx];
          
          try {
            // ENHANCED UNIQUENESS: Extract text URLs for metadata and use for uniqueness
            const textUrls = article.text ? article.text.map(t => ({ type: t.type, url: t.url })) : [];
            const primaryUrl = textUrls.find(t => t.type === 'Formatted Text')?.url || textUrls[0]?.url || '';
            
            const articleData = {
              section_id: sectionResult.section_id,
              title: article.title || `${section.name} Article ${articleIdx + 1}`,
              start_page: article.startPage || startPage,
              end_page: article.endPage || article.startPage || startPage,
              content_text: null, // Would need separate API calls
              word_count: 0,
              character_count: 0,
              text_url: primaryUrl, // CRITICAL: Include for uniqueness
              metadata: JSON.stringify({
                text_urls: textUrls,
                section_name: section.name,
                original_article_index: articleIdx,
                sync_source: 'daily_sync',
                primary_url: primaryUrl
              })
            };

            const articleResult = await this.syncer.db.upsertCongressionalRecordArticle(articleData);
            if (articleResult.article_id) {
              totalStoredArticles++;
            }

          } catch (articleError) {
            logger.error(`❌ Failed to store article ${articleIdx + 1} in section "${section.name}"`, {
              volume, issue,
              title: article.title,
              error: articleError.message
            });
            this.stats.errors.push({
              volume, issue,
              section: section.name,
              article: articleIdx + 1,
              title: article.title,
              error: articleError.message
            });
          }
        }
      }

      return totalStoredArticles;

    } catch (error) {
      logger.error('❌ Failed to store sections and articles', { volume, issue, error: error.message });
      throw error;
    }
  }

  /**
   * Sync a single issue (always processes recent issues)
   */
  async syncSingleIssue(issueData, index, total) {
    const { volume, issue, apiData } = issueData;
    
    logger.info(`\n📄 [${index + 1}/${total}] Processing Volume ${volume}, Issue ${issue}...`);

    try {
      // Check if issue already exists and how many articles it has
      const existingInfo = await this.checkIssueExists(volume, issue);
      
      if (existingInfo.exists) {
        logger.info(`   ℹ️ Issue already exists with ${existingInfo.articleCount} articles - re-syncing to ensure completeness`);
        await this.cleanupExistingData(volume, issue);
      }

      // Get all article sections for this issue with fixed pagination
      const sections = await this.processIssueArticles(volume, issue);
      
      if (sections.length === 0) {
        logger.warn(`⚠️ No sections found for Volume ${volume}, Issue ${issue}`);
        return;
      }

      // Store all sections and articles using real API data
      const storedCount = await this.storeSectionsAndArticles(volume, issue, sections, apiData);

      this.stats.totalArticlesStored += storedCount;
      this.stats.issuesProcessed++;

      logger.info(`   ✅ Success! Stored ${storedCount} articles`);

      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error(`❌ Failed to sync Volume ${volume}, Issue ${issue}`, {
        error: error.message
      });
      this.stats.errors.push({
        volume, issue,
        error: error.message
      });
      // Continue with next issue rather than failing entirely
    }
  }

  /**
   * Run the daily sync
   */
  async runDailySync() {
    const startTime = Date.now();
    
    logger.info('🌅 Starting Daily Congressional Record Sync');
    logger.info('📋 Target: 2 most recent 119th Congress issues');
    logger.info('🔧 Features: Fixed pagination, enhanced uniqueness, real API dates');
    
    try {
      // Get the 2 most recent issues
      const recentIssues = await this.getRecentIssues();

      // Process each issue
      for (let i = 0; i < recentIssues.length; i++) {
        await this.syncSingleIssue(recentIssues[i], i, recentIssues.length);
      }

      // Print final summary
      this.printSummary(Date.now() - startTime);

    } catch (error) {
      logger.error('❌ Daily sync failed', { error: error.message });
      this.stats.errors.push({
        step: 'overall',
        error: error.message
      });
    } finally {
      await this.syncer.close();
    }
  }

  /**
   * Print final summary
   */
  printSummary(duration) {
    const minutes = Math.floor(duration / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);

    logger.info('\n📊 Daily Congressional Record Sync Summary');
    logger.info('═'.repeat(50));
    logger.info(`🎯 Issues Processed: ${this.stats.issuesProcessed}`);
    logger.info(`📋 Total Articles Stored: ${this.stats.totalArticlesStored}`);
    logger.info(`⏱️ Duration: ${minutes}m ${seconds}s`);

    if (this.stats.errors.length > 0) {
      logger.info(`\n❌ Errors (${this.stats.errors.length}):`);
      this.stats.errors.forEach((error, idx) => {
        const location = error.volume && error.issue ? `Volume ${error.volume}, Issue ${error.issue}` : 
                        error.step || 'Unknown';
        logger.info(`   ${idx + 1}. ${location}: ${error.error}`);
      });
    }

    logger.info('\n═'.repeat(50));
    if (this.stats.errors.length === 0 && this.stats.issuesProcessed > 0) {
      logger.info('🎉 Daily sync completed successfully!');
    } else if (this.stats.issuesProcessed > 0) {
      logger.info('⚠️ Daily sync completed with some errors, but issues were processed.');
    } else {
      logger.info('❌ Daily sync failed - no issues were processed.');
    }

    // Exit code for cron monitoring
    if (this.stats.errors.length > 0 && this.stats.issuesProcessed === 0) {
      process.exit(1); // Failure
    } else {
      process.exit(0); // Success
    }
  }
}

// Run the daily sync if called directly
if (require.main === module) {
  const dailySync = new DailyCongressionalRecordSync();
  dailySync.runDailySync().catch(error => {
    logger.error('Daily sync script crashed:', error);
    process.exit(1);
  });
}

module.exports = DailyCongressionalRecordSync;