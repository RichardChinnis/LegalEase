const express = require('express');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Health
 *   description: API for checking the health of the service
 */
function createHealthRoutes(cache) {
  // Enhanced health check endpoint with system metrics
  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Enhanced health check endpoint
   *     tags: [Health]
   *     description: Provides detailed health information about the service.
   *     responses:
   *       200:
   *         description: The service is healthy.
   */
  router.get('/health', (req, res) => {
    const uptime = process.uptime();
    const cacheStats = cache.getStats();
    
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      cache: {
        hitRate: cacheStats.hits + cacheStats.misses > 0 ?
          Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100) : 0
      },
      environment: process.env.NODE_ENV || 'development'
    };
    
    res.json(healthData);
  });

  // Readiness check endpoint (for Kubernetes/Docker)
  /**
   * @swagger
   * /ready:
   *   get:
   *     summary: Readiness check endpoint
   *     tags: [Health]
   *     description: Checks if the service is ready to handle requests.
   *     responses:
   *       200:
   *         description: The service is ready.
   *       503:
   *         description: The service is not ready.
   */
  router.get('/ready', (req, res) => {
    // Check if essential services are available
    const checks = {
      cache: cache.getStats() !== undefined,
      envVars: !!process.env.CONGRESS_API_KEY,
    };
    
    const allReady = Object.values(checks).every(Boolean);
    
    res.status(allReady ? 200 : 503).json({
      status: allReady ? 'ready' : 'not ready',
      timestamp: new Date().toISOString(),
      checks
    });
  });

  // Liveness check endpoint (for Kubernetes/Docker)
  /**
   * @swagger
   * /alive:
   *   get:
   *     summary: Liveness check endpoint
   *     tags: [Health]
   *     description: Checks if the service is alive.
   *     responses:
   *       200:
   *         description: The service is alive.
   */
  router.get('/alive', (req, res) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Metrics endpoint for monitoring systems (Prometheus format)
  /**
   * @swagger
   * /metrics:
   *   get:
   *     summary: Metrics endpoint for monitoring systems
   *     tags: [Health]
   *     description: Provides metrics in Prometheus format.
   *     responses:
   *       200:
   *         description: Metrics in Prometheus format.
   */
  router.get('/metrics', (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const cacheStats = cache.getStats();
    
    const metrics = [
      `# HELP congress_api_uptime_seconds Total uptime of the application`,
      `# TYPE congress_api_uptime_seconds counter`,
      `congress_api_uptime_seconds ${uptime}`,
      '',
      `# HELP congress_api_memory_usage_bytes Memory usage in bytes`,
      `# TYPE congress_api_memory_usage_bytes gauge`,
      `congress_api_memory_usage_bytes{type="rss"} ${memoryUsage.rss}`,
      `congress_api_memory_usage_bytes{type="heap_used"} ${memoryUsage.heapUsed}`,
      `congress_api_memory_usage_bytes{type="heap_total"} ${memoryUsage.heapTotal}`,
      `congress_api_memory_usage_bytes{type="external"} ${memoryUsage.external}`,
      '',
      `# HELP congress_api_cache_keys_total Total number of cache keys`,
      `# TYPE congress_api_cache_keys_total gauge`,
      `congress_api_cache_keys_total ${cacheStats.keys}`,
      '',
      `# HELP congress_api_cache_hits_total Total cache hits`,
      `# TYPE congress_api_cache_hits_total counter`,
      `congress_api_cache_hits_total ${cacheStats.hits}`,
      '',
      `# HELP congress_api_cache_misses_total Total cache misses`,
      `# TYPE congress_api_cache_misses_total counter`,
      `congress_api_cache_misses_total ${cacheStats.misses}`,
      '',
      `# HELP congress_api_cache_hit_rate Cache hit rate percentage`,
      `# TYPE congress_api_cache_hit_rate gauge`,
      `congress_api_cache_hit_rate ${cacheStats.hits + cacheStats.misses > 0 ? 
        (cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100 : 0}`,
      ''
    ].join('\n');
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  });

  return router;
}

module.exports = { createHealthRoutes };