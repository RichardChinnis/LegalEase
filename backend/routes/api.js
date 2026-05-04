
const express = require('express');
const axios = require('axios');
const { PDFParse } = require('pdf-parse');
const { logger } = require('../logger');
const { createMiddlewareChain, validateBioguideIdSchema, createValidationMiddleware, quotaTracker } = require('../middleware');
const { asyncHandler } = require('../utils/error-handler');
const { BadRequestError } = require('../utils/errors');
const { SearchService } = require('../services/search-service');
const { validateSearchQuery } = require('../middleware/search-validation');
const { SpotlightService } = require('../services/spotlight-service');
const { MemberService } = require('../services/member-service');
const { BillJourneyService } = require('../services/bill-journey-service');

// Private/internal IP ranges that must be blocked to prevent SSRF
const BLOCKED_IP_PATTERNS = [
  /^127\./,         // loopback
  /^10\./,          // RFC 1918
  /^192\.168\./,    // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^169\.254\./,    // link-local
  /^0\./,           // current network
  /^0\.0\.0\.0$/,
];

/**
 * Validates that a URL is a legitimate congress.gov URL.
 * Prevents SSRF by checking hostname, protocol, and blocking internal IPs.
 * @param {string} url - The URL to validate
 * @returns {string} The validated URL string
 * @throws {BadRequestError} If the URL is invalid or not from congress.gov
 */
function validateCongressGovUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new BadRequestError('Invalid URL format');
  }

  // Validate protocol (allow http and https since congress.gov may not have HTTPS everywhere)
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new BadRequestError('Only http and https protocols are allowed');
  }

  // Validate hostname strictly: must be exactly congress.gov or a subdomain of it
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'congress.gov' && !hostname.endsWith('.congress.gov')) {
    throw new BadRequestError('Only congress.gov URLs are allowed');
  }

  // Block private/internal IP ranges to prevent SSRF to internal services
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new BadRequestError('Only congress.gov URLs are allowed');
    }
  }

  // Block IPv6 loopback
  if (hostname === '[::1]' || hostname === '::1') {
    throw new BadRequestError('Only congress.gov URLs are allowed');
  }

  return parsedUrl.href;
}

function createAPIRoutes(congressAPIClient, db) {
  const router = express.Router();

  // Helper function to handle response with headers
  function sendProxyResponse(res, result) {
    // Add custom headers for frontend stats
    if (result.headers) {
      res.set('X-Rate-Limit-Remaining', result.headers['x-ratelimit-remaining']);
      res.set('X-Rate-Limit-Limit', result.headers['x-ratelimit-limit']);
      res.set('X-Rate-Limit-Reset', result.headers['x-ratelimit-reset']);
    }
    res.set('X-Data-Source', result.fromCache ? 'cache' : 'api');
    res.json(result.data);
  }

  // Dynamic route handler factory
  function createProxyHandler() {
    return asyncHandler(async (req, res) => {
      // Extract the endpoint path from the request URL
      const endpoint = req.path.replace('/api', '');
      
      // Call the proxy function
      const result = await congressAPIClient.get(endpoint, req.query);
      
      // Send response with consistent headers
      sendProxyResponse(res, result);
    });
  }


  /**
   * @swagger
   * /api/quota-status:
   *   get:
   *     summary: Get quota status
   *     description: Test endpoint for quota status.
   *     responses:
   *       200:
   *         description: Quota status
   */
  router.get('/quota-status', (req, res) => {
    res.json({
      message: 'Quota status endpoint is working',
      timestamp: new Date().toISOString(),
      test: true
    });
  });

  /**
   * @swagger
   * /api/cache-stats:
   *   get:
   *     summary: Get cache statistics
   *     description: Retrieves statistics about the API cache.
   *     responses:
   *       200:
   *         description: Cache statistics
   */
  router.get('/cache-stats', createMiddlewareChain('cacheAPI'), asyncHandler(async (req, res) => {
    const stats = congressAPIClient.cache.getStats();
    res.json(stats);
  }));

  /**
   * @swagger
   * /api/clear-cache:
   *   post:
   *     summary: Clear cache
   *     description: Clears the API cache.
   *     responses:
   *       200:
   *         description: Cache cleared
   */
  router.post('/clear-cache', createMiddlewareChain('cacheAPI'), asyncHandler(async (req, res) => {
    congressAPIClient.cache.flushAll();
    res.json({ message: 'Cache cleared successfully', timestamp: new Date().toISOString() });
  }));

  /**
   * @swagger
   * /api/xml-content:
   *   get:
   *     summary: Get XML content
   *     description: Proxies XML content from a congress.gov URL.
   *     parameters:
   *       - in: query
   *         name: url
   *         schema:
   *           type: string
   *         required: true
   *         description: The URL of the XML content to fetch.
   *     responses:
   *       200:
   *         description: XML content
   */
  router.get('/xml-content', createMiddlewareChain('standardAPI'), asyncHandler(async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
      throw new BadRequestError('URL parameter is required');
    }
    
    // Validate that the URL is a legitimate congress.gov URL
    const validatedUrl = validateCongressGovUrl(url);

    const response = await axios.get(validatedUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Congress-API-Proxy/1.0'
      }
    });

    // Set appropriate headers for XML content
    res.set('Content-Type', 'application/xml');
    res.set('X-Original-URL', validatedUrl);
    res.send(response.data);
  }));

  /**
   * @swagger
   * /api/pdf-content:
   *   get:
   *     summary: Get PDF content
   *     description: Proxies PDF content from a congress.gov URL.
   *     parameters:
   *       - in: query
   *         name: url
   *         schema:
   *           type: string
   *         required: true
   *         description: The URL of the PDF content to fetch.
   *     responses:
   *       200:
   *         description: PDF content
   *         content:
   *           application/pdf:
   *             schema:
   *               type: string
   *               format: binary
   */
  router.get('/pdf-content', createMiddlewareChain('standardAPI'), asyncHandler(async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
      throw new BadRequestError('URL parameter is required');
    }
    
    // Validate that the URL is a legitimate congress.gov URL
    const validatedUrl = validateCongressGovUrl(url);

    const response = await axios.get(validatedUrl, {
      responseType: 'stream', // Important for handling binary data like PDFs
      timeout: 15000, // Increased timeout for potentially larger files
      headers: {
        'User-Agent': 'Congress-API-Proxy/1.0'
      }
    });

    // Set appropriate headers for PDF content
    res.set('Content-Type', 'application/pdf');
    res.set('X-Original-URL', validatedUrl);

    // Pipe the response stream directly to the client
    response.data.pipe(res);
  }));

  /**
   * @swagger
   * /api/pdf-text:
   *   get:
   *     summary: Extract text from PDF
   *     description: Fetches a PDF from congress.gov and extracts the text content.
   *     parameters:
   *       - in: query
   *         name: url
   *         schema:
   *           type: string
   *         required: true
   *         description: The URL of the PDF to extract text from.
   *     responses:
   *       200:
   *         description: Extracted text content
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 text:
   *                   type: string
   *                 pages:
   *                   type: integer
   *                 info:
   *                   type: object
   */
  router.get('/pdf-text', createMiddlewareChain('standardAPI'), asyncHandler(async (req, res) => {
    const { url } = req.query;

    if (!url) {
      throw new BadRequestError('URL parameter is required');
    }

    // Validate that the URL is a legitimate congress.gov URL
    const validatedUrl = validateCongressGovUrl(url);

    logger.info('Extracting text from PDF', { url: validatedUrl });

    try {
      // Fetch the PDF as arraybuffer
      const response = await axios.get(validatedUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout for large PDFs
        headers: {
          'User-Agent': 'Congress-API-Proxy/1.0'
        }
      });

      // Convert to Uint8Array (required by pdf-parse v2)
      const pdfData = new Uint8Array(response.data);

      // Create parser and load the document
      const parser = new PDFParse(pdfData);
      await parser.load();

      // Extract text
      const textResult = await parser.getText();

      // Get document info
      const info = await parser.getInfo().catch(() => ({}));

      logger.info('PDF text extracted successfully', {
        url,
        pages: parser.doc?.numPages || textResult.total,
        textLength: textResult.text.length
      });

      res.json({
        text: textResult.text,
        pages: parser.doc?.numPages || textResult.total,
        info: {
          title: info?.Title || null,
          author: info?.Author || null,
          creator: info?.Creator || null
        }
      });
    } catch (error) {
      logger.error('Failed to extract text from PDF', { url, error: error.message });
      throw new BadRequestError(`Failed to extract text from PDF: ${error.message}`);
    }
  }));

  // Specific routes with schema validation
  router.get('/bill/:congress/:type/:number', (req, res, next) => {
    console.log('ROUTE: Specific bill route hit for:', req.path);
    next();
  }, createValidationMiddleware('/bill/:congress/:type/:number'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/actions', createValidationMiddleware('/bill/:congress/:type/:number/actions'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/committees', createValidationMiddleware('/bill/:congress/:type/:number/committees'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/cosponsors', createValidationMiddleware('/bill/:congress/:type/:number/cosponsors'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/summaries', createValidationMiddleware('/bill/:congress/:type/:number/summaries'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/subjects', createValidationMiddleware('/bill/:congress/:type/:number/subjects'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/titles', createValidationMiddleware('/bill/:congress/:type/:number/titles'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/text', createValidationMiddleware('/bill/:congress/:type/:number/text'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/amendments', createValidationMiddleware('/bill/:congress/:type/:number/amendments'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/bill/:congress/:type/:number/relatedbills', createValidationMiddleware('/bill/:congress/:type/:number/relatedbills'), createMiddlewareChain('standardAPI'), createProxyHandler());

  // Bill list by congress - matches Congress.gov API: GET /bill/{congress}
  router.get('/bill/:congress', createValidationMiddleware('/bill/:congress'), createMiddlewareChain('standardAPI'), createProxyHandler());

  // Database search endpoint for all congressional content
  router.get('/db/search',
    validateSearchQuery,
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      try {
        // Initialize search service with shared database connection
        const searchService = new SearchService({ database: db });

        // Get client ID for rate limiting (already handled by validateSearchQuery)
        const clientId = req.clientId || req.ip || 'unknown';

        // Execute search
        const results = await searchService.search(req.query, clientId);
        
        // Add performance headers
        res.set('X-Data-Source', 'database');
        res.set('X-Search-Results', results.results?.length || 0);
        res.set('X-Search-Query', req.query.q);
        
        // Return results in expected format
        res.json({ 
          success: true,
          data: results 
        });

      } catch (error) {
        logger.error('Search endpoint error:', {
          error: error.message,
          query: req.query,
          clientId: req.clientId
        });
        
        // Return user-friendly error
        if (error.message.includes('Rate limit')) {
          res.status(429).json({
            success: false,
            error: {
              message: 'Search rate limit exceeded. Please wait before searching again.',
              type: 'RateLimitError'
            }
          });
        } else if (error.message.includes('validation') || error.message.includes('Invalid')) {
          res.status(400).json({
            success: false,
            error: {
              message: error.message,
              type: 'ValidationError'
            }
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              message: 'Search failed. Please try again.',
              type: 'SearchError'
            }
          });
        }
      }
    })
  );

  // Database-first bill endpoints that query PostgreSQL directly (fixed json_agg)
  
  // Base bill list endpoint
  router.get('/db/bill', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for bill list
      
      try {
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) FROM bill');
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get bills with pagination
        const result = await db.query(`
          SELECT 
            bill_id,
            congress_id,
            bill_type,
            bill_number,
            origin_chamber,
            origin_chamber_code,
            title,
            latest_action_date,
            latest_action_text,
            api_update_date,
            api_update_date_including_text
          FROM bill 
          ORDER BY latest_action_date DESC NULLS LAST
          LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        const bills = result.rows.map(row => ({
          congress: row.congress_id,
          latestAction: {
            actionDate: row.latest_action_date ? row.latest_action_date.toISOString().split('T')[0] : null,
            text: row.latest_action_text
          },
          number: row.bill_number,
          originChamber: row.origin_chamber,
          originChamberCode: row.origin_chamber_code,
          title: row.title,
          type: row.bill_type?.toUpperCase(),
          updateDate: row.api_update_date ? row.api_update_date.toISOString().split('T')[0] : null,
          updateDateIncludingText: row.api_update_date_including_text ? row.api_update_date_including_text.toISOString().split('T')[0] : null,
          url: `https://api.congress.gov/v3/bill/${row.congress_id}/${row.bill_type}/${row.bill_number}?format=json`
        }));
        
        // Build pagination
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          bills,
          pagination,
          request: {
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Congress-specific bill list endpoint 
  router.get('/db/bill/:congress/', 
    createValidationMiddleware('/congress/:congress'), 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for bill list filtered by congress
      
      try {
        // Get total count for this congress
        const countResult = await db.query('SELECT COUNT(*) FROM bill WHERE congress_id = $1', [parseInt(congress)]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get bills with pagination filtered by congress
        const result = await db.query(`
          SELECT 
            bill_id,
            congress_id,
            bill_type,
            bill_number,
            origin_chamber,
            origin_chamber_code,
            title,
            latest_action_date,
            latest_action_text,
            api_update_date,
            api_update_date_including_text
          FROM bill 
          WHERE congress_id = $1
          ORDER BY latest_action_date DESC NULLS LAST
          LIMIT $2 OFFSET $3
        `, [parseInt(congress), limit, offset]);
        
        const bills = result.rows.map(row => ({
          congress: row.congress_id,
          latestAction: {
            actionDate: row.latest_action_date ? row.latest_action_date.toISOString().split('T')[0] : null,
            text: row.latest_action_text
          },
          number: row.bill_number,
          originChamber: row.origin_chamber,
          originChamberCode: row.origin_chamber_code,
          title: row.title,
          type: row.bill_type?.toUpperCase(),
          updateDate: row.api_update_date ? row.api_update_date.toISOString().split('T')[0] : null,
          updateDateIncludingText: row.api_update_date_including_text ? row.api_update_date_including_text.toISOString().split('T')[0] : null,
          url: `https://api.congress.gov/v3/bill/${row.congress_id}/${row.bill_type}/${row.bill_number}?format=json`
        }));
        
        // Build pagination
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          bills,
          pagination,
          request: {
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Base bill endpoint
  router.get('/db/bill/:congress/:type/:number', 
    createValidationMiddleware('/bill/:congress/:type/:number'), 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      
      // Query database for bill details
      
      try {
        const result = await db.query(`
          SELECT 
            bill_id,
            congress_id,
            bill_type,
            bill_number,
            origin_chamber,
            title,
            introduced_date,
            latest_action_date,
            latest_action_text,
            policy_area,
            constitutional_authority_statement_text,
            api_update_date,
            api_update_date_including_text,
            notes,
            origin_chamber_code,
            law_type,
            law_number
          FROM bill 
          WHERE congress_id = $1 AND bill_type = $2 AND bill_number = $3
        `, [parseInt(congress), type.toLowerCase(), number]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            error: {
              message: `Bill ${type.toUpperCase()} ${number} from ${congress}th Congress not found`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }
        
        const bill = result.rows[0];
        
        // Get actions count
        const actionsCount = await db.query('SELECT COUNT(*) FROM action WHERE bill_id = $1', [billId]);
        
        // Get summaries count
        const summariesCount = await db.query('SELECT COUNT(*) FROM bill_summary WHERE bill_id = $1', [billId]);
        
        // Get committees count
        const committeesCount = await db.query('SELECT COUNT(*) FROM bill_committee_activity WHERE bill_id = $1', [billId]);
        
        // Get text versions count
        const textVersionsCount = await db.query('SELECT COUNT(*) FROM bill_text_version WHERE bill_id = $1', [billId]);
        
        // Get amendments count
        const amendmentsCount = await db.query('SELECT COUNT(*) FROM bill_amendment WHERE bill_id = $1', [billId]);
        
        // Get related bills count
        const relatedBillsCount = await db.query('SELECT COUNT(*) FROM bill_related WHERE bill_id = $1', [billId]);

        // Get cosponsors count
        const cosponsorsCount = await db.query('SELECT COUNT(*) FROM bill_cosponsor WHERE bill_id = $1 AND sponsorship_withdrawn_date IS NULL', [billId]);

        // Get titles count
        const titlesCount = await db.query('SELECT COUNT(*) FROM bill_title WHERE bill_id = $1', [billId]);
        
        // Get laws data
        const laws = await db.query('SELECT law_type, law_number FROM bill_law WHERE bill_id = $1', [billId]);
        
        // Get CBO cost estimates
        const cboCostEstimates = await db.query(`
          SELECT pub_date, title, url, description 
          FROM bill_cbo_estimate 
          WHERE bill_id = $1 
          ORDER BY pub_date DESC
        `, [billId]);
        
        // Get committee reports
        const committeeReports = await db.query(`
          SELECT citation, url 
          FROM bill_committee_report 
          WHERE bill_id = $1
        `, [billId]);
        
        // Get notes
        const notes = await db.query(`
          SELECT note_text, links 
          FROM bill_note 
          WHERE bill_id = $1
        `, [billId]);
        
        // Extract sponsors from notes JSONB field
        const sponsors = bill.notes?.sponsors || [];
        
        res.json({
          bill: {
            actions: {
              count: parseInt(actionsCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/actions?format=json`
            },
            amendments: {
              count: parseInt(amendmentsCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/amendments?format=json`
            },
            ...(cboCostEstimates.rows.length > 0 && {
              cboCostEstimates: cboCostEstimates.rows.map(cbo => ({
                description: cbo.description,
                pubDate: new Date(cbo.pub_date).toISOString().replace('.000', ''),
                title: cbo.title,
                url: cbo.url
              }))
            }),
            ...(committeeReports.rows.length > 0 && {
              committeeReports: committeeReports.rows.map(report => ({
                citation: report.citation,
                url: report.url || `https://api.congress.gov/v3/committee-report/${congress}/HRPT/106?format=json`
              }))
            }),
            committees: {
              count: parseInt(committeesCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/committees?format=json`
            },
            congress: bill.congress_id,
            cosponsors: {
              count: parseInt(cosponsorsCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/cosponsors?format=json`
            },
            introducedDate: bill.introduced_date ? new Date(bill.introduced_date).toISOString().split('T')[0] : null,
            latestAction: {
              actionDate: bill.latest_action_date ? new Date(bill.latest_action_date).toISOString().split('T')[0] : null,
              text: bill.latest_action_text
            },
            ...(laws.rows.length > 0 && {
              laws: laws.rows.map(law => ({
                number: law.law_number,
                type: law.law_type
              }))
            }),
            legislationUrl: `https://www.congress.gov/bill/${congress}th-congress/${bill.origin_chamber === 'House' ? 'house' : 'senate'}-bill/${number}`,
            ...(notes.rows.length > 0 && {
              notes: notes.rows.map(note => ({
                text: note.note_text,
                ...(note.links && { links: note.links })
              }))
            }),
            number: bill.bill_number,
            originChamber: bill.origin_chamber,
            originChamberCode: bill.origin_chamber_code || (bill.origin_chamber === 'House' ? 'H' : 'S'),
            policyArea: {
              name: bill.policy_area
            },
            relatedBills: {
              count: parseInt(relatedBillsCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/relatedbills?format=json`
            },
            sponsors: sponsors.map(s => {
              // Parse name from format: "Rep. Arrington, Jodey C. [R-TX-19]"
              const nameMatch = s.name ? s.name.match(/Rep\. ([^,]+), ([^[]+)/) : null;
              const lastName = nameMatch ? nameMatch[1].trim() : '';
              const firstName = nameMatch ? nameMatch[2].split(' ')[0].trim() : '';
              
              return {
                bioguideId: s.bioguideId,
                district: s.district,
                firstName: firstName,
                fullName: s.name,
                isByRequest: "N",
                lastName: lastName,
                middleName: nameMatch && nameMatch[2].includes(' ') ? nameMatch[2].split(' ').slice(1).join(' ').trim() : '',
                party: s.party,
                state: s.state,
                url: `https://api.congress.gov/v3/member/${s.bioguideId}?format=json`
              };
            }),
            subjects: {
              count: 0,  // Subject data not available in database
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/subjects?format=json`
            },
            summaries: {
              count: parseInt(summariesCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?format=json`
            },
            textVersions: {
              count: parseInt(textVersionsCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/text?format=json`
            },
            title: bill.title,
            titles: {
              count: parseInt(titlesCount.rows[0].count),
              url: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/titles?format=json`
            },
            type: bill.bill_type?.toUpperCase(),
            updateDate: bill.api_update_date ? new Date(bill.api_update_date).toISOString().replace('.000', '') : null,
            updateDateIncludingText: bill.api_update_date_including_text ? new Date(bill.api_update_date_including_text).toISOString().replace('.000', '') : null
          },
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  router.get('/db/bill/:congress/:type/:number/committees', 
    createValidationMiddleware('/bill/:congress/:type/:number/committees'), 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for committee activities
      
      try {
        // Get total count of committees for this bill
        const countResult = await db.query(`
          SELECT COUNT(DISTINCT bca.committee_system_code) 
          FROM bill_committee_activity bca
          WHERE bca.bill_id = $1
        `, [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get paginated committees with activities
        const result = await db.query(`
          SELECT 
            bca.committee_system_code,
            bca.committee_name,
            c.chamber,
            c.committee_type_code,
            json_agg(
              json_build_object(
                'date', bca.activity_date,
                'name', bca.activity_name
              ) ORDER BY bca.activity_date DESC
            ) as activities
          FROM bill_committee_activity bca
          LEFT JOIN committee c ON bca.committee_system_code = c.system_code
          WHERE bca.bill_id = $1
          GROUP BY bca.committee_system_code, bca.committee_name, c.chamber, c.committee_type_code
          ORDER BY bca.committee_name
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const committees = result.rows.map(row => ({
          activities: row.activities || [],
          chamber: row.chamber || 'House',
          name: row.committee_name,
          systemCode: row.committee_system_code,
          type: row.committee_type_code || 'Standing',
          url: `https://api.congress.gov/v3/committee/${row.chamber?.toLowerCase() || 'house'}/${row.committee_system_code}?format=json`
        }));
        
        // Build pagination metadata
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/committees?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/committees?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          committees,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database subjects endpoint
  router.get('/db/bill/:congress/:type/:number/subjects',
    createValidationMiddleware('/bill/:congress/:type/:number/subjects'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      
      // Query database for bill subjects
      
      try {
        const result = await db.query(`
          SELECT 
            policy_area,
            notes->'subjects' as legislative_subjects,
            api_update_date
          FROM bill 
          WHERE bill_id = $1
        `, [billId]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            error: {
              message: `Bill ${type.toUpperCase()} ${number} from ${congress}th Congress not found`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }
        
        const bill = result.rows[0];
        const subjects = bill.legislative_subjects || [];
        
        // Transform subjects array to Congress API format
        const legislativeSubjects = subjects.map(subject => ({
          name: subject,
          updateDate: bill.api_update_date ? bill.api_update_date.toISOString() : null
        }));
        
        res.json({
          subjects: {
            legislativeSubjects,
            policyArea: {
              name: bill.policy_area,
              updateDate: bill.api_update_date ? bill.api_update_date.toISOString() : null
            }
          },
          pagination: {
            count: legislativeSubjects.length
          },
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database text versions endpoint
  router.get('/db/bill/:congress/:type/:number/text',
    createValidationMiddleware('/bill/:congress/:type/:number/text'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for bill text versions
      
      try {
        // Get total count of text versions
        const countResult = await db.query('SELECT COUNT(*) FROM bill_text_version WHERE bill_id = $1', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get paginated text versions
        const result = await db.query(`
          SELECT 
            version_type,
            version_date,
            formats
          FROM bill_text_version
          WHERE bill_id = $1
          ORDER BY version_date DESC NULLS FIRST
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const textVersions = result.rows.map(row => ({
          type: row.version_type,
          date: row.version_date ? row.version_date.toISOString() : null,
          formats: Array.isArray(row.formats) ? row.formats : (row.formats ? JSON.parse(row.formats) : [])
        }));
        
        // Build pagination metadata
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/text?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/text?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          textVersions,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database amendments endpoint
  router.get('/db/bill/:congress/:type/:number/amendments',
    createValidationMiddleware('/bill/:congress/:type/:number/amendments'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for bill amendments
      
      try {
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) FROM bill_amendment WHERE bill_id = $1', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get amendments with pagination
        const result = await db.query(`
          SELECT 
            amendment_id,
            amendment_number,
            congress,
            type,
            purpose,
            latest_action_date,
            latest_action_text,
            updated_at
          FROM bill_amendment
          WHERE bill_id = $1
          ORDER BY amendment_number DESC
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const amendments = result.rows.map(row => {
          const amendment = {
            congress: row.congress,
            number: row.amendment_number?.toString(),
            type: row.type?.toUpperCase(),
            updateDate: row.updated_at ? row.updated_at.toISOString() : null,
            url: `https://api.congress.gov/v3/amendment/${row.congress}/${row.type?.toLowerCase()}/${row.amendment_number}?format=json`
          };
          
          // Add purpose if it exists
          if (row.purpose) {
            amendment.purpose = row.purpose;
          }
          
          // Add latest action if it exists
          if (row.latest_action_date || row.latest_action_text) {
            amendment.latestAction = {
              actionDate: row.latest_action_date ? row.latest_action_date.toISOString().split('T')[0] : null,
              text: row.latest_action_text
            };
          }
          
          return amendment;
        });
        
        // Build pagination
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/amendments?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/amendments?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          amendments,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database related bills endpoint
  router.get('/db/bill/:congress/:type/:number/relatedbills',
    createValidationMiddleware('/bill/:congress/:type/:number/relatedbills'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      // Query database for related bills
      
      try {
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) FROM bill_related WHERE bill_id = $1', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get related bills with pagination
        const result = await db.query(`
          SELECT 
            related_bill_congress,
            related_bill_type,
            related_bill_number,
            related_bill_title,
            relationship_type,
            identified_by,
            latest_action_date,
            latest_action_text
          FROM bill_related
          WHERE bill_id = $1
          ORDER BY latest_action_date DESC NULLS LAST, related_bill_number DESC
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const relatedBills = result.rows.map(row => {
          const relatedBill = {
            congress: row.related_bill_congress,
            number: row.related_bill_number,
            title: row.related_bill_title,
            type: row.related_bill_type?.toUpperCase(),
            url: `https://api.congress.gov/v3/bill/${row.related_bill_congress}/${row.related_bill_type}/${row.related_bill_number}?format=json`
          };
          
          // Add latest action if it exists
          if (row.latest_action_date || row.latest_action_text) {
            relatedBill.latestAction = {
              actionDate: row.latest_action_date ? row.latest_action_date.toISOString().split('T')[0] : null,
              text: row.latest_action_text
            };
          }
          
          // Add relationship details
          if (row.relationship_type || row.identified_by) {
            relatedBill.relationshipDetails = [{
              type: row.relationship_type,
              identifiedBy: row.identified_by
            }];
          }
          
          return relatedBill;
        });
        
        // Build pagination
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/relatedbills?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/relatedbills?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          relatedBills,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database actions endpoint
  router.get('/db/bill/:congress/:type/:number/actions',
    createValidationMiddleware('/bill/:congress/:type/:number/actions'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 250;
      const offset = parseInt(req.query.offset) || 0;
      
      
      try {
        // Get total count of actions for this bill
        const countResult = await db.query('SELECT COUNT(*) FROM action WHERE bill_id = $1', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        if (totalCount === 0) {
          return res.status(404).json({
            error: {
              message: 'No actions found for this bill',
              type: 'NotFound',
              statusCode: 404
            }
          });
        }
        
        // Get paginated actions from the action table, enriched with committee meeting data
        // Use subquery to deduplicate (preferring rows with meeting data), then order by date
        const result = await db.query(`
          SELECT * FROM (
            SELECT DISTINCT ON (a.action_id)
              a.action_id,
              a.action_code,
              a.action_date,
              a.action_time,
              a.text,
              a.type,
              a.source_system_code,
              a.source_system_name,
              a.committees,
              a.recorded_votes,
              a.calendar_number,
              a.calendar_name,
              -- Enriched meeting data
              cm.event_id as meeting_event_id,
              cm.title as meeting_title,
              cm.meeting_type,
              cm.chamber as meeting_chamber,
              cmc.committee_name as meeting_committee,
              (SELECT json_agg(json_build_object('name', v.video_name, 'url', v.video_url))
               FROM committee_meeting_video v WHERE v.meeting_id = cm.meeting_id) as meeting_videos
            FROM action a
            LEFT JOIN committee_meeting_bill cmb ON cmb.bill_id = a.bill_id
            LEFT JOIN committee_meeting cm
              ON cm.meeting_id = cmb.meeting_id
              AND cm.meeting_date::date = a.action_date
            LEFT JOIN committee_meeting_committee cmc ON cm.meeting_id = cmc.meeting_id
            WHERE a.bill_id = $1
            ORDER BY a.action_id, cm.event_id NULLS LAST
          ) enriched
          ORDER BY action_date DESC, action_id DESC
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const actions = result.rows.map(row => ({
          actionCode: row.action_code,
          actionDate: row.action_date ? row.action_date.toISOString().split('T')[0] : null,
          actionTime: row.action_time,
          text: row.text,
          type: row.type || "IntroReferral",
          sourceSystem: {
            code: row.source_system_code || 1,
            name: row.source_system_name || "House committee actions"
          },
          committees: row.committees || [],
          recordedVotes: row.recorded_votes || [],
          ...(row.calendar_number && {
            calendarNumber: {
              calendar: row.calendar_name,
              number: row.calendar_number
            }
          }),
          // Enriched committee meeting data
          meeting: row.meeting_event_id ? {
            eventId: row.meeting_event_id,
            title: row.meeting_title,
            type: row.meeting_type,
            chamber: row.meeting_chamber,
            committee: row.meeting_committee,
            videos: row.meeting_videos || []
          } : null
        }));
        
        // Build proper pagination metadata
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/actions?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/actions?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          actions,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: "application/json",
            format: "json"
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database summaries endpoint
  router.get('/db/bill/:congress/:type/:number/summaries',
    createValidationMiddleware('/bill/:congress/:type/:number/summaries'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      
      try {
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) FROM bill_summary WHERE bill_id = $1', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get paginated summaries
        const result = await db.query(`
          SELECT 
            version_code,
            action_date,
            action_desc,
            text,
            update_date
          FROM bill_summary 
          WHERE bill_id = $1
          ORDER BY action_date DESC NULLS LAST, update_date DESC NULLS LAST
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const summaries = result.rows.map(row => ({
          versionCode: row.version_code,
          actionDate: row.action_date ? row.action_date.toISOString().split('T')[0] : null,
          actionDesc: row.action_desc,
          updateDate: row.update_date ? row.update_date.toISOString() + 'Z' : null,
          text: row.text
        }));
        
        // Build pagination metadata
        const pagination = {
          count: totalCount
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          summaries,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: "application/json",
            format: "json"
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // Database cosponsors endpoint
  router.get('/db/bill/:congress/:type/:number/cosponsors',
    createValidationMiddleware('/bill/:congress/:type/:number/cosponsors'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      const limit = parseInt(req.query.limit) || 250;
      const offset = parseInt(req.query.offset) || 0;
      
      
      try {
        // Get total count
        const countResult = await db.query('SELECT COUNT(*) FROM bill_cosponsor WHERE bill_id = $1 AND sponsorship_withdrawn_date IS NULL', [billId]);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // Get count including withdrawn cosponsors
        const countWithdrawnResult = await db.query('SELECT COUNT(*) FROM bill_cosponsor WHERE bill_id = $1', [billId]);
        const totalCountIncludingWithdrawn = parseInt(countWithdrawnResult.rows[0].count);
        
        const result = await db.query(`
          SELECT 
            bioguide_id,
            first_name,
            last_name,
            full_name,
            party,
            state,
            district,
            sponsorship_date,
            is_original_cosponsor,
            sponsorship_withdrawn_date
          FROM bill_cosponsor 
          WHERE bill_id = $1 AND sponsorship_withdrawn_date IS NULL
          ORDER BY sponsorship_date DESC NULLS LAST, last_name, first_name
          LIMIT $2 OFFSET $3
        `, [billId, limit, offset]);
        
        const cosponsors = result.rows.map(row => {
          const cosponsor = {
            bioguideId: row.bioguide_id,
            cosponsorshipDate: row.sponsorship_date ? row.sponsorship_date.toISOString().split('T')[0] : null,
            isOriginalCosponsor: row.is_original_cosponsor || false,
            firstName: row.first_name,
            lastName: row.last_name,
            fullName: row.full_name || `${row.first_name} ${row.last_name}`,
            party: row.party,
            state: row.state,
            url: `https://api.congress.gov/v3/member/${row.bioguide_id}?format=json`
          };
          
          // Add district if it exists
          if (row.district) {
            cosponsor.district = row.district;
          }
          
          return cosponsor;
        });
        
        // Build pagination
        const pagination = {
          count: totalCount,
          countIncludingWithdrawnCosponsors: totalCountIncludingWithdrawn
        };
        
        if (offset + limit < totalCount) {
          pagination.next = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/cosponsors?offset=${offset + limit}&limit=${limit}&format=json`;
        }
        
        if (offset > 0) {
          pagination.prev = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/cosponsors?offset=${Math.max(0, offset - limit)}&limit=${limit}&format=json`;
        }
        
        res.json({
          cosponsors,
          pagination,
          request: {
            billNumber: number,
            billType: type,
            billUrl: `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json`,
            congress: congress,
            contentType: "application/json",
            format: "json"
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  router.get('/congress/:congress', createValidationMiddleware('/congress/:congress'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/member/:bioguideId', createValidationMiddleware('/member/:bioguideId'), createMiddlewareChain('memberAPI'), createProxyHandler());
  router.get('/committee/:chamber', createValidationMiddleware('/committee/:chamber'), createMiddlewareChain('standardAPI'), createProxyHandler());

  // Committee Report endpoints
  router.get('/committee-report', createValidationMiddleware('/committee-report'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/committee-report/:congress', createValidationMiddleware('/committee-report/:congress'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/committee-report/:congress/:reportType', createValidationMiddleware('/committee-report/:congress/:reportType'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/committee-report/:congress/:reportType/:reportNumber', createValidationMiddleware('/committee-report/:congress/:reportType/:reportNumber'), createMiddlewareChain('standardAPI'), createProxyHandler());
  router.get('/committee-report/:congress/:reportType/:reportNumber/text', createValidationMiddleware('/committee-report/:congress/:reportType/:reportNumber/text'), createMiddlewareChain('standardAPI'), createProxyHandler());

  // ========================================================================
  // DATABASE LAW ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/law/{congress}:
   *   get:
   *     summary: Get laws for a congress from database
   *     parameters:
   *       - in: path
   *         name: congress
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [pub, priv]
   *         description: Filter by law type (public or private)
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   */
  router.get('/db/law/:congress',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress } = req.params;
      const { type, limit = 20, offset = 0 } = req.query;

      try {
        let whereClause = 'WHERE b.congress_id = $1 AND bl.law_id IS NOT NULL';
        const params = [congress];

        if (type === 'pub') {
          whereClause += " AND bl.law_type = 'Public Law'";
        } else if (type === 'priv') {
          whereClause += " AND bl.law_type = 'Private Law'";
        }

        const query = `
          SELECT
            b.bill_id, b.congress_id, b.bill_type, b.bill_number, b.title,
            b.origin_chamber, b.origin_chamber_code,
            b.introduced_date, b.latest_action_date, b.latest_action_text,
            bl.law_type, bl.law_number
          FROM bill b
          JOIN bill_law bl ON b.bill_id = bl.bill_id
          ${whereClause}
          ORDER BY bl.law_number DESC
          LIMIT $2 OFFSET $3
        `;

        params.push(parseInt(limit), parseInt(offset));
        const result = await db.query(query, params);

        // Get total count
        const countQuery = `
          SELECT COUNT(*)
          FROM bill b
          JOIN bill_law bl ON b.bill_id = bl.bill_id
          ${whereClause}
        `;
        const countResult = await db.query(countQuery, [congress]);

        res.json({
          bills: result.rows.map(row => ({
            congress: row.congress_id,
            latestAction: {
              actionDate: row.latest_action_date ? new Date(row.latest_action_date).toISOString().split('T')[0] : null,
              text: row.latest_action_text
            },
            laws: [{
              number: row.law_number,
              type: row.law_type
            }],
            number: row.bill_number,
            originChamber: row.origin_chamber,
            originChamberCode: row.origin_chamber_code || (row.origin_chamber === 'House' ? 'H' : 'S'),
            title: row.title,
            type: row.bill_type?.toUpperCase(),
            updateDate: row.latest_action_date ? new Date(row.latest_action_date).toISOString().split('T')[0] : null,
            url: `https://api.congress.gov/v3/bill/${row.congress_id}/${row.bill_type}/${row.bill_number}?format=json`
          })),
          pagination: {
            count: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
          },
          request: {
            congress: congress.toString(),
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  /**
   * @swagger
   * /api/db/law/{congress}/{type}:
   *   get:
   *     summary: Get laws of a specific type for a congress from database
   *     parameters:
   *       - in: path
   *         name: congress
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: type
   *         required: true
   *         schema:
   *           type: string
   *           enum: [pub, priv]
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   */
  router.get('/db/law/:congress/:type',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      const lawType = type === 'pub' ? 'Public Law' : type === 'priv' ? 'Private Law' : null;

      if (!lawType) {
        return res.status(400).json({
          error: 'Invalid law type. Use "pub" for public laws or "priv" for private laws.'
        });
      }

      try {
        const query = `
          SELECT
            b.bill_id, b.congress_id, b.bill_type, b.bill_number, b.title,
            b.origin_chamber, b.origin_chamber_code,
            b.introduced_date, b.latest_action_date, b.latest_action_text,
            bl.law_type, bl.law_number
          FROM bill b
          JOIN bill_law bl ON b.bill_id = bl.bill_id
          WHERE b.congress_id = $1 AND bl.law_type = $2
          ORDER BY bl.law_number DESC
          LIMIT $3 OFFSET $4
        `;

        const result = await db.query(query, [congress, lawType, parseInt(limit), parseInt(offset)]);

        // Get total count
        const countQuery = `
          SELECT COUNT(*)
          FROM bill b
          JOIN bill_law bl ON b.bill_id = bl.bill_id
          WHERE b.congress_id = $1 AND bl.law_type = $2
        `;
        const countResult = await db.query(countQuery, [congress, lawType]);

        res.json({
          bills: result.rows.map(row => ({
            congress: row.congress_id,
            latestAction: {
              actionDate: row.latest_action_date ? new Date(row.latest_action_date).toISOString().split('T')[0] : null,
              text: row.latest_action_text
            },
            laws: [{
              number: row.law_number,
              type: row.law_type
            }],
            number: row.bill_number,
            originChamber: row.origin_chamber,
            originChamberCode: row.origin_chamber_code || (row.origin_chamber === 'House' ? 'H' : 'S'),
            title: row.title,
            type: row.bill_type?.toUpperCase(),
            updateDate: row.latest_action_date ? new Date(row.latest_action_date).toISOString().split('T')[0] : null,
            url: `https://api.congress.gov/v3/bill/${row.congress_id}/${row.bill_type}/${row.bill_number}?format=json`
          })),
          pagination: {
            count: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
          },
          request: {
            congress: congress.toString(),
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  /**
   * @swagger
   * /api/db/law/{congress}/{type}/{number}:
   *   get:
   *     summary: Get specific law by number from database
   *     parameters:
   *       - in: path
   *         name: congress
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: type
   *         required: true
   *         schema:
   *           type: string
   *           enum: [pub, priv]
   *       - in: path
   *         name: number
   *         required: true
   *         schema:
   *           type: integer
   */
  router.get('/db/law/:congress/:type/:number',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;

      const lawType = type === 'pub' ? 'Public Law' : type === 'priv' ? 'Private Law' : null;

      if (!lawType) {
        return res.status(400).json({
          error: 'Invalid law type. Use "pub" for public laws or "priv" for private laws.'
        });
      }

      const lawNumber = `${congress}-${number}`;

      try {
        const query = `
          SELECT
            b.*, bl.law_type, bl.law_number
          FROM bill b
          JOIN bill_law bl ON b.bill_id = bl.bill_id
          WHERE b.congress_id = $1
            AND bl.law_type = $2
            AND bl.law_number = $3
        `;

        const result = await db.query(query, [congress, lawType, lawNumber]);

        if (result.rows.length === 0) {
          return res.status(404).json({
            error: `Law ${lawNumber} (${lawType}) not found`
          });
        }

        const bill = result.rows[0];
        const billId = bill.bill_id;

        // Get all related counts and data in parallel
        const [
          actionsResult,
          cosponsorsResult,
          amendmentsResult,
          sponsorsResult,
          relatedBillsResult,
          summariesResult,
          textVersionsResult,
          titlesResult,
          subjectsResult,
          cboEstimatesResult,
          committeeReportsResult,
          notesResult
        ] = await Promise.all([
          db.query('SELECT COUNT(*) FROM action WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_cosponsor WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_amendment WHERE bill_id = $1', [billId]),
          db.query(`
            SELECT bs.member_bioguide_id, bs.is_by_request,
                   m.first_name, m.last_name, m.direct_order_name,
                   mt.party_code, mt.state_code
            FROM bill_sponsor bs
            JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            LEFT JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
              AND mt.congress = $2
            WHERE bs.bill_id = $1
          `, [billId, congress]),
          db.query('SELECT COUNT(*) FROM bill_related WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_summary WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_text_version WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_title WHERE bill_id = $1', [billId]),
          db.query('SELECT COUNT(*) FROM bill_subject WHERE bill_id = $1', [billId]),
          db.query('SELECT * FROM bill_cbo_estimate WHERE bill_id = $1 ORDER BY pub_date DESC', [billId]),
          db.query('SELECT * FROM bill_committee_report WHERE bill_id = $1', [billId]),
          db.query('SELECT * FROM bill_note WHERE bill_id = $1', [billId])
        ]);

        const actionsCount = parseInt(actionsResult.rows[0].count);
        const cosponsorsCount = parseInt(cosponsorsResult.rows[0].count);
        const amendmentsCount = parseInt(amendmentsResult.rows[0].count);
        const relatedBillsCount = parseInt(relatedBillsResult.rows[0].count);
        const summariesCount = parseInt(summariesResult.rows[0].count);
        const textVersionsCount = parseInt(textVersionsResult.rows[0].count);
        const titlesCount = parseInt(titlesResult.rows[0].count);
        const subjectsCount = parseInt(subjectsResult.rows[0].count);

        // Format sponsors array
        const sponsors = sponsorsResult.rows.map(s => {
          const chamber = bill.origin_chamber === 'Senate' ? 'Sen.' : 'Rep.';
          const fullName = `${chamber} ${s.direct_order_name || `${s.first_name} ${s.last_name}`} [${s.party_code || 'U'}-${s.state_code || 'XX'}]`;
          return {
            bioguideId: s.member_bioguide_id,
            firstName: s.first_name,
            fullName: fullName,
            isByRequest: s.is_by_request ? 'Y' : 'N',
            lastName: s.last_name,
            party: s.party_code,
            state: s.state_code,
            url: `https://api.congress.gov/v3/member/${s.member_bioguide_id}?format=json`
          };
        });

        // Format CBO cost estimates
        const cboCostEstimates = cboEstimatesResult.rows.map(e => ({
          description: e.description,
          pubDate: e.pub_date ? new Date(e.pub_date).toISOString() : null,
          title: e.title,
          url: e.url
        }));

        // Format committee reports
        const committeeReports = committeeReportsResult.rows.map(r => ({
          citation: r.citation,
          url: r.url
        }));

        // Format notes
        const notes = notesResult.rows.map(n => ({
          text: n.note_text,
          links: n.links
        }));

        const billTypeUpper = bill.bill_type?.toUpperCase();
        const baseUrl = `https://api.congress.gov/v3/bill/${bill.congress_id}/${bill.bill_type}/${bill.bill_number}`;

        // Return bill data with law info (same format as Congress API)
        res.json({
          bill: {
            actions: {
              count: actionsCount,
              url: `${baseUrl}/actions?format=json`
            },
            amendments: {
              count: amendmentsCount,
              url: `${baseUrl}/amendments?format=json`
            },
            cboCostEstimates: cboCostEstimates.length > 0 ? cboCostEstimates : undefined,
            committeeReports: committeeReports.length > 0 ? committeeReports : undefined,
            congress: bill.congress_id,
            cosponsors: {
              count: cosponsorsCount,
              countIncludingWithdrawnCosponsors: cosponsorsCount,
              url: `${baseUrl}/cosponsors?format=json`
            },
            introducedDate: bill.introduced_date ? new Date(bill.introduced_date).toISOString().split('T')[0] : null,
            latestAction: {
              actionDate: bill.latest_action_date ? new Date(bill.latest_action_date).toISOString().split('T')[0] : null,
              text: bill.latest_action_text
            },
            laws: [{
              number: bill.law_number,
              type: bill.law_type
            }],
            notes: notes.length > 0 ? notes : undefined,
            number: bill.bill_number,
            originChamber: bill.origin_chamber,
            originChamberCode: bill.origin_chamber_code || (bill.origin_chamber === 'House' ? 'H' : 'S'),
            policyArea: bill.policy_area ? { name: bill.policy_area } : null,
            relatedBills: relatedBillsCount > 0 ? {
              count: relatedBillsCount,
              url: `${baseUrl}/relatedbills?format=json`
            } : undefined,
            sponsors: sponsors,
            subjects: {
              count: subjectsCount,
              url: `${baseUrl}/subjects?format=json`
            },
            summaries: {
              count: summariesCount,
              url: `${baseUrl}/summaries?format=json`
            },
            textVersions: {
              count: textVersionsCount,
              url: `${baseUrl}/text?format=json`
            },
            title: bill.title,
            titles: {
              count: titlesCount,
              url: `${baseUrl}/titles?format=json`
            },
            type: billTypeUpper,
            updateDate: bill.api_update_date ? new Date(bill.api_update_date).toISOString() : null,
            updateDateIncludingText: bill.api_update_date_including_text ? new Date(bill.api_update_date_including_text).toISOString() : null
          },
          request: {
            congress: congress.toString(),
            contentType: 'application/json',
            format: 'json'
          }
        });
      } catch (error) {
        logger.error('Database query error:', error);
        throw error;
      }    })
  );

  // ========================================================================
  // DATABASE HEARING ENDPOINTS
  // ========================================================================

  const { HearingService } = require('../services/hearing-service');

  // Base hearing list endpoint - GET /api/db/hearing
  router.get('/db/hearing', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || req.query.q;
      
      const hearingService = new HearingService();
      
      try {
        let result;
        if (search) {
          result = await hearingService.searchHearings(search, { limit, offset });
        } else {
          result = await hearingService.getHearings({ limit, offset });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: 'Internal server error while fetching hearings',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await hearingService.close();
      }
    })
  );

  // Congress-specific hearing list endpoint - GET /api/db/hearing/{congress}
  router.get('/db/hearing/:congress', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || req.query.q;
      
      // Validate congress parameter
      const congressNum = parseInt(congress);
      if (isNaN(congressNum) || congressNum < 1 || congressNum > 200) {
        return res.status(400).json({
          error: {
            message: 'Invalid congress number. Must be between 1 and 200.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const hearingService = new HearingService();
      
      try {
        let result;
        if (search) {
          result = await hearingService.searchHearings(search, { 
            limit, offset, congress: congressNum 
          });
        } else {
          result = await hearingService.getHearings({ 
            limit, offset, congress: congressNum 
          });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching hearings for Congress ${congress}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await hearingService.close();
      }
    })
  );

  // Congress and chamber-specific hearing list endpoint - GET /api/db/hearing/{congress}/{chamber}
  router.get('/db/hearing/:congress/:chamber', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, chamber } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || req.query.q;
      
      // Validate congress parameter
      const congressNum = parseInt(congress);
      if (isNaN(congressNum) || congressNum < 1 || congressNum > 200) {
        return res.status(400).json({
          error: {
            message: 'Invalid congress number. Must be between 1 and 200.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Validate chamber parameter
      const validChambers = ['house', 'senate', 'nochamber'];
      const chamberLower = chamber.toLowerCase();
      if (!validChambers.includes(chamberLower)) {
        return res.status(400).json({
          error: {
            message: 'Invalid chamber. Must be "house", "senate", or "nochamber".',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Convert chamber to proper case for database
      let chamberProper;
      if (chamberLower === 'nochamber') {
        chamberProper = 'NoChamber';
      } else {
        chamberProper = chamberLower.charAt(0).toUpperCase() + chamberLower.slice(1);
      }
      
      const hearingService = new HearingService();
      
      try {
        let result;
        if (search) {
          result = await hearingService.searchHearings(search, { 
            limit, offset, congress: congressNum, chamber: chamberProper 
          });
        } else {
          result = await hearingService.getHearings({ 
            limit, offset, congress: congressNum, chamber: chamberProper 
          });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching hearings for Congress ${congress}, ${chamber}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await hearingService.close();
      }
    })
  );

  // Specific hearing details endpoint - GET /api/db/hearing/{congress}/{chamber}/{jacketNumber}
  router.get('/db/hearing/:congress/:chamber/:jacketNumber', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, chamber, jacketNumber } = req.params;
      
      // Validate congress parameter
      const congressNum = parseInt(congress);
      if (isNaN(congressNum) || congressNum < 1 || congressNum > 200) {
        return res.status(400).json({
          error: {
            message: 'Invalid congress number. Must be between 1 and 200.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Validate chamber parameter
      const validChambers = ['house', 'senate', 'nochamber'];
      const chamberLower = chamber.toLowerCase();
      if (!validChambers.includes(chamberLower)) {
        return res.status(400).json({
          error: {
            message: 'Invalid chamber. Must be "house", "senate", or "nochamber".',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Validate jacket number
      if (!jacketNumber || jacketNumber.trim() === '') {
        return res.status(400).json({
          error: {
            message: 'Invalid jacket number. Cannot be empty.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Convert chamber to proper case for database
      let chamberProper;
      if (chamberLower === 'nochamber') {
        chamberProper = 'NoChamber';
      } else {
        chamberProper = chamberLower.charAt(0).toUpperCase() + chamberLower.slice(1);
      }
      
      const hearingService = new HearingService();
      
      try {
        const result = await hearingService.getHearingDetails(
          congressNum, 
          chamberProper, 
          jacketNumber.trim()
        );
        
        if (!result) {
          return res.status(404).json({
            error: {
              message: `Hearing ${jacketNumber} from ${congress}th Congress, ${chamber} not found`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching hearing ${jacketNumber}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await hearingService.close();
      }
    })
  );

  // ========================================================================
  // DATABASE COMMITTEE REPORT ENDPOINTS  
  // ========================================================================

  const { CommitteeReportService } = require('../services/committee-report-service');

  // Base committee report list endpoint - GET /api/db/committee-report
  router.get('/db/committee-report', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || req.query.q;
      
      const service = new CommitteeReportService();
      
      try {
        const result = await service.getCommitteeReports({
          limit,
          offset,
          search,
          includeBills: true
        });
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: 'Internal server error while fetching committee reports',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await service.close();
      }
    })
  );

  // Congress-specific committee report list endpoint - GET /api/db/committee-report/{congress}
  router.get('/db/committee-report/:congress', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || req.query.q;
      
      // Validate congress parameter
      const congressNum = parseInt(congress);
      if (isNaN(congressNum) || congressNum < 93 || congressNum > 125) {
        return res.status(400).json({
          error: {
            message: 'Invalid congress number. Must be between 93 and 125.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const service = new CommitteeReportService();
      
      try {
        const result = await service.getCommitteeReportsByCongress(congressNum, {
          limit,
          offset,
          search,
          includeBills: true
        });
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching committee reports for Congress ${congress}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await service.close();
      }
    })
  );

  // Specific committee report details endpoint - GET /api/db/committee-report/{congress}/{reportType}/{reportNumber}
  router.get('/db/committee-report/:congress/:reportType/:reportNumber', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, reportType, reportNumber } = req.params;
      
      // Validate congress parameter
      const congressNum = parseInt(congress);
      if (isNaN(congressNum) || congressNum < 93 || congressNum > 125) {
        return res.status(400).json({
          error: {
            message: 'Invalid congress number. Must be between 93 and 125.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Validate report number
      const reportNum = parseInt(reportNumber);
      if (isNaN(reportNum) || reportNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid report number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      // Validate report type (basic validation for common types)
      const validReportTypes = ['HRPT', 'SRPT', 'CRPT'];
      if (!validReportTypes.includes(reportType.toUpperCase())) {
        return res.status(400).json({
          error: {
            message: 'Invalid report type. Must be HRPT, SRPT, or CRPT.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const service = new CommitteeReportService();
      
      try {
        const result = await service.getCommitteeReportByIdentifier(
          congressNum, 
          reportType.toUpperCase(), 
          reportNum,
          { includeFullDetails: true }
        );
        
        if (!result || !result.reports || result.reports.length === 0) {
          return res.status(404).json({
            error: {
              message: `Committee report ${reportType.toUpperCase()} ${reportNumber} from ${congress}th Congress not found`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }
        
        // Transform response to match legacy structure
        const legacyResponse = {
          ...result,
          committeeReports: result.reports.map(report => ({
            ...report,
            // Fix date format to match legacy (remove .000 milliseconds)
            issueDate: report.issueDate ? report.issueDate.replace('.000Z', 'Z') : report.issueDate,
            updateDate: report.updateDate ? report.updateDate.replace('.000Z', 'Z') : report.updateDate,
            // Fix text URL to use lowercase report type to match legacy
            text: report.text && report.text.url ? {
              ...report.text,
              url: report.text.url.replace(/\/([A-Z]{4})\//, (match, reportType) => `/${reportType.toLowerCase()}/`)
            } : report.text
          })),
          // Fix request object to match legacy format
          request: {
            congress: congress.toString(),
            contentType: "application/json",
            format: "json", 
            reportNumber: reportNumber.toString(),
            reportType: reportType.toLowerCase()
          }
        };
        delete legacyResponse.reports;
        res.json(legacyResponse);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching committee report ${reportType.toUpperCase()} ${reportNumber}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await service.close();
      }
    })
  );

  // Committee report text versions endpoint - GET /api/db/committee-report/{congress}/{reportType}/{reportNumber}/text
  router.get('/db/committee-report/:congress/:reportType/:reportNumber/text', 
    createMiddlewareChain('standardAPI'), 
    asyncHandler(async (req, res) => {
      const { congress, reportType, reportNumber } = req.params;
      
      // Validate congress parameter
      if (!congress || !/^\d+$/.test(congress)) {
        return res.status(400).json({
          error: {
            message: 'Congress parameter must be a valid number',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }

      // Validate reportType parameter (lowercase expected)
      const validReportTypes = ['hrpt', 'srpt', 'erpt'];
      if (!reportType || !validReportTypes.includes(reportType.toLowerCase())) {
        return res.status(400).json({
          error: {
            message: `Report type must be one of: ${validReportTypes.join(', ')}`,
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }

      // Validate reportNumber parameter
      if (!reportNumber || !/^\d+$/.test(reportNumber)) {
        return res.status(400).json({
          error: {
            message: 'Report number must be a valid number',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }

      const service = new CommitteeReportService();
      
      try {
        const textVersions = await service.getCommitteeReportText(
          parseInt(congress), 
          reportType.toLowerCase(), 
          parseInt(reportNumber)
        );

        if (!textVersions) {
          return res.status(404).json({
            error: {
              message: `Committee report ${reportType.toUpperCase()} ${reportNumber} not found for Congress ${congress}`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }

        // Transform response to match legacy text endpoint structure
        const legacyTextResponse = {
          pagination: {
            count: textVersions.textVersions ? textVersions.textVersions.reduce((total, version) => total + (version.formats ? version.formats.length : 0), 0) : 0
          },
          request: {
            congress: congress.toString(),
            contentType: "application/json",
            format: "json",
            reportNumber: reportNumber.toString(), 
            reportType: reportType.toLowerCase()
          },
          text: textVersions.textVersions ? textVersions.textVersions.flatMap(version => 
            version.formats ? version.formats.map(format => ({
              formats: [{
                isErrata: "N",
                type: format.type,
                url: format.url
              }]
            })) : []
          ) : []
        };
        
        res.json(legacyTextResponse);
        
      } catch (error) {
        logger.error('Committee report text endpoint error', {
          congress,
          reportType,
          reportNumber,
          error: error.message,
          stack: error.stack
        });

        res.status(500).json({
          error: {
            message: `Internal server error while fetching committee report ${reportType.toUpperCase()} ${reportNumber} text`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await service.close();
      }
    })
  );

  // ========================================================================
  // DATABASE CONGRESSIONAL RECORD ENDPOINTS
  // ========================================================================

  const { CongressionalRecordService } = require('../services/congressional-record-service');

  // Base daily Congressional Record list endpoint - GET /api/db/daily-congressional-record
  router.get('/db/daily-congressional-record',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.getVolumes({ limit, offset });
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: 'Internal server error while fetching Congressional Record volumes',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Volume-specific Congressional Record endpoint - GET /api/db/daily-congressional-record/{volume}
  router.get('/db/daily-congressional-record/:volume',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { volume } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      
      const volumeNum = parseInt(volume);
      if (isNaN(volumeNum) || volumeNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid volume number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.getIssuesByVolume(volumeNum, { limit, offset });
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching Congressional Record volume ${volume}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Issue-specific Congressional Record endpoint - GET /api/db/daily-congressional-record/{volume}/{issue}
  router.get('/db/daily-congressional-record/:volume/:issue',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { volume, issue } = req.params;
      
      const volumeNum = parseInt(volume);
      const issueNum = parseInt(issue);
      
      if (isNaN(volumeNum) || volumeNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid volume number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      if (isNaN(issueNum) || issueNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid issue number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.getIssueDetails(volumeNum, issueNum);
        
        if (!result) {
          return res.status(404).json({
            error: {
              message: `Congressional Record Volume ${volume}, Issue ${issue} not found`,
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching Congressional Record Volume ${volume}, Issue ${issue}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Articles endpoint - GET /api/db/daily-congressional-record/{volume}/{issue}/articles
  router.get('/db/daily-congressional-record/:volume/:issue/articles',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { volume, issue } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      
      const volumeNum = parseInt(volume);
      const issueNum = parseInt(issue);
      
      if (isNaN(volumeNum) || volumeNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid volume number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      if (isNaN(issueNum) || issueNum < 1) {
        return res.status(400).json({
          error: {
            message: 'Invalid issue number. Must be a positive integer.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.getArticlesByIssue(volumeNum, issueNum, { limit, offset });
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching articles for Congressional Record Volume ${volume}, Issue ${issue}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Bill Congressional Record references endpoint - GET /api/db/bill/{congress}/{type}/{number}/congressional-record
  router.get('/db/bill/:congress/:type/:number/congressional-record',
    createValidationMiddleware('/bill/:congress/:type/:number'),
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { congress, type, number } = req.params;
      const billId = `${congress}-${type.toUpperCase()}-${number}`;
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.getBillCongressionalRecordReferences(billId);
        
        if (!result || result.references.length === 0) {
          return res.status(404).json({
            error: {
              message: `No Congressional Record references found for bill ${type.toUpperCase()} ${number} from ${congress}th Congress`,
              type: 'NotFoundError', 
              statusCode: 404
            }
          });
        }
        
        res.json(result);
      } catch (error) {
        logger.error('Database query error:', error);
        res.status(500).json({
          error: {
            message: `Internal server error while fetching Congressional Record references for bill ${type.toUpperCase()} ${number}`,
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Search Congressional Record content endpoint - GET /api/db/congressional-record/search
  router.get('/db/congressional-record/search',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { q: query, volume, congress, chamber, limit = 20, offset = 0 } = req.query;
      
      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          error: {
            message: 'Search query must be at least 2 characters long',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }
      
      const crService = new CongressionalRecordService();
      
      try {
        const result = await crService.searchCongressionalRecord(query, {
          volume: volume ? parseInt(volume) : null,
          congress: congress ? parseInt(congress) : null,
          chamber: chamber ? chamber.toUpperCase() : null,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
        res.json(result);
      } catch (error) {
        logger.error('Congressional Record search error:', error);
        res.status(500).json({
          error: {
            message: 'Internal server error while searching Congressional Record',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      } finally {
        await crService.close();
      }
    })
  );

  // Congressional Record article lookup by page reference OR article ID endpoint - GET /api/db/congressional-record/article/{pageRef|articleId}
  router.get('/db/congressional-record/article/:pageRef',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { pageRef } = req.params;
      const { billTitle, actionContext, context, congress } = req.query;

      // Debug logging
      console.log(`[CR-DEBUG] Request received:`, {
        pageRef,
        billTitle,
        actionContext,
        context,
        congress,
        fullUrl: req.originalUrl
      });

      // Check if this is a numeric article ID (for navigation between articles)
      const isNumericId = /^\d+$/.test(pageRef);

      // Validate format: must be page reference (S1234, H5678, etc.) OR numeric article ID
      if (!pageRef || (!isNumericId && !/^[SHEDshed]\d+$/i.test(pageRef))) {
        return res.status(400).json({
          error: {
            message: 'Invalid format. Expected page reference (S1234, H5678, E9012, D3456) or numeric article ID',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }

      // Create database connection

      try {
        let result;

        if (isNumericId) {
          // Fetch by article_id directly (for navigation between articles)
          console.log(`[CR-DEBUG] Fetching by article ID: ${pageRef}`);
          result = await db.query(`
            SELECT
              a.article_id,
              a.title,
              a.start_page,
              a.end_page,
              a.pdf_url,
              a.text_url,
              a.content_text,
              s.name as section_name,
              s.name as chamber,
              i.issue_date,
              i.congress,
              v.volume_number,
              i.issue_number
            FROM congressional_record_article a
            JOIN congressional_record_section s ON a.section_id = s.section_id
            JOIN congressional_record_issue i ON s.issue_id = i.issue_id
            JOIN congressional_record_volume v ON i.volume_id = v.volume_id
            WHERE a.article_id = $1
          `, [parseInt(pageRef, 10)]);
        } else {
          // Use page reference lookup
          console.log(`[CR-DEBUG] Attempting database query for page: ${pageRef}, congress: ${congress || 'not specified'}`);

          // Call the database function to find CR articles by page reference
          // Pass congress as 4th parameter to prioritize articles from the same congress
          const congressNum = congress ? parseInt(congress, 10) : null;
          result = await db.query(
            'SELECT * FROM find_cr_article_by_page_enhanced($1, $2, $3, $4)',
            [pageRef.toUpperCase(), billTitle || null, actionContext || null, congressNum]
          );
        }

        console.log(`[CR-DEBUG] Database query result:`, {
          rowCount: result.rows.length,
          firstRow: result.rows[0] || null
        });

        if (result.rows.length === 0) {
          // No article found - return appropriate error
          const fallbackUrl = `https://www.congress.gov/congressional-record/browse-by-date`;

          return res.json({
            success: true,
            found: false,
            ...(isNumericId ? { articleId: pageRef } : { pageReference: pageRef }),
            fallbackUrl: fallbackUrl,
            message: isNumericId
              ? `No Congressional Record article found with ID ${pageRef}.`
              : `No Congressional Record article found for page ${pageRef}. Use fallback URL to browse by date.`,
            searchCriteria: {
              ...(isNumericId ? { articleId: pageRef } : { pageReference: pageRef }),
              ...(billTitle && { billTitle }),
              ...(actionContext && { actionContext })
            }
          });
        }

        // Return the article with highest confidence (first result from enhanced function)
        const article = result.rows[0];

        // Build the article URL based on available data
        let articleUrl = article.pdf_url || article.text_url;
        if (!articleUrl && article.volume_number && article.issue_number) {
          // Construct a congress.gov URL if we have volume/issue data
          articleUrl = `https://www.congress.gov/congressional-record/volume-${article.volume_number}/issue-${article.issue_number}`;
        }

        // Check if we already have content_text cached in the database
        let contentText = article.content_text;
        let contentSource = 'database';

        // If no cached content and we have a text_url, fetch and cache it
        if ((!contentText || contentText.trim() === '') && article.text_url) {
          console.log(`[CR-DEBUG] No cached content, fetching from: ${article.text_url}`);

          try {
            const axios = require('axios');
            const response = await axios.get(article.text_url, {
              timeout: 15000,
              headers: {
                'User-Agent': 'CongressAPI/1.0 (Congressional Record Viewer)'
              }
            });

            if (response.data) {
              // Parse HTML to extract text content
              // The congress.gov HTML is wrapped in <pre> tags
              let htmlContent = response.data;

              // Extract content from <pre> tags
              const preMatch = htmlContent.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
              if (preMatch) {
                contentText = preMatch[1];
              } else {
                // If no <pre> tags, use the raw content
                contentText = htmlContent;
              }

              // Clean up HTML entities and tags
              contentText = contentText
                .replace(/<a[^>]*href=['"]([^'"]+)['"][^>]*>([^<]*)<\/a>/gi, '$2') // Remove links but keep text
                .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .trim();

              contentSource = 'fetched';

              // Calculate word count for storage
              const wordCount = contentText.split(/\s+/).filter(w => w.length > 0).length;

              console.log(`[CR-DEBUG] Fetched content: ${contentText.length} chars, ${wordCount} words`);

              // Cache the content in the database for future requests
              try {
                await db.query(
                  `UPDATE congressional_record_article
                   SET content_text = $1, word_count = $2, character_count = $3, updated_at = NOW()
                   WHERE article_id = $4`,
                  [contentText, wordCount, contentText.length, article.article_id]
                );
                console.log(`[CR-DEBUG] Cached content for article ${article.article_id}`);
              } catch (cacheErr) {
                console.log(`[CR-DEBUG] Failed to cache content: ${cacheErr.message}`);
              }
            }
          } catch (fetchError) {
            console.log(`[CR-DEBUG] Failed to fetch content from congress.gov: ${fetchError.message}`);
            // Continue without content - will return metadata only
          }
        }

        res.json({
          success: true,
          found: true,
          pageReference: pageRef,
          article: {
            id: article.article_id,
            title: article.title,
            content: contentText || null,
            contentSource: contentSource,
            startPage: article.start_page,
            endPage: article.end_page,
            url: articleUrl,
            pdfUrl: article.pdf_url,
            textUrl: article.text_url,
            volume: article.volume_number,
            issue: article.issue_number,
            issueDate: article.issue_date ? article.issue_date.toISOString().split('T')[0] : null,
            congress: article.congress,
            chamber: article.chamber
          },
          metadata: {
            confidence: 'high', // Enhanced function returns results in confidence order
            matchType: 'page_range',
            ...(billTitle && { billTitle }),
            ...(actionContext && { actionContext })
          }
        });

      } catch (error) {
        console.log(`[CR-DEBUG] ========== DATABASE ERROR ==========`);
        console.log(`[CR-DEBUG] Error message: ${error.message}`);
        console.log(`[CR-DEBUG] Error code: ${error.code || 'no code'}`);
        console.log(`[CR-DEBUG] Error name: ${error.name || 'no name'}`);
        console.log(`[CR-DEBUG] ========================================`);

        logger.error('Congressional Record article lookup error:', {
          error: error.message,
          pageRef,
          billTitle,
          actionContext
        });

        // Return fallback URL on database errors
        const fallbackUrl = `https://www.congress.gov/congressional-record/browse-by-date`;

        res.status(500).json({
          success: false,
          found: false,
          pageReference: pageRef,
          fallbackUrl: fallbackUrl,
          error: {
            message: 'Internal server error while looking up Congressional Record article',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      }    })
  );

  // Congressional Record adjacent articles endpoint - GET /api/db/congressional-record/article/{articleId}/adjacent
  router.get('/db/congressional-record/article/:articleId/adjacent',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { articleId } = req.params;

      // Validate article ID is a number
      const articleIdNum = parseInt(articleId, 10);
      if (isNaN(articleIdNum)) {
        return res.status(400).json({
          error: {
            message: 'Invalid article ID. Expected a numeric value.',
            type: 'ValidationError',
            statusCode: 400
          }
        });
      }

      // Create database connection

      try {
        // First, get the current article's section_id, start_page, and issue info
        const currentResult = await db.query(`
          SELECT
            a.article_id, a.section_id, a.start_page, a.end_page, a.title,
            s.issue_id, s.name as section_name,
            i.issue_date, i.congress
          FROM congressional_record_article a
          JOIN congressional_record_section s ON a.section_id = s.section_id
          JOIN congressional_record_issue i ON s.issue_id = i.issue_id
          WHERE a.article_id = $1
        `, [articleIdNum]);

        if (currentResult.rows.length === 0) {
          return res.status(404).json({
            error: {
              message: 'Article not found',
              type: 'NotFoundError',
              statusCode: 404
            }
          });
        }

        const current = currentResult.rows[0];

        // Extract numeric page number for cross-issue navigation
        // Page numbers like "S8211" -> 8211, allowing navigation across all issues
        const extractPageNum = (page) => {
          if (!page) return 0;
          const match = page.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };
        const currentPageNum = extractPageNum(current.start_page);
        const currentEndPageNum = extractPageNum(current.end_page) || currentPageNum;

        // Get previous article - navigate freely across ALL issues within same chamber
        // This allows users to browse the entire Congressional Record
        // Note: Within a page, articles are stored with descending IDs (first article has highest ID)
        // So for PREV: we want lower page OR (same page AND higher article_id)
        const prevResult = await db.query(`
          SELECT
            a.article_id, a.title, a.start_page, a.end_page, a.pdf_url, a.text_url,
            a.start_page_number, a.end_page_number,
            s.name as section_name,
            i.issue_date, i.congress,
            v.volume_number, i.issue_number
          FROM congressional_record_article a
          JOIN congressional_record_section s ON a.section_id = s.section_id
          JOIN congressional_record_issue i ON s.issue_id = i.issue_id
          JOIN congressional_record_volume v ON i.volume_id = v.volume_id
          WHERE a.chamber = $1
            AND i.congress = $2
            AND (
              (a.start_page_number, COALESCE(a.end_page_number, a.start_page_number)) < ($3, $4)
              OR (
                a.start_page_number = $3
                AND COALESCE(a.end_page_number, a.start_page_number) = $4
                AND a.article_id > $5
              )
            )
          ORDER BY a.start_page_number DESC, COALESCE(a.end_page_number, a.start_page_number) DESC, a.article_id ASC
          LIMIT 1
        `, [current.section_name, current.congress, currentPageNum, currentEndPageNum, current.article_id]);

        // Get next article - navigate freely across ALL issues within same chamber
        // Note: Within a page, articles are stored with descending IDs (first article has highest ID)
        // So for NEXT: we want higher page OR (same page AND lower article_id)
        const nextResult = await db.query(`
          SELECT
            a.article_id, a.title, a.start_page, a.end_page, a.pdf_url, a.text_url,
            a.start_page_number, a.end_page_number,
            s.name as section_name,
            i.issue_date, i.congress,
            v.volume_number, i.issue_number
          FROM congressional_record_article a
          JOIN congressional_record_section s ON a.section_id = s.section_id
          JOIN congressional_record_issue i ON s.issue_id = i.issue_id
          JOIN congressional_record_volume v ON i.volume_id = v.volume_id
          WHERE a.chamber = $1
            AND i.congress = $2
            AND (
              (a.start_page_number, COALESCE(a.end_page_number, a.start_page_number)) > ($3, $4)
              OR (
                a.start_page_number = $3
                AND COALESCE(a.end_page_number, a.start_page_number) = $4
                AND a.article_id < $5
              )
            )
          ORDER BY a.start_page_number ASC, COALESCE(a.end_page_number, a.start_page_number) ASC, a.article_id DESC
          LIMIT 1
        `, [current.section_name, current.congress, currentPageNum, currentEndPageNum, current.article_id]);

        const formatArticle = (row) => {
          if (!row) return null;
          return {
            id: row.article_id,
            title: row.title,
            startPage: row.start_page,
            endPage: row.end_page,
            pdfUrl: row.pdf_url,
            textUrl: row.text_url,
            chamber: row.section_name,
            issueDate: row.issue_date ? row.issue_date.toISOString().split('T')[0] : null,
            congress: row.congress,
            volume: row.volume_number,
            issue: row.issue_number
          };
        };

        res.json({
          success: true,
          currentArticleId: articleIdNum,
          previous: prevResult.rows.length > 0 ? formatArticle(prevResult.rows[0]) : null,
          next: nextResult.rows.length > 0 ? formatArticle(nextResult.rows[0]) : null
        });

      } catch (error) {
        logger.error('Congressional Record adjacent articles lookup error:', {
          error: error.message,
          articleId
        });

        res.status(500).json({
          success: false,
          error: {
            message: 'Internal server error while looking up adjacent articles',
            type: 'DatabaseError',
            statusCode: 500
          }
        });
      }    })
  );

  // ========================================================================
  // SPOTLIGHT BILLS & USER FOLLOWS ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/spotlight:
   *   get:
   *     summary: Get active spotlight bills
   *     description: Retrieves curated "In the News" bills with full details
   *     parameters:
   *       - in: query
   *         name: category
   *         schema:
   *           type: string
   *           enum: [breaking, trending, upcoming_vote, just_passed]
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   */
  router.get('/db/spotlight',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { category, limit } = req.query;

        const spotlights = await spotlightService.getActiveSpotlights({
          category: category || null,
          limit: parseInt(limit) || 10
        });

        // Prevent browser caching - spotlight data changes frequently
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        res.json({
          success: true,
          count: spotlights.length,
          spotlights
        });
      } catch (error) {
        logger.error('Error fetching spotlight bills', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch spotlight bills', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // UPCOMING COMMITTEE MEETINGS - Calendar/Schedule View
  // ========================================================================

  /**
   * @swagger
   * /api/db/upcoming-meetings:
   *   get:
   *     summary: Get upcoming committee meetings
   *     description: Returns scheduled committee meetings with linked bills
   *     parameters:
   *       - name: days
   *         in: query
   *         description: Number of days ahead to look (default 14)
   *         schema:
   *           type: integer
   *       - name: chamber
   *         in: query
   *         description: Filter by chamber (house/senate)
   *         schema:
   *           type: string
   *       - name: meetingType
   *         in: query
   *         description: Filter by type (Hearing/Markup/Meeting)
   *         schema:
   *           type: string
   *       - name: limit
   *         in: query
   *         description: Maximum results (default 50)
   *         schema:
   *           type: integer
   */
  router.get('/db/upcoming-meetings',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const {
          days = 14,
          chamber,
          meetingType,
          includeRecent = 'false',
          limit = 50
        } = req.query;

        const daysNum = parseInt(days) || 14;
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        const includeRecentBool = includeRecent === 'true';

        // Build the query for upcoming meetings with linked bills
        let query = `
          WITH meeting_bills AS (
            SELECT
              cmb.meeting_id,
              json_agg(json_build_object(
                'billId', cmb.bill_id,
                'billType', cmb.bill_type,
                'billNumber', cmb.bill_number,
                'congress', cmb.congress,
                'title', b.title,
                'shortTitle', b.title
              ) ORDER BY cmb.bill_type, cmb.bill_number::int) as bills
            FROM committee_meeting_bill cmb
            LEFT JOIN bill b ON cmb.bill_id = b.bill_id
            GROUP BY cmb.meeting_id
          ),
          meeting_committees AS (
            SELECT
              cmc.meeting_id,
              json_agg(json_build_object(
                'name', cmc.committee_name,
                'systemCode', cmc.committee_system_code
              )) as committees
            FROM committee_meeting_committee cmc
            GROUP BY cmc.meeting_id
          )
          SELECT
            cm.meeting_id,
            cm.event_id,
            cm.congress_id,
            cm.chamber,
            cm.title,
            cm.meeting_date,
            cm.meeting_type,
            cm.meeting_status,
            cm.location_building,
            cm.location_room,
            COALESCE(mb.bills, '[]'::json) as bills,
            COALESCE(mc.committees, '[]'::json) as committees,
            (SELECT COUNT(*) FROM committee_meeting_video v WHERE v.meeting_id = cm.meeting_id) as video_count
          FROM committee_meeting cm
          LEFT JOIN meeting_bills mb ON cm.meeting_id = mb.meeting_id
          LEFT JOIN meeting_committees mc ON cm.meeting_id = mc.meeting_id
          WHERE cm.meeting_status IN ('Scheduled', 'Rescheduled')
        `;

        const params = [];
        let paramIndex = 1;

        // Date filter - either future only or include recent past
        if (includeRecentBool) {
          // Include meetings from 2 days ago to capture recently occurred meetings
          query += ` AND cm.meeting_date >= NOW() - INTERVAL '2 days'`;
        } else {
          query += ` AND cm.meeting_date >= NOW()`;
        }

        query += ` AND cm.meeting_date <= NOW() + INTERVAL '${daysNum} days'`;

        // Chamber filter
        if (chamber) {
          query += ` AND LOWER(cm.chamber) = $${paramIndex}`;
          params.push(chamber.toLowerCase());
          paramIndex++;
        }

        // Meeting type filter
        if (meetingType) {
          query += ` AND LOWER(cm.meeting_type) = $${paramIndex}`;
          params.push(meetingType.toLowerCase());
          paramIndex++;
        }

        query += ` ORDER BY cm.meeting_date ASC LIMIT $${paramIndex}`;
        params.push(limitNum);

        const result = await db.query(query, params);

        // Group by date for easier frontend consumption
        const meetingsByDate = {};
        const meetings = result.rows.map(row => {
          const meeting = {
            meetingId: row.meeting_id,
            eventId: row.event_id,
            congress: row.congress_id,
            chamber: row.chamber,
            title: row.title,
            date: row.meeting_date,
            type: row.meeting_type,
            status: row.meeting_status,
            location: {
              building: row.location_building,
              room: row.location_room
            },
            bills: row.bills,
            committees: row.committees,
            hasVideo: row.video_count > 0
          };

          // Group by date
          const dateKey = new Date(row.meeting_date).toISOString().split('T')[0];
          if (!meetingsByDate[dateKey]) {
            meetingsByDate[dateKey] = [];
          }
          meetingsByDate[dateKey].push(meeting);

          return meeting;
        });

        // Prevent caching - schedule changes frequently
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        res.json({
          success: true,
          count: meetings.length,
          daysAhead: daysNum,
          meetings,
          byDate: meetingsByDate
        });
      } catch (error) {
        logger.error('Error fetching upcoming meetings', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch upcoming meetings', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/spotlight:
   *   post:
   *     summary: Create a spotlight bill
   *     description: Add a new curated spotlight bill (admin only)
   */
  router.post('/db/spotlight',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { bill_id, headline, news_context, priority, category, start_date, end_date } = req.body;

        if (!bill_id || !headline || !news_context) {
          return res.status(400).json({
            success: false,
            error: { message: 'bill_id, headline, and news_context are required', type: 'ValidationError' }
          });
        }

        const spotlight = await spotlightService.createSpotlight({
          bill_id,
          headline,
          news_context,
          priority: priority || 0,
          category: category || 'trending',
          start_date,
          end_date,
          created_by: req.user?.id || 'admin'
        });

        res.status(201).json({
          success: true,
          spotlight
        });
      } catch (error) {
        logger.error('Error creating spotlight', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to create spotlight', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/spotlight/{id}:
   *   put:
   *     summary: Update a spotlight bill
   */
  router.put('/db/spotlight/:id',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const spotlightId = parseInt(req.params.id);

        const spotlight = await spotlightService.updateSpotlight(spotlightId, req.body);

        if (!spotlight) {
          return res.status(404).json({
            success: false,
            error: { message: 'Spotlight not found', type: 'NotFoundError' }
          });
        }

        res.json({
          success: true,
          spotlight
        });
      } catch (error) {
        logger.error('Error updating spotlight', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to update spotlight', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/spotlight/{id}:
   *   delete:
   *     summary: Delete a spotlight bill
   */
  router.delete('/db/spotlight/:id',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const spotlightId = parseInt(req.params.id);

        const deleted = await spotlightService.deleteSpotlight(spotlightId);

        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: { message: 'Spotlight not found', type: 'NotFoundError' }
          });
        }

        res.json({
          success: true,
          message: 'Spotlight deleted'
        });
      } catch (error) {
        logger.error('Error deleting spotlight', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to delete spotlight', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // ENHANCED SUMMARIES ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/bill/{congress}/{type}/{number}/enhanced-summary:
   *   get:
   *     summary: Get enhanced summaries for a bill
   */
  router.get('/db/bill/:congress/:type/:number/enhanced-summary',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { congress, type, number } = req.params;
        const billId = `${congress}-${type.toUpperCase()}-${number}`;

        const summaries = await spotlightService.getBillSummaries(billId);

        res.json({
          success: true,
          billId,
          summaries
        });
      } catch (error) {
        logger.error('Error fetching enhanced summaries', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch summaries', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/bill/{congress}/{type}/{number}/enhanced-summary:
   *   post:
   *     summary: Create or update an enhanced summary for a bill
   */
  router.post('/db/bill/:congress/:type/:number/enhanced-summary',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { congress, type, number } = req.params;
        const billId = `${congress}-${type.toUpperCase()}-${number}`;
        const { summary_type, content, the_debate_supporters, the_debate_critics, affects_tags, generated_by, confidence_score } = req.body;

        if (!summary_type || !content) {
          return res.status(400).json({
            success: false,
            error: { message: 'summary_type and content are required', type: 'ValidationError' }
          });
        }

        const summary = await spotlightService.upsertBillSummary({
          bill_id: billId,
          summary_type,
          content,
          the_debate_supporters,
          the_debate_critics,
          affects_tags: affects_tags || [],
          generated_by: generated_by || 'manual',
          confidence_score
        });

        res.status(201).json({
          success: true,
          summary
        });
      } catch (error) {
        logger.error('Error upserting summary', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to save summary', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // DASHBOARD FEED ENDPOINTS (Internal - not mirroring Congress API)
  // ========================================================================

  /**
   * @swagger
   * /api/feed/congressional-activity:
   *   get:
   *     summary: Get congressional activity feed for dashboard
   *     description: Returns recent bills with sponsor information for the dashboard feed.
   *                  Optionally filter by state/district to show user's representatives' activity.
   *     parameters:
   *       - name: state
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by state code (e.g., "GA")
   *       - name: district
   *         in: query
   *         schema:
   *           type: integer
   *         description: Filter by congressional district number
   *       - name: limit
   *         in: query
   *         schema:
   *           type: integer
   *           default: 20
   *       - name: offset
   *         in: query
   *         schema:
   *           type: integer
   *           default: 0
   */
  router.get('/feed/congressional-activity',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { state, district, bioguideIds } = req.query;
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const offset = parseInt(req.query.offset) || 0;


      try {
        let query;
        let queryParams;
        let countQuery;
        let countParams;

        // If bioguideIds provided, filter by specific members
        if (bioguideIds) {
          const ids = bioguideIds.split(',').map(id => id.trim().toUpperCase());

          query = `
            SELECT
              b.bill_id,
              b.congress_id,
              b.bill_type,
              b.bill_number,
              b.title,
              b.origin_chamber,
              b.latest_action_date,
              b.latest_action_text,
              m.bioguide_id as sponsor_bioguide_id,
              m.first_name as sponsor_first_name,
              m.last_name as sponsor_last_name,
              m.depiction_url as sponsor_photo_url,
              mph.party_abbreviation as sponsor_party,
              mt.state_code as sponsor_state,
              mt.district as sponsor_district,
              mt.chamber as sponsor_chamber
            FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            INNER JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            LEFT JOIN LATERAL (
              SELECT party_abbreviation FROM member_party_history
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY start_year DESC LIMIT 1
            ) mph ON true
            LEFT JOIN LATERAL (
              SELECT state_code, district, chamber FROM member_term
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY congress DESC LIMIT 1
            ) mt ON true
            WHERE b.congress_id = 119
              AND m.bioguide_id = ANY($1)
            ORDER BY b.latest_action_date DESC NULLS LAST
            LIMIT $2 OFFSET $3
          `;
          queryParams = [ids, limit, offset];

          countQuery = `
            SELECT COUNT(*) FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            WHERE b.congress_id = 119 AND bs.member_bioguide_id = ANY($1)
          `;
          countParams = [ids];

        } else if (state) {
          // Filter by state (and optionally district)
          const districtNum = district ? parseInt(district) : null;

          query = `
            SELECT
              b.bill_id,
              b.congress_id,
              b.bill_type,
              b.bill_number,
              b.title,
              b.origin_chamber,
              b.latest_action_date,
              b.latest_action_text,
              m.bioguide_id as sponsor_bioguide_id,
              m.first_name as sponsor_first_name,
              m.last_name as sponsor_last_name,
              m.depiction_url as sponsor_photo_url,
              mph.party_abbreviation as sponsor_party,
              mt.state_code as sponsor_state,
              mt.district as sponsor_district,
              mt.chamber as sponsor_chamber
            FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            INNER JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            LEFT JOIN LATERAL (
              SELECT party_abbreviation FROM member_party_history
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY start_year DESC LIMIT 1
            ) mph ON true
            INNER JOIN LATERAL (
              SELECT state_code, district, chamber FROM member_term
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY congress DESC LIMIT 1
            ) mt ON true
            WHERE b.congress_id = 119
              AND mt.state_code = $1
              AND ($2::int IS NULL OR mt.district = $2 OR mt.chamber = 'Senate')
            ORDER BY b.latest_action_date DESC NULLS LAST
            LIMIT $3 OFFSET $4
          `;
          queryParams = [state.toUpperCase(), districtNum, limit, offset];

          countQuery = `
            SELECT COUNT(*) FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            INNER JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            INNER JOIN LATERAL (
              SELECT state_code, district, chamber FROM member_term
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY congress DESC LIMIT 1
            ) mt ON true
            WHERE b.congress_id = 119
              AND mt.state_code = $1
              AND ($2::int IS NULL OR mt.district = $2 OR mt.chamber = 'Senate')
          `;
          countParams = [state.toUpperCase(), districtNum];

        } else {
          // No filter - return recent bills with sponsors
          query = `
            SELECT
              b.bill_id,
              b.congress_id,
              b.bill_type,
              b.bill_number,
              b.title,
              b.origin_chamber,
              b.latest_action_date,
              b.latest_action_text,
              m.bioguide_id as sponsor_bioguide_id,
              m.first_name as sponsor_first_name,
              m.last_name as sponsor_last_name,
              m.depiction_url as sponsor_photo_url,
              mph.party_abbreviation as sponsor_party,
              mt.state_code as sponsor_state,
              mt.district as sponsor_district,
              mt.chamber as sponsor_chamber
            FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            INNER JOIN member m ON bs.member_bioguide_id = m.bioguide_id
            LEFT JOIN LATERAL (
              SELECT party_abbreviation FROM member_party_history
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY start_year DESC LIMIT 1
            ) mph ON true
            LEFT JOIN LATERAL (
              SELECT state_code, district, chamber FROM member_term
              WHERE member_bioguide_id = m.bioguide_id
              ORDER BY congress DESC LIMIT 1
            ) mt ON true
            WHERE b.congress_id = 119
            ORDER BY b.latest_action_date DESC NULLS LAST
            LIMIT $1 OFFSET $2
          `;
          queryParams = [limit, offset];

          countQuery = `
            SELECT COUNT(*) FROM bill b
            INNER JOIN bill_sponsor bs ON b.bill_id = bs.bill_id
            WHERE b.congress_id = 119
          `;
          countParams = [];
        }

        const [result, countResult] = await Promise.all([
          db.query(query, queryParams),
          db.query(countQuery, countParams)
        ]);

        const totalCount = parseInt(countResult.rows[0].count);

        const activities = result.rows.map(row => ({
          id: `activity-${row.bill_id}`,
          legislator: {
            id: row.sponsor_bioguide_id,
            bioguideId: row.sponsor_bioguide_id,
            firstName: row.sponsor_first_name,
            lastName: row.sponsor_last_name,
            fullName: `${row.sponsor_first_name} ${row.sponsor_last_name}`,
            party: row.sponsor_party,
            state: row.sponsor_state,
            district: row.sponsor_district,
            chamber: row.sponsor_chamber,
            photoUrl: row.sponsor_photo_url || `https://www.congress.gov/img/member/${row.sponsor_bioguide_id?.toLowerCase()}_200.jpg`
          },
          action: {
            type: 'sponsored',
            text: row.latest_action_text,
            timestamp: row.latest_action_date,
            date: row.latest_action_date ? row.latest_action_date.toISOString().split('T')[0] : null
          },
          bill: {
            id: row.bill_id,
            type: row.bill_type?.toUpperCase(),
            number: row.bill_number,
            congress: row.congress_id,
            title: row.title,
            originChamber: row.origin_chamber
          }
        }));

        res.json({
          success: true,
          activities,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + limit < totalCount
          },
          filters: {
            state: state || null,
            district: district ? parseInt(district) : null,
            bioguideIds: bioguideIds ? bioguideIds.split(',') : null
          }
        });

      } catch (error) {
        logger.error('Feed query error:', error);
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch congressional activity', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // GEOCODING ENDPOINT
  // ========================================================================

  /**
   * @swagger
   * /api/geocode:
   *   get:
   *     summary: Geocode an address and get congressional district
   *     description: Uses US Census Bureau APIs to geocode address and find congressional district
   *     parameters:
   *       - name: address
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *         description: Full street address (e.g., "123 Main St, Atlanta, GA 30301")
   */
  router.get('/geocode',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { address } = req.query;

      if (!address || address.trim().length < 5) {
        return res.status(400).json({
          success: false,
          error: { message: 'Valid address is required', type: 'ValidationError' }
        });
      }

      try {
        // Step 1: Geocode the address using Census Geocoder API
        const geocodeUrl = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
        const geocodeResponse = await axios.get(geocodeUrl, {
          params: {
            address: address.trim(),
            benchmark: 'Public_AR_Current',
            format: 'json'
          },
          timeout: 10000
        });

        const addressMatches = geocodeResponse.data?.result?.addressMatches;
        if (!addressMatches || addressMatches.length === 0) {
          return res.status(404).json({
            success: false,
            error: { message: 'Address not found. Please check the address and try again.', type: 'NotFoundError' }
          });
        }

        const match = addressMatches[0];
        const coordinates = match.coordinates;
        const matchedAddress = match.matchedAddress;

        // Extract state from matched address
        const stateMatch = matchedAddress.match(/,\s*([A-Z]{2}),?\s*\d{5}/);
        const stateCode = stateMatch ? stateMatch[1] : null;

        // Step 2: Get congressional district using Census Geographic API
        const geoUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
        const geoResponse = await axios.get(geoUrl, {
          params: {
            x: coordinates.x,
            y: coordinates.y,
            benchmark: 'Public_AR_Current',
            vintage: 'Current_Current',
            layers: '54', // Congressional Districts layer
            format: 'json'
          },
          timeout: 10000
        });

        const geographies = geoResponse.data?.result?.geographies;
        // Census API returns different key names depending on the current congress
        const congressionalDistricts = geographies?.['119th Congressional Districts']
          || geographies?.['118th Congressional Districts']
          || geographies?.['Congressional Districts'];

        let district = null;
        let districtName = null;

        if (congressionalDistricts && congressionalDistricts.length > 0) {
          const cd = congressionalDistricts[0];
          // BASENAME contains just the district number (e.g., "4" for District 4)
          district = parseInt(cd.BASENAME || cd.CD119 || cd.CD118, 10);
          districtName = cd.NAME || `Congressional District ${district}`;

          // Handle at-large districts (district 0 or 98)
          if (district === 0 || district === 98) {
            district = 1; // At-large states have 1 representative
          }
        }

        logger.info('Geocoding successful', {
          address: address.substring(0, 50),
          state: stateCode,
          district,
          coordinates: { lat: coordinates.y, lng: coordinates.x }
        });

        res.json({
          success: true,
          address: matchedAddress,
          state: stateCode,
          district: district,
          districtName: districtName,
          latitude: coordinates.y,
          longitude: coordinates.x
        });

      } catch (error) {
        logger.error('Geocoding failed', {
          address: address.substring(0, 50),
          error: error.message
        });

        // Check if it's a timeout or network error
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          return res.status(504).json({
            success: false,
            error: { message: 'Geocoding service timeout. Please try again.', type: 'TimeoutError' }
          });
        }

        res.status(500).json({
          success: false,
          error: { message: 'Geocoding service error. Please try again later.', type: 'ServiceError' }
        });
      }
    })
  );

  // ========================================================================
  // MEMBER DATABASE ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/member:
   *   get:
   *     summary: Search members in the database
   *     description: Query members by state, district, party, chamber, etc.
   */
  router.get('/db/member',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const memberService = new MemberService(db);

      try {
        const { state, district, party, chamber, currentMember, congress, limit, offset } = req.query;

        // If state and optionally district provided, use the location query
        if (state) {
          const congressNum = congress ? parseInt(congress) : 119;
          const districtNum = district ? parseInt(district) : null;

          const members = await memberService.getRepresentativesByLocation(
            state,
            districtNum,
            congressNum
          );

          return res.json({
            success: true,
            count: members.length,
            members: members.map(m => ({
              bioguideId: m.bioguide_id,
              firstName: m.first_name,
              lastName: m.last_name,
              fullName: m.direct_order_name || `${m.first_name} ${m.last_name}`,
              state: m.state_code,
              stateName: m.state_name,
              district: m.district,
              party: m.party_code,
              partyName: m.party_name,
              chamber: m.chamber,
              photoUrl: m.depiction_url,
              officialUrl: m.official_url
            }))
          });
        }

        // Otherwise, use general search
        const searchResult = await memberService.searchMembers(
          {
            state,
            party,
            chamber,
            currentMember: currentMember === 'true' ? true : currentMember === 'false' ? false : undefined,
            congress: congress ? parseInt(congress) : undefined
          },
          {
            limit: limit ? parseInt(limit) : 20,
            offset: offset ? parseInt(offset) : 0
          }
        );

        res.json({
          success: true,
          ...searchResult
        });

      } catch (error) {
        logger.error('Error searching members', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to search members', type: 'DatabaseError' }
        });
      }
    })
  );

  /**
   * @swagger
   * /api/db/member/{bioguideId}:
   *   get:
   *     summary: Get member details by bioguide ID
   */
  router.get('/db/member/:bioguideId',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const memberService = new MemberService(db);

      try {
        const { bioguideId } = req.params;
        const member = await memberService.getMemberForAPI(bioguideId);

        if (!member) {
          return res.status(404).json({
            success: false,
            error: { message: 'Member not found', type: 'NotFoundError' }
          });
        }

        res.json({
          success: true,
          member
        });

      } catch (error) {
        logger.error('Error fetching member', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch member', type: 'DatabaseError' }
        });
      }
    })
  );

  /**
   * @swagger
   * /api/db/member/{bioguideId}/sponsored-bills:
   *   get:
   *     summary: Get bills sponsored by a member
   *     parameters:
   *       - in: path
   *         name: bioguideId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   */

  /**
   * @swagger
   * /api/db/bills:
   *   get:
   *     summary: Get all bills with pagination and sorting
   *     tags: [Bills]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           maximum: 100
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *       - in: query
   *         name: sort
   *         schema:
   *           type: string
   *           enum: [latest_action_date, introduced_date, bill_number]
   *           default: latest_action_date
   *       - in: query
   *         name: order
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *       - in: query
   *         name: congress
   *         schema:
   *           type: integer
   *         description: Filter by congress number (e.g., 119)
   */
  router.get('/db/bills',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      // Map API sort params to database column names
      const sortMapping = {
        'lastActionDate': 'latest_action_date',
        'latest_action_date': 'latest_action_date',
        'date': 'latest_action_date',
        'introduced_date': 'introduced_date',
        'number': 'bill_number',
        'bill_number': 'bill_number',
        'title': 'title'
      };
      const sortField = sortMapping[req.query.sort] || 'latest_action_date';
      const sortOrder = req.query.order === 'asc' ? 'ASC' : 'DESC';
      const congress = req.query.congress ? parseInt(req.query.congress) : null;

      try {
        let whereClause = '';
        const params = [];
        let paramIndex = 1;

        if (congress) {
          whereClause = `WHERE congress_id = $${paramIndex}`;
          params.push(congress);
          paramIndex++;
        }

        const result = await db.query(`
          SELECT
            bill_id,
            congress_id as congress,
            bill_type as type,
            bill_number as number,
            title,
            introduced_date,
            latest_action_date,
            latest_action_text
          FROM bill
          ${whereClause}
          ORDER BY ${sortField} ${sortOrder} NULLS LAST, bill_id DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...params, limit, offset]);

        const countResult = await db.query(`
          SELECT COUNT(*) as total
          FROM bill
          ${whereClause}
        `, params);

        res.json({
          success: true,
          bills: result.rows,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + result.rows.length < parseInt(countResult.rows[0].total)
          }
        });

      } catch (error) {
        console.error('[API] Error fetching bills:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch bills' });
      }    })
  );

  router.get('/db/member/:bioguideId/sponsored-bills',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      const { bioguideId } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      try {
        const result = await db.query(`
          SELECT
            b.bill_id,
            b.congress_id as congress,
            b.bill_type as type,
            b.bill_number as number,
            b.title,
            b.introduced_date,
            b.latest_action_date,
            b.latest_action_text,
            bs.sponsorship_date,
            bs.is_by_request
          FROM bill_sponsor bs
          JOIN bill b ON bs.bill_id = b.bill_id
          WHERE bs.member_bioguide_id = $1
          ORDER BY COALESCE(bs.sponsorship_date, b.introduced_date) DESC
          LIMIT $2 OFFSET $3
        `, [bioguideId, limit, offset]);

        const countResult = await db.query(`
          SELECT COUNT(*) as total
          FROM bill_sponsor
          WHERE member_bioguide_id = $1
        `, [bioguideId]);

        res.json({
          success: true,
          bills: result.rows,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + result.rows.length < parseInt(countResult.rows[0].total)
          }
        });

      } catch (error) {
        logger.error('Error fetching sponsored bills', { bioguideId, error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch sponsored bills', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/member/{bioguideId}/cosponsored-bills:
   *   get:
   *     summary: Get bills cosponsored by a member
   *     parameters:
   *       - in: path
   *         name: bioguideId
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   */
  router.get('/db/member/:bioguideId/cosponsored-bills',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      const { bioguideId } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      try {
        const result = await db.query(`
          SELECT
            b.bill_id,
            b.congress_id as congress,
            b.bill_type as type,
            b.bill_number as number,
            b.title,
            b.introduced_date,
            b.latest_action_date,
            b.latest_action_text,
            bc.sponsorship_date,
            bc.is_original_cosponsor
          FROM bill_cosponsor bc
          JOIN bill b ON bc.bill_id = b.bill_id
          WHERE bc.bioguide_id = $1
            AND bc.sponsorship_withdrawn_date IS NULL
          ORDER BY COALESCE(bc.sponsorship_date, b.introduced_date) DESC
          LIMIT $2 OFFSET $3
        `, [bioguideId, limit, offset]);

        const countResult = await db.query(`
          SELECT COUNT(*) as total
          FROM bill_cosponsor
          WHERE bioguide_id = $1
            AND sponsorship_withdrawn_date IS NULL
        `, [bioguideId]);

        res.json({
          success: true,
          bills: result.rows,
          pagination: {
            total: parseInt(countResult.rows[0].total),
            limit,
            offset,
            hasMore: offset + result.rows.length < parseInt(countResult.rows[0].total)
          }
        });

      } catch (error) {
        logger.error('Error fetching cosponsored bills', { bioguideId, error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch cosponsored bills', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // NEWS INGESTION & SPOTLIGHT SUGGESTIONS ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/spotlight/suggestions:
   *   get:
   *     summary: Get AI-generated spotlight suggestions based on news analysis
   *     description: Analyzes current news RSS feeds to find bills mentioned in the news or matching trending topics
   *     parameters:
   *       - in: query
   *         name: autoCreate
   *         schema:
   *           type: boolean
   *           default: false
   *         description: If true, automatically creates spotlight entries for high-confidence suggestions
   *       - in: query
   *         name: minScore
   *         schema:
   *           type: integer
   *           default: 15
   *         description: Minimum score threshold for auto-creation (only used if autoCreate=true)
   */
  router.get('/db/spotlight/suggestions',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { NewsIngestionService } = require('../../sync-service/services/news-ingestion-service');

      try {
        const newsService = new NewsIngestionService({ pool: db, managePool: false });
        const { autoCreate, minScore } = req.query;

        // Generate spotlight suggestions from news analysis
        const analysis = await newsService.generateSpotlightSuggestions();

        if (!analysis.success) {
          return res.status(500).json({
            success: false,
            error: { message: analysis.error, type: 'NewsAnalysisError' }
          });
        }

        // Store analysis results
        await newsService.storeAnalysisResults(analysis);

        // Optionally auto-create high-confidence spotlights
        let autoCreated = [];
        if (autoCreate === 'true') {
          autoCreated = await newsService.autoCreateSpotlights(
            analysis.spotlightSuggestions,
            parseInt(minScore) || 15
          );
        }

        res.json({
          success: true,
          ...analysis,
          autoCreated
        });
      } catch (error) {
        logger.error('Error generating spotlight suggestions', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to analyze news for spotlight suggestions', type: 'NewsAnalysisError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/trending-topics:
   *   get:
   *     summary: Get current trending topics from news analysis
   *     description: Returns the most recent trending topics extracted from news feeds
   */
  router.get('/db/trending-topics',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const { limit } = req.query;

        // Get most recent analysis
        const analysisResult = await db.query(`
          SELECT trending_topics, top_keywords, analyzed_at
          FROM news_analysis_log
          ORDER BY analyzed_at DESC
          LIMIT 1
        `);

        if (analysisResult.rows.length === 0) {
          return res.json({
            success: true,
            message: 'No news analysis available yet. Run /api/db/spotlight/suggestions first.',
            topics: {},
            keywords: []
          });
        }

        const analysis = analysisResult.rows[0];

        // Also get active trending topics from dedicated table
        const topicsResult = await db.query(`
          SELECT topic_name, category, score, source_count, last_seen
          FROM trending_topic
          WHERE is_active = true
          ORDER BY score DESC
          LIMIT $1
        `, [parseInt(limit) || 20]);

        res.json({
          success: true,
          analyzedAt: analysis.analyzed_at,
          topicScores: analysis.trending_topics,
          topKeywords: (analysis.top_keywords || []).slice(0, parseInt(limit) || 20),
          activeTopics: topicsResult.rows
        });
      } catch (error) {
        logger.error('Error fetching trending topics', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch trending topics', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/news-analysis/history:
   *   get:
   *     summary: Get history of news analysis runs
   */
  router.get('/db/news-analysis/history',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const { limit } = req.query;

        const result = await db.query(`
          SELECT
            analysis_id,
            analyzed_at,
            items_analyzed,
            feed_errors,
            direct_mentions_count,
            topical_matches_count,
            jsonb_array_length(suggestions_generated) as suggestions_count
          FROM news_analysis_log
          ORDER BY analyzed_at DESC
          LIMIT $1
        `, [parseInt(limit) || 10]);

        res.json({
          success: true,
          count: result.rows.length,
          analyses: result.rows
        });
      } catch (error) {
        logger.error('Error fetching news analysis history', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch analysis history', type: 'DatabaseError' }
        });
      }    })
  );

  // USER FOLLOW ENDPOINTS
  // ========================================================================

  /**
   * @swagger
   * /api/db/user/{userId}/follows:
   *   get:
   *     summary: Get all items a user is following
   */
  router.get('/db/user/:userId/follows',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { userId } = req.params;
        const { type } = req.query;

        const follows = await spotlightService.getUserFollows(userId, type || null);

        res.json({
          success: true,
          userId,
          count: follows.length,
          follows
        });
      } catch (error) {
        logger.error('Error fetching user follows', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch follows', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/user/{userId}/follows/bills:
   *   get:
   *     summary: Get followed bills with full details
   */
  router.get('/db/user/:userId/follows/bills',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { userId } = req.params;

        const bills = await spotlightService.getUserFollowedBills(userId);

        res.json({
          success: true,
          userId,
          count: bills.length,
          bills
        });
      } catch (error) {
        logger.error('Error fetching user followed bills', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch followed bills', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/user/{userId}/follow:
   *   post:
   *     summary: Follow a bill, topic, or member
   */
  router.post('/db/user/:userId/follow',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { userId } = req.params;
        const { follow_type, target_id, notify } = req.body;

        if (!follow_type || !target_id) {
          return res.status(400).json({
            success: false,
            error: { message: 'follow_type and target_id are required', type: 'ValidationError' }
          });
        }

        if (!['bill', 'topic', 'member'].includes(follow_type)) {
          return res.status(400).json({
            success: false,
            error: { message: 'follow_type must be bill, topic, or member', type: 'ValidationError' }
          });
        }

        const follow = await spotlightService.addFollow(userId, follow_type, target_id, notify || false);

        res.status(201).json({
          success: true,
          follow
        });
      } catch (error) {
        logger.error('Error adding follow', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to add follow', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/user/{userId}/follow:
   *   delete:
   *     summary: Unfollow a bill, topic, or member
   */
  router.delete('/db/user/:userId/follow',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { userId } = req.params;
        const { follow_type, target_id } = req.body;

        if (!follow_type || !target_id) {
          return res.status(400).json({
            success: false,
            error: { message: 'follow_type and target_id are required', type: 'ValidationError' }
          });
        }

        const deleted = await spotlightService.removeFollow(userId, follow_type, target_id);

        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: { message: 'Follow not found', type: 'NotFoundError' }
          });
        }

        res.json({
          success: true,
          message: 'Unfollowed successfully'
        });
      } catch (error) {
        logger.error('Error removing follow', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to remove follow', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/user/{userId}/is-following:
   *   get:
   *     summary: Check if user is following an item
   */
  router.get('/db/user/:userId/is-following',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const spotlightService = new SpotlightService(db);
        const { userId } = req.params;
        const { follow_type, target_id } = req.query;

        if (!follow_type || !target_id) {
          return res.status(400).json({
            success: false,
            error: { message: 'follow_type and target_id query params are required', type: 'ValidationError' }
          });
        }

        const isFollowing = await spotlightService.isFollowing(userId, follow_type, target_id);

        res.json({
          success: true,
          userId,
          followType: follow_type,
          targetId: target_id,
          isFollowing
        });
      } catch (error) {
        logger.error('Error checking follow status', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to check follow status', type: 'DatabaseError' }
        });
      }    })
  );

  // ========================================================================
  // PHASE 1 DASHBOARD ENDPOINTS - Bill Journey, AI Summaries, Location
  // ========================================================================

  /**
   * @swagger
   * /api/db/bill/{congress}/{type}/{number}/journey:
   *   get:
   *     summary: Get legislative journey information for a bill
   *     description: Returns the current stage, time at stage, and progress through the legislative process
   */
  router.get('/db/bill/:congress/:type/:number/journey',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const journeyService = new BillJourneyService(db);
        const { congress, type, number } = req.params;
        const billId = `${congress}-${type.toUpperCase()}-${number}`;

        const journey = await journeyService.getBillJourney(billId);

        if (!journey) {
          return res.status(404).json({
            success: false,
            error: { message: 'Bill not found', type: 'NotFoundError' }
          });
        }

        res.json({
          success: true,
          ...journey
        });
      } catch (error) {
        logger.error('Error fetching bill journey', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch bill journey', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/congress/{id}/legislative-stats:
   *   get:
   *     summary: Get aggregate legislative stage statistics for a congress
   *     description: Returns per-stage bill counts, advancement rates, and average days
   */
  router.get('/db/congress/:id/legislative-stats',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const journeyService = new BillJourneyService(db);
        const congressId = parseInt(req.params.id);

        if (isNaN(congressId) || congressId < 1) {
          return res.status(400).json({
            success: false,
            error: { message: 'Invalid congress ID', type: 'ValidationError' }
          });
        }

        const stats = await journeyService.getCongressStats(congressId);
        res.json({ success: true, ...stats });
      } catch (error) {
        logger.error('Error fetching legislative stats', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch legislative stats', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/bill/{congress}/{type}/{number}/ai-summary:
   *   get:
   *     summary: Get AI-generated summaries for a bill
   *     description: Returns cached summaries or generates new ones if not available
   *     parameters:
   *       - name: type
   *         in: query
   *         schema:
   *           type: string
   *           enum: [short, optimistic, cynical, realistic, all]
   *         description: Type of summary to retrieve (default: all)
   */
  router.get('/db/bill/:congress/:type/:number/ai-summary',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const { congress, type, number } = req.params;
        const billId = `${congress}-${type.toUpperCase()}-${number}`;
        const summaryType = req.query.type || 'all';

        // Check for cached summaries
        let query;
        let params;

        if (summaryType === 'all') {
          query = `SELECT * FROM get_bill_summaries($1)`;
          params = [billId];
        } else {
          query = `
            SELECT summary_type, content, text_version_code, model_used, generated_at
            FROM bill_ai_summary
            WHERE bill_id = $1 AND summary_type = $2
          `;
          params = [billId, summaryType];
        }

        const result = await db.query(query, params);

        // Get bill title for context
        const billResult = await db.query(
          'SELECT title FROM bill WHERE bill_id = $1',
          [billId]
        );

        const bill = billResult.rows[0];
        if (!bill) {
          return res.status(404).json({
            success: false,
            error: { message: 'Bill not found', type: 'NotFoundError' }
          });
        }

        // Format response
        const summaries = {};
        for (const row of result.rows) {
          summaries[row.summary_type] = row.content;
        }

        res.json({
          success: true,
          billId,
          title: bill.title,
          summaries,
          hasSummaries: result.rows.length > 0,
          generatedAt: result.rows[0]?.generated_at || null,
          model: result.rows[0]?.model_used || null
        });
      } catch (error) {
        logger.error('Error fetching AI summaries', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to fetch summaries', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/db/bill/{congress}/{type}/{number}/ai-summary:
   *   post:
   *     summary: Generate or update AI summaries for a bill
   *     description: Uses AI to generate summaries and stores them in the database
   */
  router.post('/db/bill/:congress/:type/:number/ai-summary',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {

      try {
        const { congress, type, number } = req.params;
        const billId = `${congress}-${type.toUpperCase()}-${number}`;
        const { summaries, text_version_code } = req.body;

        if (!summaries || typeof summaries !== 'object') {
          return res.status(400).json({
            success: false,
            error: { message: 'summaries object is required', type: 'ValidationError' }
          });
        }

        const validTypes = ['short', 'optimistic', 'cynical', 'realistic'];
        const results = [];

        for (const [summaryType, content] of Object.entries(summaries)) {
          if (!validTypes.includes(summaryType)) continue;
          if (!content) continue;

          const result = await db.query(
            `SELECT * FROM upsert_bill_summary($1, $2, $3, $4, $5)`,
            [billId, summaryType, content, text_version_code || null, 'claude-3-5-haiku']
          );
          results.push(result.rows[0]);
        }

        res.status(201).json({
          success: true,
          billId,
          savedCount: results.length,
          summaries: results
        });
      } catch (error) {
        logger.error('Error saving AI summaries', { error: error.message });
        res.status(500).json({
          success: false,
          error: { message: 'Failed to save summaries', type: 'DatabaseError' }
        });
      }    })
  );

  /**
   * @swagger
   * /api/location/representatives:
   *   get:
   *     summary: Get representatives for a zip code
   *     description: Looks up congressional district from zip code and returns representatives
   *     parameters:
   *       - name: zip
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *         description: 5-digit zip code
   */
  router.get('/location/representatives',
    createMiddlewareChain('standardAPI'),
    asyncHandler(async (req, res) => {
      const { zip, state, district } = req.query;

      // If state is provided directly (manual selection), use it
      if (state) {
        const memberService = new MemberService(db);
        const districtNum = district ? parseInt(district) : null;
        const members = await memberService.getRepresentativesByLocation(state, districtNum, 119);

        return res.json({
          success: true,
          source: 'manual',
          state,
          district: districtNum,
          representatives: members.map(m => ({
            bioguideId: m.bioguide_id,
            firstName: m.first_name,
            lastName: m.last_name,
            fullName: m.direct_order_name || `${m.first_name} ${m.last_name}`,
            state: m.state_code,
            stateName: m.state_name,
            district: m.district,
            party: m.party_code,
            partyName: m.party_name,
            chamber: m.chamber,
            photoUrl: m.depiction_url,
            officialUrl: m.official_url
          }))
        });
      }

      // Zip code lookup
      if (!zip || !/^\d{5}$/.test(zip)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Valid 5-digit zip code is required', type: 'ValidationError' }
        });
      }

      try {
        const axios = require('axios');

        // Step 1: Use OpenStreetMap Nominatim to get coordinates from zip code
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=USA&format=json&limit=1`;
        const nominatimResponse = await axios.get(nominatimUrl, {
          timeout: 10000,
          headers: { 'User-Agent': 'CongressTracker/1.0 (congressional-tracking-app)' }
        });

        if (!nominatimResponse.data || nominatimResponse.data.length === 0) {
          return res.status(404).json({
            success: false,
            error: { message: 'Could not find location for this zip code', type: 'NotFoundError' }
          });
        }

        const { lat, lon } = nominatimResponse.data[0];

        // Step 2: Use Census API with coordinates to get congressional district
        const censusUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=54`;
        const censusResponse = await axios.get(censusUrl, { timeout: 10000 });
        const geographies = censusResponse.data?.result?.geographies;

        let stateCode = null;
        let districtNum = null;

        // Try to extract from 119th Congressional Districts
        const congressionalDistricts = geographies?.['119th Congressional Districts'];
        if (congressionalDistricts && congressionalDistricts.length > 0) {
          const cd = congressionalDistricts[0];
          stateCode = cd.STATE;
          // District number is in BASENAME field (e.g., "4" for district 4)
          districtNum = parseInt(cd.BASENAME) || 0;
        }

        if (!stateCode) {
          return res.status(404).json({
            success: false,
            error: { message: 'Could not determine congressional district from zip code', type: 'NotFoundError' }
          });
        }

        // State FIPS to code mapping
        const fipsToState = {
          '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
          '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
          '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
          '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
          '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
          '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
          '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
          '55': 'WI', '56': 'WY', '72': 'PR', '78': 'VI', '66': 'GU', '60': 'AS', '69': 'MP'
        };

        const stateAbbr = fipsToState[stateCode] || stateCode;

        // Get representatives
        const memberService = new MemberService(db);
        const members = await memberService.getRepresentativesByLocation(stateAbbr, districtNum, 119);

        res.json({
          success: true,
          source: 'nominatim_census',
          zip,
          state: stateAbbr,
          district: districtNum,
          representatives: members.map(m => ({
            bioguideId: m.bioguide_id,
            firstName: m.first_name,
            lastName: m.last_name,
            fullName: m.direct_order_name || `${m.first_name} ${m.last_name}`,
            state: m.state_code,
            stateName: m.state_name,
            district: m.district,
            party: m.party_code,
            partyName: m.party_name,
            chamber: m.chamber,
            photoUrl: m.depiction_url,
            officialUrl: m.official_url
          }))
        });
      } catch (error) {
        logger.error('Error looking up representatives', { zip, error: error.message });

        // If Census API fails, try a simpler approach - just return error for now
        res.status(500).json({
          success: false,
          error: {
            message: 'Failed to look up location. Please try manual state/district selection.',
            type: 'GeocodingError'
          }
        });
      }
    })
  );

  // ========================================================================

  // Dynamic API proxy handler - handles remaining Congress API endpoints
  router.use('/', (req, res, next) => {
    // Skip cache management endpoints and specific routes handled above
    if (req.path === '/cache-stats' || req.path === '/clear-cache' || req.path === '/quota-status' ||
        req.path.match(/^\/bill\/\d+\/[a-z]+\/\d+$/) ||
        req.path.match(/^\/bill\/\d+\/[a-z]+\/\d+\/(actions|committees|cosponsors|summaries|subjects|titles|text|amendments|relatedbills)$/) ||
        req.path.match(/^\/db\/hearing(\/.*)?$/) ||
        req.path.match(/^\/db\/law(\/.*)?$/) ||
        req.path.match(/^\/db\/committee-report(\/.*)?$/) ||
        req.path.match(/^\/db\/daily-congressional-record(\/.*)?$/) ||
        req.path.match(/^\/db\/congressional-record\/search$/) ||
        req.path.match(/^\/db\/bill\/\d+\/[a-z]+\/\d+\/congressional-record$/) ||
        req.path.match(/^\/db\/congressional-record\/article\/[SHEDshed]\d+$/) ||
        req.path.match(/^\/db\/congressional-record\/article\/\d+\/adjacent$/) ||
        req.path.match(/^\/db\/spotlight(\/\d+)?$/) ||
        req.path.match(/^\/db\/upcoming-meetings$/) ||
        req.path.match(/^\/db\/member(\/[A-Z]\d{6})?$/) ||
        req.path.match(/^\/db\/user\/[^/]+\/(follows|follow|is-following)(\/bills)?$/) ||
        req.path.match(/^\/db\/bill\/\d+\/[a-z]+\/\d+\/enhanced-summary$/) ||
        req.path.match(/^\/congress\/\d+$/) ||
        req.path.match(/^\/member\/[A-Z]\d{6}$/) ||
        req.path.match(/^\/committee\/[a-z]+$/) ||
        req.path.match(/^\/committee-report(\/[^/]+){0,3}(\/text)?$/)) {
      return next();
    }
    
    // Apply schema validation and middleware chain for other endpoints
    createValidationMiddleware(req.path)(req, res, (err) => {
      if (err) return next(err);
      if (res.headersSent) return; // Stop if response was already sent
      
      createMiddlewareChain('standardAPI')(req, res, (err) => {
        if (err) return next(err);
        if (res.headersSent) return; // Stop if response was already sent
        
        createProxyHandler()(req, res, next);
      });
    });
  });

  return router;
}

module.exports = { createAPIRoutes };
