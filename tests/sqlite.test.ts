#!/usr/bin/env node
/**
 * Test suite for SQLite MCP
 *
 * Usage:
 *   npx tsx tests/sqlite.test.ts
 */

import { MCPTestClient, validators } from '../src/test-client.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function main() {
  console.log('🧪 Testing SQLite MCP\n');

  // Create temp database file
  const dbPath = path.join(os.tmpdir(), `photon-test-${Date.now()}.db`);
  console.log(`Using test database: ${dbPath}\n`);

  const client = new MCPTestClient();

  try {
    // Start the MCP server
    const photonPath = path.join(process.cwd(), 'dist', 'cli.js');
    const mcpPath = path.join(process.cwd(), 'examples', 'sqlite.photon.ts');

    await client.start('node', [photonPath, mcpPath], {
      S_Q_LITE_PATH: dbPath,
    });

    console.log('✅ MCP server started\n');

    // Initialize
    const initResponse = await client.initialize();
    console.log('✅ Initialized:', initResponse.result?.serverInfo?.name);

    // Run test cases
    const results = await client.runTests([
      {
        name: 'List tools should return all SQLite tools',
        method: 'tools/list',
        validate: validators.and(
          validators.hasResult,
          validators.custom((result) => {
            const tools = result?.tools || [];
            const expectedTools = [
              'open',
              'query',
              'queryOne',
              'execute',
              'transaction',
              'listTables',
              'schema',
              'close',
              'backup',
            ];

            for (const toolName of expectedTools) {
              if (!tools.find((t: any) => t.name === toolName)) {
                return `Missing tool: ${toolName}`;
              }
            }
            return true;
          })
        ),
      },
      {
        name: 'Create users table',
        method: 'tools/call',
        params: {
          name: 'execute',
          arguments: {
            sql: `CREATE TABLE users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT UNIQUE NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
          },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (!data.success) return `Create table failed: ${data.error}`;

          return true;
        }),
      },
      {
        name: 'Insert test users',
        method: 'tools/call',
        params: {
          name: 'execute',
          arguments: {
            sql: 'INSERT INTO users (name, email) VALUES (?, ?)',
            params: ['Alice', 'alice@example.com'],
          },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (!data.success) return `Insert failed: ${data.error}`;
          if (!data.lastInsertRowid) return 'Missing lastInsertRowid';

          return true;
        }),
      },
      {
        name: 'Query users table',
        method: 'tools/call',
        params: {
          name: 'query',
          arguments: {
            sql: 'SELECT * FROM users WHERE name = ?',
            params: ['Alice'],
          },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (!data.success) return `Query failed: ${data.error}`;
          if (!Array.isArray(data.rows)) return 'Rows should be an array';
          if (data.rows.length !== 1) return 'Should return exactly one row';
          if (data.rows[0].name !== 'Alice') return 'Wrong user data';
          if (data.rows[0].email !== 'alice@example.com') return 'Wrong email';

          return true;
        }),
      },
      {
        name: 'List tables should show users',
        method: 'tools/call',
        params: {
          name: 'listTables',
          arguments: {},
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (!data.success) return `List tables failed: ${data.error}`;
          if (!Array.isArray(data.tables)) return 'Tables should be an array';

          if (!data.tables.includes('users')) return 'Users table not found';

          return true;
        }),
      },
      {
        name: 'Get users table schema',
        method: 'tools/call',
        params: {
          name: 'schema',
          arguments: { table: 'users' },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          const data = JSON.parse(text);
          if (!data.success) return `Get schema failed: ${data.error}`;
          if (!Array.isArray(data.columns)) return 'Columns should be an array';

          // Check if columns array contains expected column names
          const columnNames = data.columns.map((c: any) => c.name);
          const expectedColumns = ['id', 'name', 'email', 'created_at'];
          for (const colName of expectedColumns) {
            if (!columnNames.includes(colName)) {
              return `Schema missing column: ${colName}`;
            }
          }

          return true;
        }),
      },
      {
        name: 'Execute invalid SQL should return error',
        method: 'tools/call',
        params: {
          name: 'execute',
          arguments: { sql: 'INVALID SQL SYNTAX' },
        },
        validate: validators.custom((result) => {
          const text = result?.content?.[0]?.text;
          if (!text) return 'Missing content text';

          // Try to parse as JSON first (success: false response)
          try {
            const data = JSON.parse(text);
            if (data.success) return 'Should fail for invalid SQL';
            if (!data.error) return 'Should include error message';
            return true;
          } catch {
            // Not JSON - check if it's a formatted error message
            if (text.includes('Tool Error') || text.includes('syntax error')) {
              return true;
            }
            return 'Expected error response';
          }
        }),
      },
    ]);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 Test Results:`);
    console.log(`   ✅ Passed: ${results.passed}`);
    console.log(`   ❌ Failed: ${results.failed}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach((error) => console.log(`   - ${error}`));
    }

    console.log('\n' + '='.repeat(50));

    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test suite error:', error);
    process.exit(1);
  } finally {
    await client.shutdown();

    // Cleanup test database
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log(`\n🧹 Cleaned up test database`);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

main();
