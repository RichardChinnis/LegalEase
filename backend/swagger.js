const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Congress API Proxy',
      version: '1.0.0',
      description: 'A secure proxy server for the Congress.gov API with caching, rate limiting, and input validation',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Optional API authentication token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            details: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Detailed error information'
            }
          }
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'OK'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        CacheStats: {
          type: 'object',
          properties: {
            keys: {
              type: 'integer',
              description: 'Number of cached items'
            },
            hits: {
              type: 'integer',
              description: 'Cache hit count'
            },
            misses: {
              type: 'integer',
              description: 'Cache miss count'
            },
            ksize: {
              type: 'integer',
              description: 'Cache size in KB'
            },
            vsize: {
              type: 'integer',
              description: 'Cache value size in KB'
            }
          }
        },
        Bill: {
          type: 'object',
          properties: {
            bill: {
              type: 'object',
              properties: {
                congress: {
                  type: 'integer',
                  example: 119
                },
                type: {
                  type: 'string',
                  example: 'HR'
                },
                number: {
                  type: 'string',
                  example: '1'
                },
                title: {
                  type: 'string'
                },
                introducedDate: {
                  type: 'string',
                  format: 'date'
                },
                latestAction: {
                  type: 'object',
                  properties: {
                    actionDate: {
                      type: 'string',
                      format: 'date'
                    },
                    text: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          }
        },
        BillList: {
          type: 'object',
          properties: {
            bills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  congress: {
                    type: 'integer'
                  },
                  type: {
                    type: 'string'
                  },
                  number: {
                    type: 'string'
                  },
                  title: {
                    type: 'string'
                  },
                  url: {
                    type: 'string'
                  }
                }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                count: {
                  type: 'integer'
                },
                next: {
                  type: 'string'
                },
                previous: {
                  type: 'string'
                }
              }
            }
          }
        },
        Member: {
          type: 'object',
          properties: {
            member: {
              type: 'object',
              properties: {
                bioguideId: {
                  type: 'string',
                  example: 'A000148'
                },
                name: {
                  type: 'string'
                },
                firstName: {
                  type: 'string'
                },
                lastName: {
                  type: 'string'
                },
                party: {
                  type: 'string'
                },
                state: {
                  type: 'string'
                },
                district: {
                  type: 'string'
                }
              }
            }
          }
        },
        Committee: {
          type: 'object',
          properties: {
            committees: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string'
                  },
                  chamber: {
                    type: 'string'
                  },
                  systemCode: {
                    type: 'string'
                  },
                  url: {
                    type: 'string'
                  }
                }
              }
            }
          }
        },
        Congress: {
          type: 'object',
          properties: {
            congress: {
              type: 'object',
              properties: {
                number: {
                  type: 'integer',
                  example: 119
                },
                name: {
                  type: 'string'
                },
                startYear: {
                  type: 'string'
                },
                endYear: {
                  type: 'string'
                },
                sessions: {
                  type: 'array',
                  items: {
                    type: 'object'
                  }
                }
              }
            }
          }
        }
      },
      parameters: {
        CongressNumber: {
          name: 'congress',
          in: 'path',
          required: true,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 999
          },
          description: 'Congress number (e.g., 119 for 119th Congress)'
        },
        BillType: {
          name: 'type',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: ['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres']
          },
          description: 'Bill type (hr, s, hjres, sjres, hconres, sconres, hres, sres)'
        },
        BillNumber: {
          name: 'number',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[1-9][0-9]*$'
          },
          description: 'Bill number (positive integer)'
        },
        BioguideId: {
          name: 'bioguideId',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[A-Z][0-9]{6}$'
          },
          description: 'Bioguide ID (letter followed by 6 digits, e.g., A000148)'
        },
        Chamber: {
          name: 'chamber',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: ['house', 'senate']
          },
          description: 'Chamber (house or senate)'
        },
        Limit: {
          name: 'limit',
          in: 'query',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 250,
            default: 20
          },
          description: 'Number of results to return (1-250)'
        },
        Offset: {
          name: 'offset',
          in: 'query',
          schema: {
            type: 'integer',
            minimum: 0,
            default: 0
          },
          description: 'Number of results to skip'
        }
      },
      responses: {
        BadRequest: {
          description: 'Invalid input parameters',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        Unauthorized: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        Forbidden: {
          description: 'Invalid authentication token',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        TooManyRequests: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    }
  },
  apis: ['./server.js', './swagger-routes.js']
};

const specs = swaggerJSDoc(options);

module.exports = specs;