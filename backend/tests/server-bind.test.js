// backend/tests/server-bind.test.js

// server.js binds the port Apache proxies to. It called app.listen(port) with no host,
// which makes Node listen on 0.0.0.0 and publishes the backend on every interface even
// though the only consumer is Apache on this host. These tests pin the loopback default,
// the HOST escape hatch that restores the old bind, and the startup log line that makes
// the chosen address visible in the journal.

// server.js registers these at require time, so each reload adds another listener.
const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'];

const originalHost = process.env.HOST;

// Reload config/index.js against a given HOST, isolated from the module registry.
const loadConfig = (host) => {
  jest.resetModules();

  if (host === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = host;
  }

  return require('../config');
};

// Reload server.js with the app factory and logger stubbed out, so the bind is observed
// without opening a socket or touching the database.
const loadServer = (host) => {
  const listen = jest.fn(() => ({ close: jest.fn() }));
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  const listenerCounts = PROCESS_EVENTS.map((event) => process.listenerCount(event));

  loadConfig(host);
  jest.doMock('../shared/app-factory', () => ({ createApp: () => ({ listen }) }));
  jest.doMock('../logger', () => ({ logger, httpLogger: (req, res, next) => next() }));
  require('../server');

  // Drop only the handlers this reload added, leaving Jest's own handlers in place.
  PROCESS_EVENTS.forEach((event, index) => {
    process.listeners(event).slice(listenerCounts[index]).forEach((handler) => {
      process.removeListener(event, handler);
    });
  });

  return { listen, logger };
};

afterEach(() => {
  if (originalHost === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = originalHost;
  }
  jest.resetModules();
});

describe('Server bind address', () => {
  describe('config.server.host', () => {
    test('defaults to loopback when HOST is not set', () => {
      const config = loadConfig(undefined);

      expect(config.server.host).toBe('127.0.0.1');
    });

    test('is overridden by the HOST environment variable', () => {
      const config = loadConfig('10.0.0.5');

      expect(config.server.host).toBe('10.0.0.5');
    });

    test('HOST=0.0.0.0 restores binding on every interface', () => {
      const config = loadConfig('0.0.0.0');

      expect(config.server.host).toBe('0.0.0.0');
    });
  });

  describe('server.js bind', () => {
    test('listens on loopback by default', () => {
      const { listen } = loadServer(undefined);

      expect(listen).toHaveBeenCalledTimes(1);
      expect(listen).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', expect.any(Function));
    });

    test('listens on every interface when HOST=0.0.0.0', () => {
      const { listen } = loadServer('0.0.0.0');

      expect(listen).toHaveBeenCalledWith(expect.anything(), '0.0.0.0', expect.any(Function));
    });

    test('reports both host and port in the startup log', () => {
      const { listen, logger } = loadServer(undefined);

      // The startup line is emitted from the listen callback.
      listen.mock.calls[0][2]();

      const [message, meta] = logger.info.mock.calls[0];
      const config = require('../config');

      expect(message).toContain(`127.0.0.1:${config.server.port}`);
      expect(meta).toMatchObject({ host: '127.0.0.1', port: config.server.port });
    });
  });
});
