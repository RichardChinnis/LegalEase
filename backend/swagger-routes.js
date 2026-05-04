/**
 * @swagger
 * tags:
 *   - name: System
 *     description: System health and monitoring endpoints
 *   - name: Cache
 *     description: Cache management endpoints
 *   - name: Bills
 *     description: Congressional bills and legislation
 *   - name: Members
 *     description: Congress members and legislators
 *   - name: Committees
 *     description: Congressional committees
 *   - name: Congress
 *     description: Congress sessions and information
 */

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Enhanced health check with system metrics
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server health status with detailed metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: object
 *                   properties:
 *                     seconds:
 *                       type: integer
 *                     human:
 *                       type: string
 *                       example: "1h 23m 45s"
 *                 memory:
 *                   type: object
 *                   properties:
 *                     rss:
 *                       type: integer
 *                       description: Resident Set Size in MB
 *                     heapUsed:
 *                       type: integer
 *                       description: Heap used in MB
 *                     heapTotal:
 *                       type: integer
 *                       description: Total heap in MB
 *                     external:
 *                       type: integer
 *                       description: External memory in MB
 *                 cache:
 *                   type: object
 *                   properties:
 *                     keys:
 *                       type: integer
 *                     hits:
 *                       type: integer
 *                     misses:
 *                       type: integer
 *                     hitRate:
 *                       type: integer
 *                       description: Cache hit rate percentage
 *                 environment:
 *                   type: string
 *                 nodeVersion:
 *                   type: string
 *                 pid:
 *                   type: integer
 */

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Readiness check for container orchestration
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is ready to receive traffic
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *                   properties:
 *                     cache:
 *                       type: boolean
 *                     envVars:
 *                       type: boolean
 *       503:
 *         description: Service is not ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: not ready
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 */

/**
 * @swagger
 * /alive:
 *   get:
 *     summary: Liveness check for container orchestration
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: alive
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 pid:
 *                   type: integer
 *                 uptime:
 *                   type: number
 */

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Prometheus-compatible metrics endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Metrics in Prometheus format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 # HELP congress_api_uptime_seconds Total uptime of the application
 *                 # TYPE congress_api_uptime_seconds counter
 *                 congress_api_uptime_seconds 1234.567
 */

/**
 * @swagger
 * /api/cache-stats:
 *   get:
 *     summary: Get cache statistics
 *     tags: [Cache]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheStats'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @swagger
 * /api/clear-cache:
 *   post:
 *     summary: Clear all cached data
 *     tags: [Cache]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Cache cleared successfully
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */

/**
 * @swagger
 * /api/bill:
 *   get:
 *     summary: Get list of bills
 *     tags: [Bills]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Limit'
 *       - $ref: '#/components/parameters/Offset'
 *     responses:
 *       200:
 *         description: List of bills
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *           X-Rate-Limit-Remaining:
 *             description: Remaining API requests
 *             schema:
 *               type: integer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BillList'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/bill/{congress}/{type}/{number}:
 *   get:
 *     summary: Get specific bill details
 *     tags: [Bills]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CongressNumber'
 *       - $ref: '#/components/parameters/BillType'
 *       - $ref: '#/components/parameters/BillNumber'
 *     responses:
 *       200:
 *         description: Bill details
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *           X-Rate-Limit-Remaining:
 *             description: Remaining API requests
 *             schema:
 *               type: integer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bill'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/member:
 *   get:
 *     summary: Get list of Congress members
 *     tags: [Members]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Limit'
 *       - $ref: '#/components/parameters/Offset'
 *     responses:
 *       200:
 *         description: List of Congress members
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/member/{bioguideId}:
 *   get:
 *     summary: Get specific member details
 *     tags: [Members]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/BioguideId'
 *     responses:
 *       200:
 *         description: Member details
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Member'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/committee:
 *   get:
 *     summary: Get list of committees
 *     tags: [Committees]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Limit'
 *       - $ref: '#/components/parameters/Offset'
 *     responses:
 *       200:
 *         description: List of committees
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Committee'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/committee/{chamber}:
 *   get:
 *     summary: Get committees by chamber
 *     tags: [Committees]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Chamber'
 *       - $ref: '#/components/parameters/Limit'
 *       - $ref: '#/components/parameters/Offset'
 *     responses:
 *       200:
 *         description: List of committees for the specified chamber
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Committee'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/congress:
 *   get:
 *     summary: Get list of Congress sessions
 *     tags: [Congress]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Limit'
 *       - $ref: '#/components/parameters/Offset'
 *     responses:
 *       200:
 *         description: List of Congress sessions
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 congresses:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /api/congress/{congress}:
 *   get:
 *     summary: Get specific Congress session details
 *     tags: [Congress]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/CongressNumber'
 *     responses:
 *       200:
 *         description: Congress session details
 *         headers:
 *           X-Data-Source:
 *             description: Data source (cache or api)
 *             schema:
 *               type: string
 *               enum: [cache, api]
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Congress'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */