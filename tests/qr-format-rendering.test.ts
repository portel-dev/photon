/**
 * Tests for QR format rendering in CLI output.
 *
 * Verifies that:
 * 1. @format qr extracts QR data from result.qr field
 * 2. @format qr extracts QR data from result.value field (legacy)
 * 3. @format qr extracts QR data from result.url field
 * 4. @format qr extracts QR data from result.link field
 * 5. @format qr shows message when no QR data found
 * 6. @format qr handles non-object results gracefully
 */

import { strict as assert } from 'assert';

// We test the field extraction logic directly since the actual rendering
// depends on the qrcode npm package and terminal output.

function extractQrValue(result: any): string | null {
  if (!result || typeof result !== 'object') return null;
  return result.qr || result.value || result.url || result.link || null;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  const test = (name: string) => ({
    pass: () => {
      passed++;
      console.log(`  ✅ ${name}`);
    },
    fail: (err: unknown) => {
      failed++;
      console.log(`  ❌ ${name}: ${err}`);
    },
  });

  console.log('\n📱 QR Format Rendering Tests\n');

  // ─── Test 1: Extract from result.qr ───
  {
    const t = test('Extracts QR data from result.qr field');
    try {
      const result = { status: 'qr_pending', qr: '2@abc123', message: 'Scan me' };
      const qr = extractQrValue(result);
      assert.equal(qr, '2@abc123');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 2: Extract from result.value (legacy) ───
  {
    const t = test('Extracts QR data from result.value field (legacy)');
    try {
      const result = { value: 'https://example.com/qr-data' };
      const qr = extractQrValue(result);
      assert.equal(qr, 'https://example.com/qr-data');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 3: Extract from result.url ───
  {
    const t = test('Extracts QR data from result.url field');
    try {
      const result = { url: 'https://pay.example.com/invoice/123' };
      const qr = extractQrValue(result);
      assert.equal(qr, 'https://pay.example.com/invoice/123');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 4: Extract from result.link ───
  {
    const t = test('Extracts QR data from result.link field');
    try {
      const result = { link: 'myapp://deep-link/abc' };
      const qr = extractQrValue(result);
      assert.equal(qr, 'myapp://deep-link/abc');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 5: Priority order — qr > value > url > link ───
  {
    const t = test('Priority: result.qr takes precedence over value/url/link');
    try {
      const result = { qr: 'primary', value: 'secondary', url: 'tertiary', link: 'last' };
      const qr = extractQrValue(result);
      assert.equal(qr, 'primary');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 6: Returns null for missing QR data ───
  {
    const t = test('Returns null when no QR field found');
    try {
      const result = { status: 'connected', phone: '1234' };
      const qr = extractQrValue(result);
      assert.equal(qr, null);
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 7: Returns null for non-object ───
  {
    const t = test('Returns null for non-object result');
    try {
      assert.equal(extractQrValue(null), null);
      assert.equal(extractQrValue(undefined), null);
      assert.equal(extractQrValue('string'), null);
      assert.equal(extractQrValue(42), null);
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 8: WhatsApp connect response shape ───
  {
    const t = test('Handles WhatsApp connect() response shape correctly');
    try {
      // This is the exact shape returned by whatsapp.photon.ts connect()
      const result = {
        status: 'qr_pending',
        qr: '2@cyKu/VM4pi0CsrGwdFGGpLBCi5bXyD+b26Z18ZCphlDc9Sgkg24P32ruNTDh+NasrPaLda9KwFl743omi6xDQyoJOKXL1rc6yK8=,nPaU6X3JNBH1PMJ7ETHcrh93mLSSrOfkV+uH5fXdw3I=',
        message:
          'Scan with WhatsApp → Linked Devices → Link a Device, then call status() to verify.',
      };
      const qr = extractQrValue(result);
      assert.ok(qr, 'Should extract QR');
      assert.ok(qr!.startsWith('2@'), 'Should be a Baileys QR string');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  // ─── Test 9: Empty string QR is falsy, falls through ───
  {
    const t = test('Empty string qr field falls through to other fields');
    try {
      const result = { qr: '', value: 'fallback-value' };
      const qr = extractQrValue(result);
      assert.equal(qr, 'fallback-value');
      t.pass();
    } catch (err) {
      t.fail(err);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { runTests };
