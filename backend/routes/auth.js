// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { logger } = require('../logger');

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: API for user authentication
 */
const router = express.Router();
const SALT_ROUNDS = 10;

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

// Email format validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password strength validation
function validatePasswordStrength(password) {
  const errors = [];
  if (password.length < 8) {
    errors.push('at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('at least one digit');
  }
  return errors;
}

// User Registration
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     description: Creates a new user account.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string },
 *               password: { type: string }
 *     responses:
 *       201:
 *         description: The created user.
 */
router.post('/register', authLimiter, async (req, res) => {
  const db = req.app.database;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  const passwordErrors = validatePasswordStrength(password);
  if (passwordErrors.length > 0) {
    return res.status(400).json({
      error: `Password must contain ${passwordErrors.join(', ')}.`,
    });
  }

  try {
    // Check if user already exists
    const existingUser = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Registration could not be completed.' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, passwordHash]
    );

    res.status(201).json(newUser.rows[0]);
  } catch (error) {
    logger.error('Registration error', { error: error.message, email });
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// User Login
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Authentication]
 *     description: Logs in a user and returns a JWT.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string },
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: The JWT and user information.
 */
router.post('/login', authLimiter, async (req, res) => {
  const db = req.app.database;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      logger.warn('Failed login attempt', {
        email,
        ip: req.ip,
        reason: 'invalid_credentials',
        timestamp: new Date().toISOString(),
      });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      logger.warn('Failed login attempt', {
        email,
        ip: req.ip,
        reason: 'invalid_credentials',
        timestamp: new Date().toISOString(),
      });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const payload = {
      userId: user.id,
      email: user.email,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({
      message: 'Login successful.',
      token: token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    logger.error('Login error', { error: error.message, email });
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

module.exports = router;
