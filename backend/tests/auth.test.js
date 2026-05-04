// backend/tests/auth.test.js
const request = require('supertest');
const { createApp } = require('../shared/app-factory');

// Create a fresh app instance for testing
const app = createApp();

// Hold a reference to the server
let server;

beforeAll(() => {
  server = app.listen(0); // Listen on a random, available port
});

afterAll(async () => {
  await server.close();
  // Ensure the database pool is closed via the app's DatabaseService instance
  await app.database.close();
});

// Clean up the users table before each test to ensure isolation
beforeEach(async () => {
  await app.database.query('DELETE FROM users');
});

describe('Auth Endpoints', () => {
  // --- Registration Tests ---
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
        });
      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('test@example.com');
    });

    it('should return 409 if email already exists', async () => {
      // First, create the user
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
        });

      // Then, try to create it again
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
        });
      expect(res.statusCode).toEqual(409);
      expect(res.body.error).toBe('Registration could not be completed.');
    });

    it('should return 400 if email or password is not provided', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toBe('Email and password are required.');
    });
  });

  // --- Login Tests ---
  describe('POST /api/auth/login', () => {
    // Pre-register a user before running login tests
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'loginuser@example.com',
          password: 'Password123',
        });
    });

    it('should log in a registered user successfully and return a token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'loginuser@example.com',
          password: 'Password123',
        });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.message).toBe('Login successful.');
    });

    it('should return 401 for an incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'loginuser@example.com',
          password: 'wrongpassword',
        });
      expect(res.statusCode).toEqual(401);
      expect(res.body.error).toBe('Invalid credentials.');
    });

    it('should return 401 for a non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nouser@example.com',
          password: 'Password123',
        });
      expect(res.statusCode).toEqual(401);
      expect(res.body.error).toBe('Invalid credentials.');
    });
  });
});
