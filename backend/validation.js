const { logger } = require('./logger');
const { createValidationError, asyncHandler } = require('./utils/error-handler');

// DEPRECATED: This file contains legacy imperative validation code.
// New validation uses schema-based approach in /schemas/validation-schemas.js
// and /middleware/schema-validation.js. This file is kept only for 
// backward compatibility with test routes.

// Input validation and sanitization middleware
const validateInput = asyncHandler(async (req, res, next) => {
  try {
    // Sanitize path parameters
    if (req.params) {
      Object.keys(req.params).forEach(key => {
        req.params[key] = sanitizeInput(req.params[key]);
      });
    }

    // Sanitize query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        req.query[key] = sanitizeInput(req.query[key]);
      });
    }

    // Validate specific parameters
    const validationErrors = [];

    // Validate congress number if present
    if (req.params.congress || req.query.congress) {
      const congress = req.params.congress || req.query.congress;
      if (!isValidCongressNumber(congress)) {
        validationErrors.push(`Invalid congress number: ${congress}`);
      }
    }

    // Validate limit parameter
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (isNaN(limit) || limit < 1 || limit > 250) {
        validationErrors.push('Limit must be a number between 1 and 250');
      }
    }

    // Validate offset parameter
    if (req.query.offset) {
      const offset = parseInt(req.query.offset);
      if (isNaN(offset) || offset < 0) {
        validationErrors.push('Offset must be a non-negative number');
      }
    }

    // Validate bill type if present
    if (req.params.type) {
      if (!isValidBillType(req.params.type)) {
        validationErrors.push(`Invalid bill type: ${req.params.type}`);
      }
    }

    // Validate chamber if present
    if (req.params.chamber) {
      if (!isValidChamber(req.params.chamber)) {
        validationErrors.push(`Invalid chamber: ${req.params.chamber}`);
      }
    }

    // Validate bill number if present
    if (req.params.number) {
      if (!isValidBillNumber(req.params.number)) {
        validationErrors.push(`Invalid bill number: ${req.params.number}`);
      }
    }

    if (validationErrors.length > 0) {
      throw createValidationError('Invalid input parameters', validationErrors);
    }

    next();
  } catch (error) {
    // If it's already our custom error, re-throw it
    if (error.name === 'ValidationError') {
      throw error;
    }
    
    // For unexpected errors, log and create a generic error
    logger.error('Validation middleware error', {
      error: error.message,
      path: req.path,
      method: req.method,
      stack: error.stack
    });
    
    throw new Error('Internal validation error');
  }
});

// Sanitize input to prevent injection attacks
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  // Remove potentially dangerous characters
  return input
    .replace(/[<>"'%;&()+=]/g, '') // Remove HTML/script injection chars
    .replace(/\.\./g, '') // Remove path traversal attempts
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '') // Remove control characters
    .trim();
}

// Validate congress number (1-999)
function isValidCongressNumber(congress) {
  const num = parseInt(congress);
  return !isNaN(num) && num >= 1 && num <= 999;
}

// Validate bill types
function isValidBillType(type) {
  const validTypes = [
    'hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres',
  ];
  return validTypes.includes(type.toLowerCase());
}

// Validate chamber names
function isValidChamber(chamber) {
  const validChambers = ['house', 'senate'];
  return validChambers.includes(chamber.toLowerCase());
}

// Validate bill numbers (positive integers)
function isValidBillNumber(number) {
  const num = parseInt(number);
  return !isNaN(num) && num > 0 && num <= 99999;
}

// Validate bioguide IDs (letter followed by 6 digits)
function isValidBioguideId(id) {
  return /^[A-Z]\d{6}$/.test(id);
}

// Additional validation for specific endpoints
const validateBioguideId = asyncHandler(async (req, res, next) => {
  if (req.params.bioguideId && !isValidBioguideId(req.params.bioguideId)) {
    logger.warn('Invalid bioguide ID', {
      bioguideId: req.params.bioguideId,
      path: req.path,
      ip: req.ip,
    });
    
    throw createValidationError(
      'Invalid bioguide ID format. Should be letter followed by 6 digits (e.g., A000148)'
    );
  }
  next();
});

module.exports = {
  validateInput,
  validateBioguideId,
  sanitizeInput,
  isValidCongressNumber,
  isValidBillType,
  isValidChamber,
  isValidBillNumber,
  isValidBioguideId,
};