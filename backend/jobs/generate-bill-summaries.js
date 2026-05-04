#!/usr/bin/env node
/**
 * Batch Job: Generate Bill Summaries
 *
 * Selects bills that need summaries (have text but no AI summaries)
 * and generates all five summary types (simple, short, optimistic, cynical, realistic).
 *
 * Designed for scheduled execution with robust error handling and logging.
 *
 * Usage:
 *   node jobs/generate-bill-summaries.js [--limit=N] [--concurrency=N] [--dry-run]
 *
 * Options:
 *   --limit=N       Process at most N bills (default: 25)
 *   --concurrency=N Process N bills in parallel (default: 4)
 *   --dry-run       Query bills but don't generate summaries
 *   --verbose       Enable verbose logging
 *
 * Environment:
 *   Uses jobs/.env for database credentials (write access)
 *   Falls back to backend/.env for LLM API keys
 */

const path = require('path');

// Load job-specific env first (for DB write credentials), then backend env (for API keys)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Won't override existing

const { Pool } = require('pg');
const https = require('https');
const http = require('http');

// Job configuration
const JOB_CONFIG = {
  name: 'generate-bill-summaries',
  defaultLimit: 25,
  defaultConcurrency: 4, // Process 4 bills in parallel by default
  retryDelayMs: 5000,
  maxRetries: 3,
  rateLimitBackoffMs: 60000, // 1 minute backoff on rate limit
  requestTimeoutMs: 30000,
};

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    acc[key] = value ?? true;
  }
  return acc;
}, {});

const BATCH_LIMIT = parseInt(args.limit, 10) || JOB_CONFIG.defaultLimit;
const CONCURRENCY = parseInt(args.concurrency, 10) || JOB_CONFIG.defaultConcurrency;
const DRY_RUN = args['dry-run'] === true;
const VERBOSE = args.verbose === true;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'congress_api',
  user: process.env.DB_USER || 'congress_admin',
  password: process.env.DB_PASSWORD,
});

// Logger utility
const Logger = {
  _formatTimestamp() {
    return new Date().toISOString();
  },

  _formatMessage(level, message, meta = {}) {
    const timestamp = this._formatTimestamp();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${JOB_CONFIG.name}] [${level}] ${message}${metaStr}`;
  },

  info(message, meta = {}) {
    console.log(this._formatMessage('INFO', message, meta));
  },

  warn(message, meta = {}) {
    console.warn(this._formatMessage('WARN', message, meta));
  },

  error(message, meta = {}) {
    console.error(this._formatMessage('ERROR', message, meta));
  },

  debug(message, meta = {}) {
    if (VERBOSE) {
      console.log(this._formatMessage('DEBUG', message, meta));
    }
  },

  success(message, meta = {}) {
    console.log(this._formatMessage('SUCCESS', message, meta));
  },

  // Log LLM response metadata (always called on success or failure)
  llmMetadata(action, billId, analysisType, metadata) {
    const logData = {
      billId,
      analysisType,
      action,
      ...metadata
    };
    console.log(this._formatMessage('LLM', `${action} for ${billId}/${analysisType}`, logData));
  }
};

// LLM Error classification
const LLMErrorType = {
  RATE_LIMIT: 'rate_limit',
  OVERLOADED: 'overloaded',
  AUTHENTICATION: 'authentication',
  INVALID_REQUEST: 'invalid_request',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown'
};

function classifyLLMError(error) {
  const message = error.message?.toLowerCase() || '';
  const status = error.status || error.statusCode;

  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return LLMErrorType.RATE_LIMIT;
  }
  if (status === 529 || message.includes('overloaded') || message.includes('capacity')) {
    return LLMErrorType.OVERLOADED;
  }
  if (status === 401 || status === 403 || message.includes('authentication') || message.includes('api key')) {
    return LLMErrorType.AUTHENTICATION;
  }
  if (status === 400 || message.includes('invalid')) {
    return LLMErrorType.INVALID_REQUEST;
  }
  if (message.includes('econnrefused') || message.includes('enotfound') || message.includes('network')) {
    return LLMErrorType.NETWORK;
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return LLMErrorType.TIMEOUT;
  }
  return LLMErrorType.UNKNOWN;
}

function isRetryableError(errorType) {
  return [
    LLMErrorType.RATE_LIMIT,
    LLMErrorType.OVERLOADED,
    LLMErrorType.NETWORK,
    LLMErrorType.TIMEOUT
  ].includes(errorType);
}

function getBackoffMs(errorType, attempt) {
  if (errorType === LLMErrorType.RATE_LIMIT) {
    return JOB_CONFIG.rateLimitBackoffMs * attempt;
  }
  if (errorType === LLMErrorType.OVERLOADED) {
    return JOB_CONFIG.rateLimitBackoffMs * 2 * attempt;
  }
  return JOB_CONFIG.retryDelayMs * Math.pow(2, attempt - 1);
}

// Fetch bill text from URL
async function fetchBillText(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, { timeout: JOB_CONFIG.requestTimeoutMs }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        fetchBillText(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} fetching bill text`));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        // Extract text content from HTML (simple extraction)
        const textContent = extractTextFromHtml(data);
        resolve(textContent);
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout fetching bill text'));
    });
  });
}

// Simple HTML to text extraction
function extractTextFromHtml(html) {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert common elements to readable format
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<li>/gi, '• ');
  text = text.replace(/<\/li>/gi, '\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');
  text = text.replace(/&rsquo;/g, "'");
  text = text.replace(/&lsquo;/g, "'");
  text = text.replace(/&rdquo;/g, '"');
  text = text.replace(/&ldquo;/g, '"');

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// Query for bills needing summaries
// Uses the latest/best text version per bill (prefers enacted > enrolled > engrossed > etc.)
async function getBillsNeedingSummaries(limit) {
  const query = `
    WITH ranked_text_versions AS (
      SELECT
        b.bill_id,
        b.congress_id,
        b.bill_type,
        b.bill_number,
        b.title,
        b.introduced_date,
        b.latest_action_date,
        btv.version_type,
        btv.formats,
        -- Rank versions: prefer later stages of the legislative process
        ROW_NUMBER() OVER (
          PARTITION BY b.bill_id
          ORDER BY
            CASE btv.version_type
              WHEN 'Enrolled Bill' THEN 1
              WHEN 'Public Law' THEN 2
              WHEN 'Engrossed in Senate' THEN 3
              WHEN 'Engrossed in House' THEN 4
              WHEN 'Placed on Calendar Senate' THEN 5
              WHEN 'Placed on Calendar House' THEN 6
              WHEN 'Reported to Senate' THEN 7
              WHEN 'Reported to House' THEN 8
              WHEN 'Reported in Senate' THEN 9
              WHEN 'Reported in House' THEN 10
              WHEN 'Referred in Senate' THEN 11
              WHEN 'Referred in House' THEN 12
              WHEN 'Received in Senate' THEN 13
              WHEN 'Received in House' THEN 14
              WHEN 'Introduced in Senate' THEN 15
              WHEN 'Introduced in House' THEN 16
              ELSE 20
            END,
            btv.version_date DESC NULLS LAST
        ) as version_rank
      FROM bill b
      JOIN bill_text_version btv ON b.bill_id = btv.bill_id
      WHERE btv.formats IS NOT NULL
        AND btv.formats::text LIKE '%Formatted Text%'
    ),
    best_text_per_bill AS (
      SELECT * FROM ranked_text_versions WHERE version_rank = 1
    ),
    all_summary_types AS (
      SELECT unnest(ARRAY['simple', 'short', 'optimistic', 'cynical', 'realistic']) AS summary_type
    ),
    bills_with_missing_types AS (
      SELECT
        btp.*,
        array_agg(ast.summary_type ORDER BY
          CASE ast.summary_type
            WHEN 'simple' THEN 1
            WHEN 'short' THEN 2
            WHEN 'optimistic' THEN 3
            WHEN 'cynical' THEN 4
            WHEN 'realistic' THEN 5
          END
        ) AS missing_types
      FROM best_text_per_bill btp
      CROSS JOIN all_summary_types ast
      LEFT JOIN bill_ai_summary bas
        ON btp.bill_id = bas.bill_id AND ast.summary_type = bas.summary_type
      WHERE bas.bill_id IS NULL
      GROUP BY btp.bill_id, btp.congress_id, btp.bill_type, btp.bill_number,
               btp.title, btp.introduced_date, btp.latest_action_date,
               btp.version_type, btp.formats, btp.version_rank
    )
    SELECT
      bill_id,
      congress_id,
      bill_type,
      bill_number,
      title,
      introduced_date,
      version_type,
      formats,
      latest_action_date,
      missing_types
    FROM bills_with_missing_types
    ORDER BY latest_action_date DESC NULLS LAST, bill_id DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

// Extract text URL from formats JSON
function getTextUrl(formats) {
  let formatsArray = formats;

  // Handle double-encoded JSON string
  if (typeof formats === 'string') {
    try {
      formatsArray = JSON.parse(formats);
      if (typeof formatsArray === 'string') {
        formatsArray = JSON.parse(formatsArray);
      }
    } catch (e) {
      Logger.warn('Failed to parse formats JSON', { formats: String(formats).slice(0, 100) });
      return null;
    }
  }

  if (!Array.isArray(formatsArray)) {
    return null;
  }

  const textFormat = formatsArray.find(f => f.type === 'Formatted Text');
  return textFormat?.url || null;
}

// Generate summary with retry logic
async function generateSummaryWithRetry(billSummaryService, billText, analysisType, billId, options = {}) {
  let lastError = null;
  let attempt = 0;

  while (attempt < JOB_CONFIG.maxRetries) {
    attempt++;
    const startTime = Date.now();

    try {
      Logger.debug(`Generating ${analysisType} (attempt ${attempt}/${JOB_CONFIG.maxRetries})`, { billId });

      // generateAnalysis now returns { content, wasTruncated, originalLength, truncatedLength }
      const result = await billSummaryService.generateAnalysis(billText, analysisType, {}, options.context || {});

      const elapsed = Date.now() - startTime;

      // Log success metadata including truncation info
      Logger.llmMetadata('success', billId, analysisType, {
        attempt,
        elapsedMs: elapsed,
        contentLength: result.content.length,
        wasTruncated: result.wasTruncated,
        model: billSummaryService.getConfig().model
      });

      return { success: true, content: result.content, wasTruncated: result.wasTruncated };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorType = classifyLLMError(error);
      lastError = error;

      // Log error metadata
      Logger.llmMetadata('error', billId, analysisType, {
        attempt,
        elapsedMs: elapsed,
        errorType,
        errorMessage: error.message,
        errorStatus: error.status || error.statusCode,
        model: billSummaryService.getConfig().model
      });

      // Check if we should retry
      if (!isRetryableError(errorType)) {
        Logger.error(`Non-retryable error for ${billId}/${analysisType}`, { errorType, message: error.message });
        break;
      }

      if (attempt < JOB_CONFIG.maxRetries) {
        const backoffMs = getBackoffMs(errorType, attempt);
        Logger.warn(`Retryable error, backing off ${backoffMs}ms`, { billId, analysisType, errorType, attempt });
        await sleep(backoffMs);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    errorType: classifyLLMError(lastError),
    message: lastError?.message
  };
}

// Process a single bill
async function processBill(billSummaryService, bill) {
  const { bill_id, title, version_type, formats, missing_types } = bill;

  // Use missing_types from query, or default to all types if not provided
  const summaryTypes = missing_types || ['simple', 'short', 'optimistic', 'cynical', 'realistic'];

  const results = {
    billId: bill_id,
    title: title?.slice(0, 80),
    version: version_type,
    missingTypes: summaryTypes,
    summaries: {},
    success: true,
    errors: []
  };

  // Get text URL
  const textUrl = getTextUrl(formats);
  if (!textUrl) {
    Logger.error(`No text URL found for bill`, { billId: bill_id });
    results.success = false;
    results.errors.push({ type: 'no_text_url', message: 'No formatted text URL found' });
    return results;
  }

  Logger.info(`Processing bill: ${bill_id}`, {
    title: title?.slice(0, 60),
    version: version_type,
    missingTypes: summaryTypes.join(', ')
  });

  // Fetch bill text
  let billText;
  try {
    Logger.debug(`Fetching text from ${textUrl}`, { billId: bill_id });
    billText = await fetchBillText(textUrl);

    if (!billText || billText.length < 100) {
      throw new Error('Bill text too short or empty');
    }

    Logger.debug(`Fetched bill text`, { billId: bill_id, textLength: billText.length });

    // Check if truncation will occur (for logging)
    const truncationCheck = billSummaryService.truncateBillText(billText);
    if (truncationCheck.wasTruncated) {
      Logger.warn(`Bill text will be truncated for summary generation`, {
        billId: bill_id,
        originalLength: truncationCheck.originalLength,
        truncatedLength: truncationCheck.truncatedLength
      });
    }
  } catch (error) {
    Logger.error(`Failed to fetch bill text`, { billId: bill_id, error: error.message, url: textUrl });
    results.success = false;
    results.errors.push({ type: 'fetch_error', message: error.message });
    return results;
  }

  // Generate summaries in order (realistic depends on optimistic and cynical)
  const generated = {};

  // If realistic is needed but optimistic/cynical are not in missing_types,
  // we need to fetch them from the database
  if (summaryTypes.includes('realistic')) {
    const needFromDb = [];
    if (!summaryTypes.includes('optimistic')) needFromDb.push('optimistic');
    if (!summaryTypes.includes('cynical')) needFromDb.push('cynical');

    if (needFromDb.length > 0) {
      try {
        const existingResult = await pool.query(
          `SELECT summary_type, content FROM bill_ai_summary
           WHERE bill_id = $1 AND summary_type = ANY($2)`,
          [bill_id, needFromDb]
        );
        for (const row of existingResult.rows) {
          generated[row.summary_type] = row.content;
          Logger.debug(`Loaded existing ${row.summary_type} from database for realistic prereq`, { billId: bill_id });
        }
      } catch (dbError) {
        Logger.warn(`Failed to fetch prerequisites from database`, { billId: bill_id, error: dbError.message });
      }
    }
  }

  for (const summaryType of summaryTypes) {
    // Build context for realistic type
    const context = summaryType === 'realistic'
      ? { optimistic: generated.optimistic, cynical: generated.cynical }
      : {};

    // Skip realistic if we don't have both prerequisites
    if (summaryType === 'realistic' && (!generated.optimistic || !generated.cynical)) {
      Logger.warn(`Skipping realistic - missing prerequisites`, { billId: bill_id });
      results.errors.push({
        type: 'skipped',
        summaryType: 'realistic',
        message: 'Missing optimistic or cynical prerequisite'
      });
      continue;
    }

    const result = await generateSummaryWithRetry(
      billSummaryService,
      billText,
      summaryType,
      bill_id,
      { context }
    );

    if (result.success) {
      generated[summaryType] = result.content;
      results.summaries[summaryType] = { success: true, length: result.content.length };

      // Save to database
      try {
        await pool.query(
          `SELECT * FROM upsert_bill_summary($1, $2, $3, $4, $5)`,
          [bill_id, summaryType, result.content, version_type, billSummaryService.getConfig().model]
        );
        Logger.debug(`Saved ${summaryType} summary to database`, { billId: bill_id });
      } catch (dbError) {
        Logger.error(`Failed to save summary to database`, {
          billId: bill_id,
          summaryType,
          error: dbError.message
        });
        results.errors.push({ type: 'db_save_error', summaryType, message: dbError.message });
      }
    } else {
      results.summaries[summaryType] = {
        success: false,
        errorType: result.errorType,
        message: result.message
      };
      results.errors.push({
        type: result.errorType,
        summaryType,
        message: result.message
      });

      // If we hit a rate limit or overload, pause before continuing
      if (result.errorType === LLMErrorType.RATE_LIMIT || result.errorType === LLMErrorType.OVERLOADED) {
        Logger.warn(`Rate limited - pausing before next summary type`, { billId: bill_id });
        await sleep(JOB_CONFIG.rateLimitBackoffMs);
      }
    }
  }

  // Determine overall success (at least one summary was generated)
  const successfulSummaries = Object.values(results.summaries).filter(s => s.success === true);
  results.success = successfulSummaries.length > 0;
  results.generatedCount = successfulSummaries.length;

  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process bills with concurrency limit using a worker pool pattern
 * @param {Array} bills - Bills to process
 * @param {number} concurrency - Max concurrent workers
 * @param {Function} processor - Async function to process each bill
 * @returns {Promise<Array>} - Results from all workers
 */
async function processWithConcurrency(bills, concurrency, processor) {
  const results = [];
  let index = 0;
  let completed = 0;
  const total = bills.length;

  async function worker(workerId) {
    while (index < bills.length) {
      const currentIndex = index++;
      const bill = bills[currentIndex];

      Logger.info(`[Worker ${workerId}] [${completed + 1}/${total}] Processing ${bill.bill_id}`);

      try {
        const result = await processor(bill);
        results[currentIndex] = result;
        completed++;

        if (result.success) {
          const successCount = Object.values(result.summaries).filter(s => s.success).length;
          Logger.success(`[Worker ${workerId}] Completed ${bill.bill_id}`, {
            summariesGenerated: successCount,
            progress: `${completed}/${total}`
          });
        } else {
          Logger.error(`[Worker ${workerId}] Failed ${bill.bill_id}`, { errors: result.errors });
        }
      } catch (error) {
        results[currentIndex] = {
          billId: bill.bill_id,
          success: false,
          errors: [{ type: 'unexpected', message: error.message }]
        };
        completed++;
        Logger.error(`[Worker ${workerId}] Unexpected error for ${bill.bill_id}`, { error: error.message });
      }
    }
  }

  // Start workers
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, bills.length); i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);
  return results;
}

// Main job execution
async function runJob() {
  const startTime = Date.now();
  const stats = {
    billsQueried: 0,
    billsProcessed: 0,
    billsSucceeded: 0,
    billsFailed: 0,
    summariesGenerated: 0,
    summariesFailed: 0,
    errors: []
  };

  Logger.info('='.repeat(60));
  Logger.info(`Starting bill summary generation job`, {
    limit: BATCH_LIMIT,
    concurrency: CONCURRENCY,
    dryRun: DRY_RUN,
    verbose: VERBOSE
  });
  Logger.info('='.repeat(60));

  try {
    // Query bills needing summaries
    Logger.info('Querying for bills needing summaries...');
    const bills = await getBillsNeedingSummaries(BATCH_LIMIT);
    stats.billsQueried = bills.length;

    Logger.info(`Found ${bills.length} bills needing summaries`);

    if (bills.length === 0) {
      Logger.info('No bills found needing summaries. Job complete.');
      return stats;
    }

    // Log the bills found
    bills.forEach((bill, idx) => {
      Logger.debug(`  ${idx + 1}. ${bill.bill_id}: ${bill.title?.slice(0, 50)}...`);
    });

    if (DRY_RUN) {
      Logger.info('DRY RUN - skipping summary generation');
      return stats;
    }

    // Load bill summary service (after env is loaded)
    const billSummaryService = require('../services/bill-summary-service');
    Logger.info(`Using model: ${billSummaryService.getConfig().model}`);
    Logger.info(`Processing with ${CONCURRENCY} concurrent workers...`);

    // Process bills with concurrency
    const results = await processWithConcurrency(bills, CONCURRENCY, async (bill) => {
      return await processBill(billSummaryService, bill);
    });

    // Aggregate results
    for (const result of results) {
      stats.billsProcessed++;

      if (result.success) {
        stats.billsSucceeded++;
        const successCount = Object.values(result.summaries || {}).filter(s => s.success).length;
        stats.summariesGenerated += successCount;
        stats.summariesFailed += (4 - successCount);
      } else {
        stats.billsFailed++;
        stats.summariesFailed += 4;
        stats.errors.push({ billId: result.billId, errors: result.errors });
      }
    }
  } catch (error) {
    Logger.error('Job failed with unexpected error', { error: error.message, stack: error.stack });
    stats.errors.push({ type: 'job_error', message: error.message });
  } finally {
    await pool.end();
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const billsPerMinute = stats.billsProcessed > 0 ? ((stats.billsProcessed / elapsed) * 60).toFixed(1) : 0;

  Logger.info('\n' + '='.repeat(60));
  Logger.info('Job completed', {
    elapsedSeconds: elapsed,
    billsPerMinute,
    billsQueried: stats.billsQueried,
    billsProcessed: stats.billsProcessed,
    billsSucceeded: stats.billsSucceeded,
    billsFailed: stats.billsFailed,
    summariesGenerated: stats.summariesGenerated,
    summariesFailed: stats.summariesFailed,
    totalErrors: stats.errors.length
  });
  Logger.info('='.repeat(60));

  // Exit with error code if any failures
  if (stats.billsFailed > 0 || stats.errors.length > 0) {
    process.exitCode = 1;
  }

  return stats;
}

// Run the job
runJob().catch(error => {
  Logger.error('Fatal error running job', { error: error.message, stack: error.stack });
  process.exit(1);
});
