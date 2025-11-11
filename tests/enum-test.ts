import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testEnumSchema() {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
  const testFilePath = '/tmp/test-enum.photon.ts';
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, 'run', testFilePath],
  });

  const client = new Client({
    name: 'enum-test-client',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport);
    console.log('Connected to server\n');

    const response = await client.listTools();
    console.log('=== Tool Schema ===');
    console.log(JSON.stringify(response.tools, null, 2));

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    await client.close();
  }
}

testEnumSchema().catch(console.error);
