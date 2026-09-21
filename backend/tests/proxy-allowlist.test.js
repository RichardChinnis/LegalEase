// backend/tests/proxy-allowlist.test.js
const express = require('express');
const request = require('supertest');
const NodeCache = require('node-cache');
const { createAPIRoutes } = require('../routes/api');
const { errorHandler } = require('../utils/error-handler');

// The catch-all proxy at the bottom of routes/api.js forwards unmatched /api/* paths
// to Congress.gov with the API key attached. Internet scanners were walking paths like
// /api/.env and /api/v1/info, and every one of them burned quota on a key that cannot
// be rotated. These tests pin down the allowlist that keeps scanner traffic local.

// Build the API router with a stubbed Congress API client so we can assert on whether
// an upstream call would have been made.
const createTestApp = () => {
  const cache = new NodeCache({ stdTTL: 60, checkperiod: 0 });
  const congressAPIClient = {
    cache,
    get: jest.fn().mockResolvedValue({
      data: { bills: [] },
      headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '3600' },
      fromCache: false
    })
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createAPIRoutes(congressAPIClient, {}));
  app.use(errorHandler);

  // The middleware chain reads the proxy cache off the app, same as shared/app-factory.
  // Express already owns an `app.cache` for view caching, so it has to be replaced.
  app.cache = cache;
  app.congressAPIClient = congressAPIClient;

  return app;
};

describe('Congress API proxy allowlist', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('Scanner paths are rejected locally', () => {
    test('GET /api/.env returns 404 without calling the Congress API client', async () => {
      const response = await request(app)
        .get('/api/.env')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
      expect(response.body.error).toHaveProperty('statusCode', 404);
      expect(response.body.error.message).toContain('/.env');
    });

    // Paths taken verbatim from the production error log, where each one had become an
    // authenticated request to Congress.gov.
    const scannerPaths = [
      '/api/version',
      '/api/status',
      '/api/v1/info',
      '/api/v1/check-version',
      '/api/v2/about',
      '/api/v3/meta',
      '/api/v1.0/environment',
      '/api/server/version',
      '/api/vip/i18n/v2/translation/products/vRNIUI/versions/1',
    ];

    test.each(scannerPaths)('GET %s returns 404 without an upstream call', async (path) => {
      const response = await request(app)
        .get(path)
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
      expect(response.body.error).toHaveProperty('type', 'NotFoundError');
      expect(response.body.error).toHaveProperty('statusCode', 404);
    });

    test('a dotfile probe below an allowed resource is not forwarded', async () => {
      await request(app)
        .get('/api/summaries/.env')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });

    test('a traversal attempt below an allowed resource is not forwarded', async () => {
      await request(app)
        .get('/api/committee-meeting/118/..%2f..%2fadmin')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });

    // /bill probes never reach the dynamic proxy - the explicit bill routes claim them
    // first and reject them on parameter validation. Either way nothing goes upstream.
    test.each(['/api/bill/.env', '/api/bill/118/hr/..%2f..%2fadmin'])(
      'GET %s is rejected by the bill route without an upstream call',
      async (path) => {
        await request(app)
          .get(path)
          .expect(400);

        expect(app.congressAPIClient.get).not.toHaveBeenCalled();
      }
    );

    test('a path deeper than the resource exposes upstream is not forwarded', async () => {
      await request(app)
        .get('/api/bill/118/hr/1/text/versions/1')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });

    test('inherited object keys are not treated as allowed resources', async () => {
      await request(app)
        .get('/api/constructor')
        .expect(404);

      await request(app)
        .get('/api/toString')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });

    test('the bare /api root is not forwarded', async () => {
      await request(app)
        .get('/api/')
        .expect(404);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });
  });

  describe('Allowlisted Congress.gov resources still proxy', () => {
    test('GET /api/bill list endpoint reaches the Congress API client', async () => {
      const response = await request(app)
        .get('/api/bill')
        .query({ limit: 5 })
        .expect(200);

      expect(app.congressAPIClient.get).toHaveBeenCalledTimes(1);
      expect(app.congressAPIClient.get).toHaveBeenCalledWith('/bill', expect.objectContaining({ limit: '5' }));
      expect(response.headers['x-data-source']).toBe('api');
    });

    // The list endpoints the frontend and the integration suite depend on, each of which
    // falls through to the dynamic proxy rather than an explicit handler.
    const proxiedListEndpoints = ['/api/member', '/api/committee', '/api/congress', '/api/amendment'];

    test.each(proxiedListEndpoints)('GET %s is still forwarded upstream', async (path) => {
      await request(app)
        .get(path)
        .query({ limit: 5 })
        .expect(200);

      expect(app.congressAPIClient.get).toHaveBeenCalledWith(
        path.replace('/api', ''),
        expect.any(Object)
      );
    });

    test('a nested resource with no explicit handler is still forwarded', async () => {
      await request(app)
        .get('/api/committee-meeting/118/house')
        .expect(200);

      expect(app.congressAPIClient.get).toHaveBeenCalledWith('/committee-meeting/118/house', expect.any(Object));
    });

    test('an explicitly routed path is unaffected by the allowlist', async () => {
      await request(app)
        .get('/api/congress/current')
        .expect(200);

      expect(app.congressAPIClient.get).toHaveBeenCalledWith('/congress/current', expect.any(Object));
    });
  });

  describe('Locally handled routes are unaffected', () => {
    test('GET /api/cache-stats is served locally without an upstream call', async () => {
      await request(app)
        .get('/api/cache-stats')
        .expect(200);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });

    test('GET /api/quota-status is served locally without an upstream call', async () => {
      await request(app)
        .get('/api/quota-status')
        .expect(200);

      expect(app.congressAPIClient.get).not.toHaveBeenCalled();
    });
  });
});
