# Schema-Based Validation Documentation

## Overview

The Congress API proxy uses **Joi schema-based validation** to ensure all incoming requests are properly validated before being forwarded to the external Congress API. This approach provides comprehensive validation for both path parameters and query parameters, preventing malformed requests and improving error messaging.

## Architecture

### Core Components

1. **Schema Definitions** (`/schemas/validation-schemas.js`)
   - Contains all validation schemas for Congress API endpoints
   - Defines path parameter patterns, query parameter constraints
   - Includes US state codes, valid bill types, chambers, etc.

2. **Validation Middleware** (`/middleware/schema-validation.js`)
   - Implements schema-based validation middleware
   - Provides both static and dynamic validation functions
   - Handles error formatting and logging

3. **Route Integration** (`/routes/api.js`)
   - Applies appropriate validation middleware to each endpoint
   - Uses createValidationMiddleware() for specific route patterns

## Validation Coverage

### Path Parameters

| Parameter | Validation Rule | Example |
|-----------|----------------|---------|
| `congress` | Integer, 1-118 | `118` |
| `type` | Valid bill types | `hr`, `s`, `hjres`, etc. |
| `number` | Integer, 1-99999 | `1234` |
| `bioguideId` | Letter + 6 digits | `A000148` |
| `chamber` | house, senate | `house` |

### Query Parameters

| Parameter | Validation Rule | Example |
|-----------|----------------|---------|
| `limit` | Integer, 1-250 | `20` |
| `offset` | Integer, ≥0 | `0` |
| `format` | json, xml | `json` |
| `sort` | Valid sort fields | `date`, `title` |
| `fromDateTime` | ISO 8601 date | `2023-01-01T00:00:00.000Z` |
| `toDateTime` | ISO 8601 date | `2023-12-31T23:59:59.999Z` |
| `currentMember` | Boolean | `true`, `false` |
| `state` | US state codes | `CA`, `NY`, `TX` |
| `district` | Integer, 0-99 | `5` |

### Endpoint-Specific Validation

#### Bills (`/api/bill`)
- **Path**: `/bill/:congress/:type/:number`
- **Query**: `limit`, `offset`, `format`, `sort`, `congress`, `type`, `fromDateTime`, `toDateTime`

#### Members (`/api/member`)
- **Path**: `/member/:bioguideId`
- **Query**: `limit`, `offset`, `state`, `district`, `currentMember`, `format`

#### Committees (`/api/committee`)
- **Path**: `/committee/:chamber`
- **Query**: `limit`, `offset`, `chamber`, `format`

#### Congressional Record (`/api/congressional-record`)
- **Query**: `year` (1995-current), `month` (1-12), `day` (1-31)

#### Communications
- **House**: `/api/house-communication` - types: `ec`, `ml`, `pm`
- **Senate**: `/api/senate-communication` - types: `ec`, `pm`

#### Amendments (`/api/amendment`)
- **Query**: `congress`, `type` (`samdt`, `hamdt`)

## Error Handling

### Validation Error Format

```json
{
  "error": "Invalid path parameters",
  "details": [
    "\"congress\" must be less than or equal to 118",
    "\"type\" must be one of [hr, s, hjres, sjres, hconres, sconres, hres, sres]"
  ]
}
```

### Error Types

- **Path Parameter Errors**: `"Invalid path parameters"`
- **Query Parameter Errors**: `"Invalid query parameters"`
- **Bioguide ID Errors**: `"Invalid bioguide ID format"`

## Usage Examples

### Valid Requests

```bash
# Valid bill request
GET /api/bill/118/hr/1?limit=10&format=json

# Valid member request with state filter
GET /api/member?state=CA&district=1&currentMember=true

# Valid date range query
GET /api/bill?fromDateTime=2023-01-01T00:00:00.000Z&toDateTime=2023-12-31T23:59:59.999Z
```

### Invalid Requests (will return 400)

```bash
# Invalid congress number
GET /api/bill/999/hr/1
# Error: "congress" must be less than or equal to 118

# Invalid bill type
GET /api/bill/118/invalid/1
# Error: "type" must be one of [hr, s, hjres, sjres, hconres, sconres, hres, sres]

# Invalid limit
GET /api/bill?limit=500
# Error: "limit" must be less than or equal to 250

# Invalid state code
GET /api/member?state=XX
# Error: "state" must be one of [AL, AK, AZ, ...]

# Invalid date format
GET /api/bill?fromDateTime=invalid-date
# Error: "fromDateTime" must be in ISO 8601 date format
```

## Implementation Details

### Route-Specific Validation

```javascript
// Specific route with validation
router.get('/bill/:congress/:type/:number', 
  createValidationMiddleware('/bill/:congress/:type/:number'), 
  createMiddlewareChain('standardAPI'), 
  createProxyHandler()
);
```

### Dynamic Validation

```javascript
// Dynamic validation for unknown routes
createValidationMiddleware(req.path)(req, res, (err) => {
  if (err) return next(err);
  // Continue with middleware chain
});
```

### Schema Pattern Matching

The validation system uses pattern matching to apply appropriate schemas:

1. **Exact Match**: Direct lookup in `endpointSchemas`
2. **Pattern Match**: Regex conversion of parameterized routes
3. **Default**: Fallback schema for unknown endpoints

## Configuration

### US State Codes
Includes all 50 states plus DC and territories:
- States: `AL`, `AK`, `AZ`, `AR`, `CA`, etc.
- Territories: `AS`, `GU`, `MP`, `PR`, `VI`
- Federal District: `DC`

### Valid Bill Types
- House: `hr`, `hjres`, `hconres`, `hres`
- Senate: `s`, `sjres`, `sconres`, `sres`

### Congress Number Range
- Current range: 1-118 (updates as new Congress sessions begin)
- Historical coverage back to 1st Congress

## Testing

The validation system includes comprehensive test coverage:

- **51 total tests** covering all validation scenarios
- **Path parameter validation**: Congress numbers, bill types, bioguide IDs
- **Query parameter validation**: Limits, offsets, dates, booleans
- **Multiple error handling**: Returns all validation errors at once
- **Edge cases**: Boundary values, invalid formats, unknown parameters

### Running Validation Tests

```bash
# Run all tests
npm test

# Run only validation tests
npm test -- --testNamePattern="Schema Validation"
```

## Migration from Legacy Validation

The system previously used imperative validation with individual validation functions. The new schema-based approach provides:

### Benefits
- **Comprehensive coverage**: 20+ validation rules vs. 5 previously
- **Better error messages**: Joi provides detailed, user-friendly errors
- **Maintainability**: Centralized schema definitions
- **Documentation**: Schemas serve as API documentation
- **Extensibility**: Easy to add new endpoints and validation rules

### Legacy Code
The old validation code in `/validation.js` is marked as deprecated and kept only for backward compatibility with test routes.

## Future Enhancements

### Potential Improvements
1. **Custom error messages**: Override default Joi messages for better UX
2. **Conditional validation**: Different rules based on request context
3. **Schema versioning**: Support multiple API versions
4. **Performance optimization**: Cache compiled schemas
5. **OpenAPI integration**: Generate OpenAPI specs from Joi schemas