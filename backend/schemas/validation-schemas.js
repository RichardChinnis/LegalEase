const Joi = require('joi');

// US State codes (postal abbreviations)
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI'
];

// Valid bill types
const BILL_TYPES = ['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres'];

// Valid chambers
const CHAMBERS = ['house', 'senate'];

// Common query parameters schema
const commonQuerySchema = Joi.object({
  // Pagination
  limit: Joi.number().integer().min(1).default(20),
  offset: Joi.number().integer().min(0).default(0),
  
  // Formatting
  format: Joi.string().valid('json', 'xml').default('json'),
  
  // Sorting - matches Congress.gov API format: field or "field asc" or "field desc"
  sort: Joi.string().pattern(/^(date|title|number|updateDate|lastActionDate)(\s+(asc|desc))?$/).optional(),
  
  // Date filtering
  fromDateTime: Joi.date().iso().optional(),
  toDateTime: Joi.date().iso().optional(),
  
  // General filters
  currentMember: Joi.boolean().optional(),
  
  // Allow unknown parameters for Congress API compatibility
}).unknown(true);

// Path parameter schemas
const pathSchemas = {
  // Congress number validation (current congress is 119, allow up to 125 for future compatibility)
  // Also allow "current" as a special value
  congress: Joi.alternatives().try(
    Joi.number().integer().min(1).max(125),
    Joi.string().valid('current')
  ).required(),
  
  // Bill type validation
  billType: Joi.string().valid(...BILL_TYPES).required(),
  
  // Bill number validation
  billNumber: Joi.number().integer().min(1).max(99999).required(),
  
  // Bioguide ID validation
  bioguideId: Joi.string().pattern(/^[A-Z]\d{6}$/).required(),
  
  // Chamber validation
  chamber: Joi.string().valid(...CHAMBERS).required(),
  
  // State code validation
  state: Joi.string().valid(...US_STATE_CODES).optional(),
  
  // District number validation
  district: Joi.number().integer().min(0).max(99).optional(),

  // Report Type validation
  reportType: Joi.string().valid('hrpt', 'srpt', 'erpt').required(),

  // Report Number validation
  reportNumber: Joi.number().integer().min(1).required(),
};

// Endpoint-specific schemas
const endpointSchemas = {
  // Bill endpoints
  '/bill/:congress/:type/:number': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  // Bill sub-endpoints (actions, summaries, committees, cosponsors, subjects, titles, text, amendments, relatedbills)
  '/bill/:congress/:type/:number/actions': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/summaries': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/committees': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/cosponsors': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/subjects': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/titles': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/text': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/amendments': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },

  '/bill/:congress/:type/:number/relatedbills': {
    params: Joi.object({
      congress: pathSchemas.congress,
      type: pathSchemas.billType,
      number: pathSchemas.billNumber
    }),
    query: commonQuerySchema
  },
  
  '/bill/:congress': {
    params: Joi.object({
      congress: pathSchemas.congress
    }),
    query: commonQuerySchema
  },
  
  '/bill': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional(),
      type: Joi.string().valid(...BILL_TYPES).optional()
    })
  },
  
  // Member endpoints
  '/member/:bioguideId': {
    params: Joi.object({
      bioguideId: pathSchemas.bioguideId
    }),
    query: commonQuerySchema
  },
  
  '/member': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      state: pathSchemas.state,
      district: pathSchemas.district,
      currentMember: Joi.boolean().optional()
    })
  },
  
  // Committee endpoints
  '/committee/:chamber': {
    params: Joi.object({
      chamber: pathSchemas.chamber
    }),
    query: commonQuerySchema
  },
  
  '/committee': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      chamber: pathSchemas.chamber.optional()
    })
  },

  // Committee Report endpoints
  '/committee-report': {
    params: Joi.object(),
    query: commonQuerySchema
  },

  '/committee-report/:congress': {
    params: Joi.object({
      congress: pathSchemas.congress
    }),
    query: commonQuerySchema
  },

  '/committee-report/:congress/:reportType': {
    params: Joi.object({
      congress: pathSchemas.congress,
      reportType: pathSchemas.reportType
    }),
    query: commonQuerySchema
  },

  '/committee-report/:congress/:reportType/:reportNumber': {
    params: Joi.object({
      congress: pathSchemas.congress,
      reportType: pathSchemas.reportType,
      reportNumber: pathSchemas.reportNumber
    }),
    query: commonQuerySchema
  },

  '/committee-report/:congress/:reportType/:reportNumber/text': {
    params: Joi.object({
      congress: pathSchemas.congress,
      reportType: pathSchemas.reportType,
      reportNumber: pathSchemas.reportNumber
    }),
    query: commonQuerySchema
  },
  
  // Congress endpoints
  '/congress/:congress': {
    params: Joi.object({
      congress: pathSchemas.congress
    }),
    query: commonQuerySchema
  },
  
  '/congress': {
    params: Joi.object(),
    query: commonQuerySchema
  },
  
  // Amendment endpoints
  '/amendment': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional(),
      type: Joi.string().valid('samdt', 'hamdt').optional()
    })
  },
  
  // Nomination endpoints
  '/nomination': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional()
    })
  },
  
  // Treaty endpoints
  '/treaty': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional()
    })
  },
  
  // Congressional Record endpoints
  '/congressional-record': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      year: Joi.number().integer().min(1995).max(new Date().getFullYear()).optional(),
      month: Joi.number().integer().min(1).max(12).optional(),
      day: Joi.number().integer().min(1).max(31).optional()
    })
  },
  
  // Daily Congressional Record endpoints
  '/daily-congressional-record': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      year: Joi.number().integer().min(1995).max(new Date().getFullYear()).optional(),
      month: Joi.number().integer().min(1).max(12).optional(),
      day: Joi.number().integer().min(1).max(31).optional()
    })
  },
  
  // Bound Congressional Record endpoints
  '/bound-congressional-record': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      year: Joi.number().integer().min(1995).max(new Date().getFullYear()).optional()
    })
  },
  
  // House Communication endpoints
  '/house-communication': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional(),
      type: Joi.string().valid('ec', 'ml', 'pm').optional()
    })
  },
  
  // Senate Communication endpoints
  '/senate-communication': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional(),
      type: Joi.string().valid('ec', 'pm').optional()
    })
  },
  
  // House Requirements endpoints
  '/house-requirement': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional()
    })
  },
  
  // Senate Requirements endpoints
  '/senate-requirement': {
    params: Joi.object(),
    query: commonQuerySchema.keys({
      congress: Joi.number().integer().min(1).max(125).optional()
    })
  },

  // Search endpoints
  '/bills/search': {
    params: Joi.object(),
    query: Joi.object({
      // Main search query - required
      q: Joi.string()
        .min(2)
        .max(500)
        .pattern(/^[^<>]*$/) // Prevent angle brackets for basic XSS protection
        .required(),

      // Pagination parameters
      limit: Joi.number().integer().min(1).default(20),
      offset: Joi.number().integer().min(0).max(10000).default(0),

      // Content type filtering
      contentTypes: Joi.alternatives().try(
        Joi.string().valid('bills', 'hearings', 'laws', 'actions'),
        Joi.string().pattern(/^(bills|hearings|laws|actions)(,(bills|hearings|laws|actions))*$/),
        Joi.array().items(Joi.string().valid('bills', 'hearings', 'laws', 'actions')).min(1).max(4)
      ).optional(),

      // Congress filtering
      congress: Joi.number().integer().min(1).max(125).optional(),

      // Sponsor filtering
      sponsor: Joi.string().max(100).pattern(/^[a-zA-Z\s\-'.,]+$/).optional(),

      // Status filtering
      status: Joi.string().valid('introduced', 'passed', 'enacted', 'vetoed').optional(),

      // Sorting
      sortBy: Joi.string().valid('relevance', 'date', 'title', 'congress').default('relevance').optional(),

      // Format (for future compatibility)
      format: Joi.string().valid('json', 'xml').default('json').optional()
    })
  }
};

// Helper function to get schema for a route
function getSchemaForRoute(route) {
  // Strip /api prefix if present to match schema patterns
  let normalizedRoute = route.startsWith('/api') ? route.substring(4) : route;
  
  // Handle database routes by mapping them to their corresponding regular routes
  // e.g., /db/committee-report -> /committee-report, /db/bill -> /bill
  if (normalizedRoute.startsWith('/db/')) {
    normalizedRoute = normalizedRoute.substring(3); // Remove '/db' to get '/committee-report', '/bill', etc.
  }
  
  // First try exact match
  if (endpointSchemas[normalizedRoute]) {
    return endpointSchemas[normalizedRoute];
  }
  
  // Then try pattern matching for parameterized routes
  for (const [pattern, schema] of Object.entries(endpointSchemas)) {
    if (pattern.includes(':')) {
      const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
      if (regex.test(normalizedRoute)) {
        return schema;
      }
    }
  }
  
  // Default schema for unknown routes
  return {
    params: Joi.object().unknown(true),
    query: commonQuerySchema
  };
}

module.exports = {
  endpointSchemas,
  pathSchemas,
  commonQuerySchema,
  getSchemaForRoute,
  US_STATE_CODES,
  BILL_TYPES,
  CHAMBERS
};