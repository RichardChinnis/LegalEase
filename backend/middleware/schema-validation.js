const { logger } = require('../logger');
const { BadRequestError } = require('../utils/errors');
const { asyncHandler } = require('../utils/error-handler');
const { getSchemaForRoute } = require('../schemas/validation-schemas');

// Schema-based validation middleware
const validateSchema = (route) => {
  return asyncHandler(async (req, res, next) => {
    const schema = getSchemaForRoute(route);

    // Validate path parameters
    if (schema.params) {
      const { error: paramsError, value: validatedParams } = schema.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: true
      });
      
      if (paramsError) {
        const validationErrors = paramsError.details.map(detail => detail.message);
        logger.warn('Path parameter validation failed', {
          route,
          params: req.params,
          errors: validationErrors,
          path: req.path,
          method: req.method,
          ip: req.ip
        });
        
        throw new BadRequestError(`Invalid path parameters: ${validationErrors.join(', ')}`);
      }
      
      // Replace params with validated/sanitized values
      req.params = validatedParams;
    }
    
    // Validate query parameters
    if (schema.query) {
      const { error: queryError, value: validatedQuery } = schema.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true // Allow unknown parameters for Congress API compatibility
      });
      
      if (queryError) {
        const validationErrors = queryError.details.map(detail => detail.message);
        logger.warn('Query parameter validation failed', {
          route,
          query: req.query,
          errors: validationErrors,
          path: req.path,
          method: req.method,
          ip: req.ip
        });
        
        throw new BadRequestError(`Invalid query parameters: ${validationErrors.join(', ')}`);
      }
      
      // Replace query with validated/sanitized values
      req.query = validatedQuery;
    }
    
    logger.debug('Schema validation passed', {
      route,
      path: req.path,
      method: req.method
    });
    
    next();
  });
};

// Dynamic schema validation middleware that auto-detects route
const validateDynamicSchema = asyncHandler(async (req, res, next) => {
  // Extract the route pattern from the request path
  const route = req.path;
  
  // Get schema for this route
  const schema = getSchemaForRoute(route);
  
  // Validate using the schema
  await validateSchema(route)(req, res, next);
});

// Validation middleware factory for specific routes
const createValidationMiddleware = (route) => {
  return validateSchema(route);
};

// Helper function to validate bioguide ID specifically
const validateBioguideId = asyncHandler(async (req, res, next) => {
  if (req.params.bioguideId) {
    // Use the schema validation for bioguide ID
    const bioguideSchema = require('../schemas/validation-schemas').pathSchemas.bioguideId;
    
    const { error } = bioguideSchema.validate(req.params.bioguideId);
    
    if (error) {
      logger.warn('Invalid bioguide ID', {
        bioguideId: req.params.bioguideId,
        path: req.path,
        ip: req.ip,
      });
      
      throw new BadRequestError(
        'Invalid bioguide ID format. Should be letter followed by 6 digits (e.g., A000148)'
      );
    }
  }
  next();
});

module.exports = {
  validateSchema,
  validateDynamicSchema,
  createValidationMiddleware,
  validateBioguideId
};