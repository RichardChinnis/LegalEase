#!/usr/bin/env node
/**
 * Congress API PostgreSQL MCP Server
 *
 * Provides read/write access to the congress_api database via MCP protocol.
 * Tools:
 *   - query: Execute any SQL query (SELECT, INSERT, UPDATE, DELETE, etc.)
 *   - list_tables: List all tables in the database
 *   - describe_table: Get column info for a table
 *   - list_functions: List stored functions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.PGPASSWORD) {
  console.error('FATAL: PGPASSWORD environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'congress_api',
  user: process.env.PGUSER || 'congress_admin',
  password: process.env.PGPASSWORD,
});

// Create MCP server
const server = new Server(
  {
    name: 'congress-postgres',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query',
        description: 'Execute a SQL query against the congress_api database. Supports SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'The SQL query to execute',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'list_tables',
        description: 'List all tables in the congress_api database with row counts',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'describe_table',
        description: 'Get detailed schema information for a table including columns, types, constraints, and indexes',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'Name of the table to describe',
            },
          },
          required: ['table_name'],
        },
      },
      {
        name: 'list_functions',
        description: 'List all user-defined functions in the database',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query': {
        const { sql } = args;
        const result = await pool.query(sql);

        // Format response based on query type
        if (result.command === 'SELECT') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  rowCount: result.rowCount,
                  rows: result.rows,
                  fields: result.fields?.map(f => ({ name: f.name, dataType: f.dataTypeID })),
                }, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  command: result.command,
                  rowCount: result.rowCount,
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'list_tables': {
        const result = await pool.query(`
          SELECT
            t.table_name,
            pg_stat_user_tables.n_live_tup as estimated_rows
          FROM information_schema.tables t
          LEFT JOIN pg_stat_user_tables ON t.table_name = pg_stat_user_tables.relname
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
          ORDER BY t.table_name
        `);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      }

      case 'describe_table': {
        const { table_name } = args;

        // Get columns
        const columnsResult = await pool.query(`
          SELECT
            c.column_name,
            c.data_type,
            c.character_maximum_length,
            c.is_nullable,
            c.column_default,
            c.udt_name
          FROM information_schema.columns c
          WHERE c.table_name = $1
            AND c.table_schema = 'public'
          ORDER BY c.ordinal_position
        `, [table_name]);

        // Get constraints
        const constraintsResult = await pool.query(`
          SELECT
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc
          LEFT JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_name = $1
            AND tc.table_schema = 'public'
        `, [table_name]);

        // Get indexes
        const indexesResult = await pool.query(`
          SELECT
            indexname,
            indexdef
          FROM pg_indexes
          WHERE tablename = $1
            AND schemaname = 'public'
        `, [table_name]);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                table: table_name,
                columns: columnsResult.rows,
                constraints: constraintsResult.rows,
                indexes: indexesResult.rows,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_functions': {
        const result = await pool.query(`
          SELECT
            p.proname as function_name,
            pg_get_function_arguments(p.oid) as arguments,
            pg_get_function_result(p.oid) as return_type,
            CASE p.prokind
              WHEN 'f' THEN 'function'
              WHEN 'p' THEN 'procedure'
              WHEN 'a' THEN 'aggregate'
              WHEN 'w' THEN 'window'
            END as kind
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public'
          ORDER BY p.proname
        `);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            detail: error.detail || null,
            hint: error.hint || null,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on exit
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Congress PostgreSQL MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
