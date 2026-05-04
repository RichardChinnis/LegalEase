#!/usr/bin/env node

/**
 * News Ingestion Scheduled Job
 *
 * Runs periodically to:
 * 1. Fetch news from configured RSS feeds
 * 2. Extract bill mentions and trending topics
 * 3. Match topics against bills in the database
 * 4. Generate and optionally auto-create spotlight suggestions
 *
 * Usage:
 *   node news-ingestion-job.js [--auto-create] [--min-score=N] [--verbose]
 *
 * Recommended schedule: Every 2-4 hours via cron or systemd timer
 * Example cron entry (runs every 4 hours):
 *   0 0,4,8,12,16,20 * * * cd /var/www/html/congress-api/sync-service && node news-ingestion-job.js --auto-create
 */

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { NewsIngestionService } = require('./services/news-ingestion-service');
const { Pool } = require('pg');

// Parse command line arguments
const args = process.argv.slice(2);
const autoCreate = args.includes('--auto-create');
const verbose = args.includes('--verbose');
const minScoreArg = args.find(a => a.startsWith('--min-score='));
const minScore = minScoreArg ? parseInt(minScoreArg.split('=')[1]) : 15;

// Logging helpers
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [NewsJob] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [NewsJob] ${message}`);
  }
}

function logVerbose(message, data = null) {
  if (verbose) {
    log(message, data);
  }
}

async function runNewsIngestion() {
  const startTime = Date.now();
  log('Starting news ingestion job...');
  log(`Configuration: autoCreate=${autoCreate}, minScore=${minScore}, verbose=${verbose}`);

  // Create a shared pool for both the service and our updates
  // Use congress_admin for sync jobs since they need write access
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'congress_api',
    user: process.env.SYNC_DB_USER || process.env.DB_USER || 'congress_admin',
    password: process.env.SYNC_DB_PASSWORD || process.env.DB_PASSWORD
  });

  // Pass pool to service - we'll manage closing it ourselves
  const newsService = new NewsIngestionService({ pool, managePool: false });

  try {
    // Step 1: Generate spotlight suggestions from news analysis
    log('Fetching and analyzing news feeds...');
    const analysis = await newsService.generateSpotlightSuggestions();

    if (!analysis.success) {
      log('News analysis failed:', { error: analysis.error });
      process.exit(1);
    }

    log(`Analysis complete. ${analysis.newsItemsAnalyzed} items from RSS feeds.`);

    // Log feed errors if any
    if (analysis.feedErrors && analysis.feedErrors.length > 0) {
      log('Feed errors:', analysis.feedErrors);
    }

    // Step 2: Log trending topics
    const topTopics = Object.entries(analysis.trendingTopics)
      .slice(0, 5)
      .map(([topic, data]) => `${topic}: ${data.score.toFixed(1)}`);

    log('Top trending topics:', topTopics);

    logVerbose('Top keywords:', analysis.topKeywords.slice(0, 10).map(k => `${k.term}(${k.count})`));

    // Step 3: Log direct bill mentions
    log(`Found ${analysis.directMentions.length} bills directly mentioned in news`);

    if (verbose && analysis.directMentions.length > 0) {
      logVerbose('Direct mentions:', analysis.directMentions.slice(0, 5).map(b => ({
        bill: `${b.bill_type} ${b.bill_number}`,
        title: b.title?.substring(0, 50),
        mentionCount: b.mentionCount
      })));
    }

    // Step 4: Log topical matches
    log(`Found ${analysis.topicalMatches.length} bills matching trending topics`);

    if (verbose && analysis.topicalMatches.length > 0) {
      logVerbose('Topical matches:', analysis.topicalMatches.slice(0, 5).map(b => ({
        bill: `${b.billType} ${b.billNumber}`,
        title: b.title?.substring(0, 50),
        score: b.relevanceScore
      })));
    }

    // Step 5: Log spotlight suggestions
    log(`Generated ${analysis.spotlightSuggestions.length} spotlight suggestions`);

    if (analysis.spotlightSuggestions.length > 0) {
      log('Top suggestions:');
      analysis.spotlightSuggestions.slice(0, 5).forEach((s, i) => {
        log(`  ${i + 1}. [${s.bill_type} ${s.bill_number}] Score: ${s.score} - ${s.reason}`);
        log(`     Headline: ${s.suggestedHeadline?.substring(0, 60)}...`);
      });
    }

    // Step 6: Store analysis results
    log('Storing analysis results...');
    const analysisId = await newsService.storeAnalysisResults(analysis);
    if (analysisId) {
      log(`Analysis stored with ID: ${analysisId}`);
    }

    // Step 7: Update trending topics table
    log('Updating trending topics...');
    await updateTrendingTopics(pool, analysis.topKeywords, analysis.trendingTopics);

    // Step 8: Optionally auto-create spotlights
    if (autoCreate) {
      log(`Auto-creating spotlights with minScore=${minScore}...`);
      const created = await newsService.autoCreateSpotlights(analysis.spotlightSuggestions, minScore);

      if (created.length > 0) {
        log(`Auto-created ${created.length} spotlight(s):`, created);
      } else {
        log('No spotlights met the threshold for auto-creation');
      }
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`News ingestion job completed in ${duration}s`);

    log('Summary:', {
      itemsAnalyzed: analysis.newsItemsAnalyzed,
      feedErrors: analysis.feedErrors.length,
      directMentions: analysis.directMentions.length,
      topicalMatches: analysis.topicalMatches.length,
      suggestions: analysis.spotlightSuggestions.length,
      topTopics: topTopics.slice(0, 3),
      duration: `${duration}s`
    });

  } catch (error) {
    log('Error running news ingestion:', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    // Close the shared pool
    await pool.end();
  }
}

/**
 * Update the trending_topic table with current keyword data
 */
async function updateTrendingTopics(pool, keywords, topicScores) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Mark all topics as inactive (will reactivate if still trending)
    await client.query(`
      UPDATE trending_topic
      SET is_active = false
      WHERE last_seen < NOW() - INTERVAL '24 hours'
    `);

    // Upsert each significant keyword
    for (const keyword of keywords.slice(0, 50)) {
      // Determine category from topicScores
      let category = null;
      for (const [cat, data] of Object.entries(topicScores)) {
        if (data.matchedTerms.includes(keyword.term)) {
          category = cat;
          break;
        }
      }

      await client.query(`
        INSERT INTO trending_topic (topic_name, category, score, source_count, last_seen, is_active)
        VALUES ($1, $2, $3, $4, NOW(), true)
        ON CONFLICT (topic_name)
        DO UPDATE SET
          score = EXCLUDED.score,
          source_count = EXCLUDED.source_count,
          last_seen = NOW(),
          is_active = true,
          category = COALESCE(EXCLUDED.category, trending_topic.category)
      `, [keyword.term, category, keyword.weight, keyword.sourceCount]);
    }

    await client.query('COMMIT');
    logVerbose('Updated trending topics table');

  } catch (error) {
    await client.query('ROLLBACK');
    log('Error updating trending topics:', { error: error.message });
  } finally {
    client.release();
  }
}

// Run the job
runNewsIngestion()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    log('Unhandled error:', { error: error.message });
    process.exit(1);
  });
