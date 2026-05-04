const request = require('supertest');
const { createApp } = require('../shared/app-factory');

// Integration tests for Congress API Server
// These tests hit real endpoints and verify actual functionality
// No mocking - tests the complete application flow with real Congress API

// Create test app using the shared factory
const app = createApp({ includeTestRoutes: true });

describe('Congress API Server Integration Tests', () => {
  // Clear cache before each test to ensure clean state
  beforeEach(() => {
    app.cache.flushAll();
  });

  describe('Health Check', () => {
    test('GET /health should return enhanced health metrics', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body.uptime).toHaveProperty('seconds');
      expect(response.body.uptime).toHaveProperty('human');
      expect(response.body).toHaveProperty('cache');
      expect(response.body.cache).toHaveProperty('hitRate');
      expect(response.body).toHaveProperty('environment');
    });
  });

  describe('Container Health Checks', () => {
    test('GET /ready should return readiness status', async () => {
      const response = await request(app)
        .get('/ready')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ready');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('cache', true);
      expect(response.body.checks).toHaveProperty('envVars', true);
    });

    test('GET /alive should return liveness status', async () => {
      const response = await request(app)
        .get('/alive')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'alive');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });
  });

  describe('Metrics', () => {
    test('GET /metrics should return Prometheus format metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('congress_api_uptime_seconds');
      expect(response.text).toContain('congress_api_memory_usage_bytes');
      expect(response.text).toContain('congress_api_cache_keys_total');
      expect(response.text).toContain('# HELP');
      expect(response.text).toContain('# TYPE');
    });
  });

  describe('Cache Management', () => {
    test('GET /api/cache-stats should return cache statistics', async () => {
      const response = await request(app)
        .get('/api/cache-stats')
        .expect(200);
      
      expect(response.body).toHaveProperty('keys');
      expect(response.body).toHaveProperty('hits');
      expect(response.body).toHaveProperty('misses');
    });

    test('POST /api/clear-cache should clear cache', async () => {
      const response = await request(app)
        .post('/api/clear-cache')
        .expect(200);
      
      expect(response.body.message).toBe('Cache cleared successfully');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      // Helmet.js security headers
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });
  });

  describe('Rate Limiting Headers', () => {
    test('should include rate limit headers in responses', async () => {
      const response = await request(app)
        .get('/api/cache-stats')
        .expect(200);
      
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');
    });
  });

  describe('Authentication', () => {
    test('should work without authentication when no token configured', async () => {
      // Since API_AUTH_TOKEN is not set, requests should work without auth
      await request(app)
        .get('/api/cache-stats')
        .expect(200);
    });
  });

  describe('Input Validation', () => {
    test('should reject invalid congress numbers', async () => {
      const response = await request(app)
        .get('/api/bill/999999/hr/1')
        .expect(400);
      
      expect(response.body.error.message).toContain('Invalid path parameters');
      expect(response.body.error.message).toContain('"congress" must be less than or equal to 125');
    });

    test('should reject invalid bill types', async () => {
      const response = await request(app)
        .get('/api/bill/118/invalid/1')
        .expect(400);
      
      expect(response.body.error.message).toContain('Invalid path parameters');
      expect(response.body.error.message).toContain('"type" must be one of [hr, s, hjres, sjres, hconres, sconres, hres, sres]');
    });

    test('should reject invalid bioguide IDs', async () => {
      const response = await request(app)
        .get('/api/member/INVALID123')
        .expect(400);
      
      expect(response.body.error.message).toContain('Invalid path parameters');
    });
  });

  describe('Congress API Integration - Bills', () => {
    test('should fetch bill data from Congress API', async () => {
      const response = await request(app)
        .get('/api/bill/118/hr/1')
        .expect(200);
      
      expect(response.body).toHaveProperty('bill');
      expect(response.body.bill).toHaveProperty('congress');
      expect(response.body.bill.congress).toBe(118);
      expect(response.body.bill).toHaveProperty('type');
      expect(response.body.bill.type).toBe('HR');
      expect(response.body.bill).toHaveProperty('number');
      expect(response.body.bill.number).toBe('1');
      expect(response.headers).toHaveProperty('x-data-source');
    }, 10000);

    test('should return cached data on second request', async () => {
      // First request
      await request(app)
        .get('/api/bill/118/hr/1')
        .expect(200);
      
      // Second request should be from cache
      const response = await request(app)
        .get('/api/bill/118/hr/1')
        .expect(200);
      
      expect(response.headers['x-data-source']).toBe('cache');
    }, 10000);

    test('should handle bill list endpoint', async () => {
      const response = await request(app)
        .get('/api/bill')
        .query({ limit: 5 })
        .expect(200);
      
      expect(response.body).toHaveProperty('bills');
      expect(Array.isArray(response.body.bills)).toBe(true);
      expect(response.body.bills.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Congress API Integration - Members', () => {
    test('should fetch member data from Congress API', async () => {
      const response = await request(app)
        .get('/api/member/A000148')
        .expect(200);
      
      expect(response.body).toHaveProperty('member');
      expect(response.body.member).toHaveProperty('bioguideId');
      expect(response.body.member.bioguideId).toBe('A000148');
    }, 10000);

    test('should handle member list endpoint', async () => {
      const response = await request(app)
        .get('/api/member')
        .query({ limit: 5 })
        .expect(200);
      
      expect(response.body).toHaveProperty('members');
      expect(Array.isArray(response.body.members)).toBe(true);
      expect(response.body.members.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Congress API Integration - Committees', () => {
    test('should fetch committee data from Congress API', async () => {
      const response = await request(app)
        .get('/api/committee/house')
        .expect(200);
      
      expect(response.body).toHaveProperty('committees');
      expect(Array.isArray(response.body.committees)).toBe(true);
    }, 10000);

    test('should handle committee list endpoint', async () => {
      const response = await request(app)
        .get('/api/committee')
        .query({ limit: 5 })
        .expect(200);
      
      expect(response.body).toHaveProperty('committees');
      expect(Array.isArray(response.body.committees)).toBe(true);
      expect(response.body.committees.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Congress API Integration - Congress Sessions', () => {
    test('should fetch congress session data', async () => {
      const response = await request(app)
        .get('/api/congress/118')
        .expect(200);
      
      expect(response.body).toHaveProperty('congress');
      expect(response.body.congress).toHaveProperty('number');
      expect(response.body.congress.number).toBe(118);
    }, 10000);

    test('should handle congress list endpoint', async () => {
      const response = await request(app)
        .get('/api/congress')
        .query({ limit: 5 })
        .expect(200);
      
      expect(response.body).toHaveProperty('congresses');
      expect(Array.isArray(response.body.congresses)).toBe(true);
      expect(response.body.congresses.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Error Handling', () => {
    test('should handle invalid endpoints gracefully', async () => {
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);
    }, 10000);

    test('should handle API errors gracefully', async () => {
      const response = await request(app)
        .get('/api/bill/999/hr/999999')
        .expect(400);
      
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error.message).toContain('Invalid path parameters');
    }, 10000);
  });

  describe('Caching Strategy', () => {
    test('should cache different endpoints separately', async () => {
      // Make requests to different endpoints
      await request(app)
        .get('/api/bill/118/hr/1')
        .expect(200);
      
      await request(app)
        .get('/api/member/A000148')
        .expect(200);
      
      // Check cache stats
      const stats = await request(app)
        .get('/api/cache-stats')
        .expect(200);
      
      expect(stats.body.keys).toBeGreaterThan(0);
    }, 15000);

    test('should handle query parameters in caching', async () => {
      // Same endpoint with different parameters
      await request(app)
        .get('/api/bill')
        .query({ limit: 5 })
        .expect(200);
      
      await request(app)
        .get('/api/bill')
        .query({ limit: 10 })
        .expect(200);
      
      // Both should create separate cache entries
      const stats = await request(app)
        .get('/api/cache-stats')
        .expect(200);
      
      expect(stats.body.keys).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Response Headers', () => {
    test('should include proper response headers', async () => {
      const response = await request(app)
        .get('/api/bill/118/hr/1')
        .expect(200);
      
      expect(response.headers).toHaveProperty('x-data-source');
      expect(response.headers).toHaveProperty('content-type');
      expect(response.headers['content-type']).toContain('application/json');
    }, 10000);
  });

});