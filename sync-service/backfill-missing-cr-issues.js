#!/usr/bin/env node

/**
 * Backfill Missing Congressional Record Issues
 *
 * Temporary script to sync missing Congressional Record issues from Volume 171.
 * Based on the working daily-congressional-record-sync.js script.
 *
 * Missing issues identified:
 * - Issue 45 (single gap)
 * - Issues 155-196 (sync outage period: Sept 19 - Nov 21, 2025)
 *
 * Usage: node backfill-missing-cr-issues.js
 */

const CongressionalRecordSyncer = require('./syncers/congressional-record-syncer');
const logger = require('./lib/logger');

const { normalizeRequiredPage, firstUsablePage } = CongressionalRecordSyncer;

// The missing issues to backfill
// Note: Issues 155-196 were already synced successfully
// Only Issue 45 remains
const MISSING_ISSUES = [
  45
];

const VOLUME = 171;

class BackfillCongressionalRecord {
  constructor() {
    this.syncer = new CongressionalRecordSyncer();
    this.stats = {
      issuesProcessed: 0,
      issuesSkipped: 0,
      totalArticlesStored: 0,
      sectionsSkipped: 0,
      sectionsUnmapped: 0,
      articlesSkipped: 0,
      errors: []
    };
  }

  /**
   * Map an API section name to a cr_section_type enum value.
   *
   * Returns null for anything not in the table. There is no safe default: a
   * guess files the section's articles under the wrong chamber, which reads as
   * perfectly ordinary data and quietly skews every chamber-filtered query.
   *
   * @param {string} apiSectionName - Section name as the API reports it
   * @returns {string|null} Enum value, or null if unrecognized
   */
  mapSectionName(apiSectionName) {
    const sectionMap = {
      'Daily Digest': 'Daily Digest',
      'Extensions of Remarks Section': 'Extensions of Remarks',
      'House Section': 'House',
      'Senate Section': 'Senate'
    };

    return sectionMap[apiSectionName] || null;
  }

  /**
   * Fetch issue data from the API
   */
  async fetchIssueData(volume, issue) {
    try {
      const response = await this.syncer.client.makeRequest(`/daily-congressional-record/${volume}/${issue}`);

      if (!response.issue) {
        return null;
      }

      return {
        volume: parseInt(response.issue.volumeNumber),
        issue: parseInt(response.issue.issueNumber),
        date: response.issue.issueDate,
        congress: parseInt(response.issue.congress),
        session: parseInt(response.issue.sessionNumber),
        apiData: response.issue
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // Issue doesn't exist in the API
      }
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

    logger.info(`   Fetching articles for Volume ${volume}, Issue ${issue}...`);

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

        const articleCountOnPage = sections.reduce((sum, section) => {
          return sum + (section.sectionArticles ? section.sectionArticles.length : 0);
        }, 0);

        logger.info(`   Page ${pageNum}: ${sections.length} sections, ${articleCountOnPage} articles`);

        hasMore = articleCountOnPage === limit;
        offset += limit;
        pageNum++;

      } catch (error) {
        logger.error(`Error fetching articles for Volume ${volume}, Issue ${issue}`, {
          volume, issue, offset, limit, error: error.message
        });
        throw error;
      }
    }

    const totalArticles = allSections.reduce((sum, section) => {
      return sum + (section.sectionArticles ? section.sectionArticles.length : 0);
    }, 0);

    logger.info(`   Total articles found: ${totalArticles} across ${allSections.length} sections`);
    return allSections;
  }

  /**
   * Clean up existing data for an issue if it exists
   *
   * CAUTION -- known data-loss window, left deliberately unfixed. Same shape as
   * the one in daily-congressional-record-sync.js.
   *
   * This DELETE runs outside any transaction, so it commits on its own, and it
   * cascades: congressional_record_section and congressional_record_article are
   * both ON DELETE CASCADE from the issue. The rewrite happens afterwards, in
   * separate statements. If processIssueArticles then throws (it rethrows on any
   * API error), or the API returns no sections, the issue is left with its old
   * rows gone and nothing written back.
   *
   * The cascade also reaches action_congressional_record_reference, whose
   * issue_id, section_id and article_id are ON DELETE SET NULL. A resolved
   * reference pointing at this issue would have issue_id and section_id both set
   * to NULL, violating its logical_resolution CHECK and failing this DELETE --
   * which the catch below swallows as a warning, after which the sync upserts on
   * top of data it believes it deleted.
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

        logger.info(`   Cleaned up existing data for Volume ${volume}, Issue ${issue}`);
      }

    } catch (error) {
      logger.warn('Failed to clean up existing data', { volume, issue, error: error.message });
    }
  }

  /**
   * Store sections and articles for an issue
   */
  async storeSectionsAndArticles(volume, issue, sections, apiIssueData) {
    logger.info(`   Storing ${sections.length} sections and articles...`);

    try {
      const volumeData = {
        volume_number: volume,
        congress: parseInt(apiIssueData.congress),
        session_number: parseInt(apiIssueData.sessionNumber),
        year: new Date(apiIssueData.issueDate).getFullYear(),
        metadata: JSON.stringify({
          sync_source: 'backfill',
          sync_timestamp: new Date().toISOString()
        })
      };

      const volumeResult = await this.syncer.db.upsertCongressionalRecordVolume(volumeData);

      const issueData = {
        volume_id: volumeResult.volume_id,
        issue_number: issue,
        issue_date: new Date(apiIssueData.issueDate),
        congress: parseInt(apiIssueData.congress),
        session_number: parseInt(apiIssueData.sessionNumber),
        metadata: JSON.stringify({
          sync_source: 'backfill',
          sync_timestamp: new Date().toISOString(),
          original_issue_data: apiIssueData
        })
      };

      const issueResult = await this.syncer.db.upsertCongressionalRecordIssue(issueData);

      let totalStoredArticles = 0;

      for (const section of sections) {
        const sectionArticles = section.sectionArticles || [];

        if (sectionArticles.length === 0) continue;

        const dbSectionName = this.mapSectionName(section.name);

        if (dbSectionName === null) {
          this.stats.sectionsUnmapped++;
          logger.warn('Skipping CR section with an unrecognized name', {
            volume, issue,
            section: section.name,
            articlesDropped: sectionArticles.length
          });
          continue;
        }

        // Pages come from the articles themselves. A section whose articles
        // never report one has no start page we can stand behind, so it is
        // skipped rather than stored under a made-up number.
        const sectionStartPage = firstUsablePage(sectionArticles, a => a.startPage);

        if (sectionStartPage === null) {
          this.stats.sectionsSkipped++;
          logger.warn('Skipping CR section with no usable start page', {
            volume, issue,
            section: section.name,
            articlesDropped: sectionArticles.length
          });
          continue;
        }

        // end_page is nullable, so an unknown end page stays unknown.
        const sectionEndPage = firstUsablePage([...sectionArticles].reverse(), a => a.endPage);

        const sectionData = {
          issue_id: issueResult.issue_id,
          name: dbSectionName,
          start_page: sectionStartPage,
          end_page: sectionEndPage,
          metadata: JSON.stringify({
            original_name: section.name,
            article_count: sectionArticles.length,
            sync_source: 'backfill'
          })
        };

        const sectionResult = await this.syncer.db.upsertCongressionalRecordSection(sectionData);

        for (let articleIdx = 0; articleIdx < sectionArticles.length; articleIdx++) {
          const article = sectionArticles[articleIdx];

          try {
            const textUrls = article.text ? article.text.map(t => ({ type: t.type, url: t.url })) : [];
            const primaryUrl = textUrls.find(t => t.type === 'Formatted Text')?.url || textUrls[0]?.url || '';

            const articleStartPage = normalizeRequiredPage(article.startPage);

            if (articleStartPage === null) {
              this.stats.articlesSkipped++;
              logger.warn('Skipping CR article with no start page', {
                volume, issue,
                section: section.name,
                title: article.title
              });
              continue;
            }

            const articleData = {
              section_id: sectionResult.section_id,
              title: article.title || `${section.name} Article ${articleIdx + 1}`,
              start_page: articleStartPage,
              end_page: normalizeRequiredPage(article.endPage),
              content_text: null,
              word_count: 0,
              character_count: 0,
              text_url: primaryUrl,
              metadata: JSON.stringify({
                text_urls: textUrls,
                section_name: section.name,
                original_article_index: articleIdx,
                sync_source: 'backfill',
                primary_url: primaryUrl
              })
            };

            const articleResult = await this.syncer.db.upsertCongressionalRecordArticle(articleData);
            if (articleResult.article_id) {
              totalStoredArticles++;
            }

          } catch (articleError) {
            logger.error(`Failed to store article ${articleIdx + 1} in section "${section.name}"`, {
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
      logger.error('Failed to store sections and articles', { volume, issue, error: error.message });
      throw error;
    }
  }

  /**
   * Sync a single issue
   */
  async syncSingleIssue(volume, issue, index, total) {
    logger.info(`\n[${index + 1}/${total}] Processing Volume ${volume}, Issue ${issue}...`);

    try {
      // Check if issue already exists
      const existingInfo = await this.checkIssueExists(volume, issue);

      if (existingInfo.exists && existingInfo.articleCount > 0) {
        logger.info(`   Issue already exists with ${existingInfo.articleCount} articles - skipping`);
        this.stats.issuesSkipped++;
        return;
      }

      // Fetch issue data from API
      const issueData = await this.fetchIssueData(volume, issue);

      if (!issueData) {
        logger.warn(`   Issue ${issue} not found in API - skipping`);
        this.stats.issuesSkipped++;
        return;
      }

      // Clean up any partial data
      if (existingInfo.exists) {
        await this.cleanupExistingData(volume, issue);
      }

      // Get all article sections
      const sections = await this.processIssueArticles(volume, issue);

      if (sections.length === 0) {
        logger.warn(`   No sections found for Volume ${volume}, Issue ${issue}`);
        this.stats.issuesSkipped++;
        return;
      }

      // Store all sections and articles
      const storedCount = await this.storeSectionsAndArticles(volume, issue, sections, issueData.apiData);

      this.stats.totalArticlesStored += storedCount;
      this.stats.issuesProcessed++;

      logger.info(`   Success! Stored ${storedCount} articles`);

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 1500));

    } catch (error) {
      logger.error(`Failed to sync Volume ${volume}, Issue ${issue}`, {
        error: error.message
      });
      this.stats.errors.push({
        volume, issue,
        error: error.message
      });
    }
  }

  /**
   * Run the backfill
   */
  async runBackfill() {
    const startTime = Date.now();

    logger.info('='.repeat(60));
    logger.info('Congressional Record Backfill Script');
    logger.info('='.repeat(60));
    logger.info(`Target: Volume ${VOLUME}, ${MISSING_ISSUES.length} missing issues`);
    logger.info(`Issues: ${MISSING_ISSUES[0]} and ${MISSING_ISSUES[1]}-${MISSING_ISSUES[MISSING_ISSUES.length - 1]}`);
    logger.info('='.repeat(60));

    try {
      for (let i = 0; i < MISSING_ISSUES.length; i++) {
        await this.syncSingleIssue(VOLUME, MISSING_ISSUES[i], i, MISSING_ISSUES.length);
      }

      this.printSummary(Date.now() - startTime);

    } catch (error) {
      logger.error('Backfill failed', { error: error.message });
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

    logger.info('\n' + '='.repeat(60));
    logger.info('Backfill Summary');
    logger.info('='.repeat(60));
    logger.info(`Issues Processed: ${this.stats.issuesProcessed}`);
    logger.info(`Issues Skipped: ${this.stats.issuesSkipped}`);
    logger.info(`Total Articles Stored: ${this.stats.totalArticlesStored}`);

    if (this.stats.sectionsSkipped > 0 || this.stats.articlesSkipped > 0) {
      logger.info(`Skipped, no usable start page: ${this.stats.sectionsSkipped} sections, ${this.stats.articlesSkipped} articles`);
    }

    if (this.stats.sectionsUnmapped > 0) {
      logger.info(`Skipped, unrecognized section name: ${this.stats.sectionsUnmapped} sections`);
    }
    logger.info(`Duration: ${minutes}m ${seconds}s`);

    if (this.stats.errors.length > 0) {
      logger.info(`\nErrors (${this.stats.errors.length}):`);
      this.stats.errors.forEach((error, idx) => {
        const location = error.volume && error.issue ? `Volume ${error.volume}, Issue ${error.issue}` :
                        error.step || 'Unknown';
        logger.info(`   ${idx + 1}. ${location}: ${error.error}`);
      });
    }

    logger.info('='.repeat(60));
    if (this.stats.errors.length === 0 && this.stats.issuesProcessed > 0) {
      logger.info('Backfill completed successfully!');
    } else if (this.stats.issuesProcessed > 0) {
      logger.info('Backfill completed with some errors.');
    } else {
      logger.info('Backfill failed - no issues were processed.');
    }

    process.exit(this.stats.errors.length > 0 && this.stats.issuesProcessed === 0 ? 1 : 0);
  }
}

// Run the backfill
if (require.main === module) {
  const backfill = new BackfillCongressionalRecord();
  backfill.runBackfill().catch(error => {
    logger.error('Backfill script crashed:', error);
    process.exit(1);
  });
}

module.exports = BackfillCongressionalRecord;
