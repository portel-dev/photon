/**
 * Tests for @auth enforcement at the loader level (transport-agnostic)
 *
 * Verifies that @auth required works across ALL transports by testing
 * at the executeTool level, which is the shared code path.
 */

import { PhotonLoader } from '../dist/loader.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function runTests() {
  console.log('🧪 Running @auth enforcement tests...\n');

  const loader = new PhotonLoader();
  const testDir = path.join(os.tmpdir(), 'photon-auth-test');
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Create an @auth required photon
    const testFile = path.join(testDir, 'secure.photon.ts');
    await fs.writeFile(
      testFile,
      `
      /**
       * Secure photon requiring authentication
       * @auth required
       */
      export default class Secure {
        /**
         * Returns secret data
         * @readOnly
         */
        async secret(): Promise<string> {
          return 'top-secret-data';
        }
      }
    `,
      'utf-8'
    );

    // Create a no-auth photon for comparison
    const openFile = path.join(testDir, 'open.photon.ts');
    await fs.writeFile(
      openFile,
      `
      export default class Open {
        async hello(): Promise<string> {
          return 'hello-world';
        }
      }
    `,
      'utf-8'
    );

    const secureMcp = await loader.loadFile(testFile);
    const openMcp = await loader.loadFile(openFile);

    // Test 1: @auth photon rejects anonymous caller (no credentials provided)
    {
      try {
        await loader.executeTool(
          secureMcp,
          'secret',
          {},
          {
            inputProvider: async () => {
              // Simulate user cancelling the auth prompt
              return null;
            },
          }
        );
        assert.fail('Should have thrown for unauthenticated call');
      } catch (e: any) {
        assert.ok(
          e.message.includes('Authentication required'),
          `Error should mention auth requirement, got: ${e.message}`
        );
      }
      console.log('✅ @auth required rejects anonymous caller');
    }

    // Test 2: @auth photon accepts authenticated caller
    {
      const result = await loader.executeTool(
        secureMcp,
        'secret',
        {},
        {
          caller: { id: 'user-123', name: 'Test User', anonymous: false },
        }
      );
      assert.equal(result, 'top-secret-data');
      console.log('✅ @auth required accepts authenticated caller');
    }

    // Test 3: @auth photon accepts credentials via elicitation
    {
      const result = await loader.executeTool(
        secureMcp,
        'secret',
        {},
        {
          inputProvider: async () => {
            return 'my-secret-token-12345';
          },
        }
      );
      assert.equal(result, 'top-secret-data');
      console.log('✅ @auth required accepts credentials via elicitation');
    }

    // Test 4: Non-auth photon works without any credentials
    {
      const result = await loader.executeTool(openMcp, 'hello', {});
      assert.equal(result, 'hello-world');
      console.log('✅ No-auth photon works without credentials');
    }

    // Test 5: auth metadata is stored on loaded photon
    {
      assert.equal((secureMcp as any).auth, 'required', '@auth should be stored on photon');
      assert.equal((openMcp as any).auth, undefined, 'No-auth photon should not have auth field');
      console.log('✅ Auth metadata correctly stored on loaded photon');
    }

    console.log('\n✅ All @auth enforcement tests passed');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
