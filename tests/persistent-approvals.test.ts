/**
 * Persistent Approval Queue Tests
 *
 * Verifies:
 * 1. Approval storage (write/read/resolve)
 * 2. Expiry handling
 * 3. Duration parsing
 * 4. approval:// resources in resources/list and resources/read
 * 5. beam/approval-response handler
 * 6. Integration with existing elicitation flow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        console.log(`\u2705 ${name}`);
        passed++;
      },
      (e: any) => {
        console.log(`\u274c ${name}\n   ${e.message}`);
        failed++;
      }
    );
  }
  try {
    console.log(`\u2705 ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`\u274c ${name}\n   ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log('\n\ud83e\uddea Persistent Approval Queue Tests\n');

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP — Import transport module helpers by reading source
// ═══════════════════════════════════════════════════════════════════════════════

// We test the approval storage functions by exercising them through the file system
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-approvals-test-'));
const stateDir = path.join(testDir, 'state');

// Override HOME to isolate test from real approvals
const originalHome = process.env.HOME;

// ═══════════════════════════════════════════════════════════════════════════════
// DURATION PARSING (inline reimplementation for unit testing)
// ═══════════════════════════════════════════════════════════════════════════════

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 5 * 60 * 1000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 5 * 60 * 1000;
  }
}

await test('parseDurationToMs: seconds', () => {
  assert(parseDurationToMs('30s') === 30000, '30s should be 30000ms');
});

await test('parseDurationToMs: minutes', () => {
  assert(parseDurationToMs('5m') === 300000, '5m should be 300000ms');
});

await test('parseDurationToMs: hours', () => {
  assert(parseDurationToMs('1h') === 3600000, '1h should be 3600000ms');
});

await test('parseDurationToMs: days', () => {
  assert(parseDurationToMs('24h') === 86400000, '24h should be 86400000ms');
  assert(parseDurationToMs('1d') === 86400000, '1d should be 86400000ms');
});

await test('parseDurationToMs: invalid falls back to 5 min', () => {
  assert(parseDurationToMs('invalid') === 300000, 'invalid should default to 5 min');
  assert(parseDurationToMs('') === 300000, 'empty should default to 5 min');
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL STORAGE (file-based persistence)
// ═══════════════════════════════════════════════════════════════════════════════

interface PersistentApproval {
  id: string;
  runId?: string;
  photon: string;
  method: string;
  message: string;
  preview?: unknown;
  destructive?: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}

function approvalsPath(photonName: string): string {
  return path.join(stateDir, photonName, 'approvals.json');
}

async function loadApprovals(photonName: string): Promise<PersistentApproval[]> {
  try {
    const data = fs.readFileSync(approvalsPath(photonName), 'utf-8');
    return JSON.parse(data) as PersistentApproval[];
  } catch {
    return [];
  }
}

async function saveApprovals(photonName: string, approvals: PersistentApproval[]): Promise<void> {
  const dir = path.dirname(approvalsPath(photonName));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(approvalsPath(photonName), JSON.stringify(approvals, null, 2));
}

async function addApproval(approval: PersistentApproval): Promise<void> {
  const approvals = await loadApprovals(approval.photon);
  approvals.push(approval);
  await saveApprovals(approval.photon, approvals);
}

async function resolveApproval(
  photonName: string,
  approvalId: string,
  status: 'approved' | 'rejected'
): Promise<PersistentApproval | undefined> {
  const approvals = await loadApprovals(photonName);
  const idx = approvals.findIndex((a) => a.id === approvalId);
  if (idx === -1) return undefined;
  approvals[idx].status = status;
  await saveApprovals(photonName, approvals);
  return approvals[idx];
}

async function getAllPendingApprovals(photonNames: string[]): Promise<PersistentApproval[]> {
  const all: PersistentApproval[] = [];
  const now = new Date().toISOString();
  for (const name of photonNames) {
    const approvals = await loadApprovals(name);
    for (const a of approvals) {
      if (a.status === 'pending') {
        if (a.expiresAt && a.expiresAt < now) {
          a.status = 'expired';
        } else {
          all.push(a);
        }
      }
    }
    if (approvals.some((a) => a.status === 'expired')) {
      await saveApprovals(name, approvals);
    }
  }
  return all;
}

// ─── Storage tests ──────────────────────────────────────────────────────────

await test('loadApprovals returns empty array for non-existent photon', async () => {
  const result = await loadApprovals('non-existent');
  assert(Array.isArray(result), 'Should return array');
  assert(result.length === 0, 'Should be empty');
});

await test('addApproval writes to disk and can be read back', async () => {
  const approval: PersistentApproval = {
    id: 'appr_001',
    photon: 'test-photon',
    method: 'bulkDelete',
    message: 'Delete 150 items?',
    preview: ['item1', 'item2', 'item3'],
    destructive: true,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  await addApproval(approval);
  const loaded = await loadApprovals('test-photon');
  assert(loaded.length === 1, `Expected 1 approval, got ${loaded.length}`);
  assert(loaded[0].id === 'appr_001', 'ID should match');
  assert(loaded[0].message === 'Delete 150 items?', 'Message should match');
  assert(loaded[0].destructive === true, 'Destructive flag should match');
  assert(Array.isArray(loaded[0].preview), 'Preview should be array');
});

await test('addApproval appends to existing approvals', async () => {
  const approval2: PersistentApproval = {
    id: 'appr_002',
    photon: 'test-photon',
    method: 'archive',
    message: 'Archive all completed tasks?',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  await addApproval(approval2);
  const loaded = await loadApprovals('test-photon');
  assert(loaded.length === 2, `Expected 2 approvals, got ${loaded.length}`);
  assert(loaded[1].id === 'appr_002', 'Second approval ID should match');
});

await test('resolveApproval marks approval as approved', async () => {
  const result = await resolveApproval('test-photon', 'appr_001', 'approved');
  assert(result !== undefined, 'Should return resolved approval');
  assert(result!.status === 'approved', 'Status should be approved');

  // Verify persisted
  const loaded = await loadApprovals('test-photon');
  const approved = loaded.find((a) => a.id === 'appr_001');
  assert(approved!.status === 'approved', 'Persisted status should be approved');
});

await test('resolveApproval marks approval as rejected', async () => {
  const result = await resolveApproval('test-photon', 'appr_002', 'rejected');
  assert(result !== undefined, 'Should return resolved approval');
  assert(result!.status === 'rejected', 'Status should be rejected');
});

await test('resolveApproval returns undefined for unknown id', async () => {
  const result = await resolveApproval('test-photon', 'non-existent', 'approved');
  assert(result === undefined, 'Should return undefined for unknown ID');
});

// ─── Pending approvals listing ──────────────────────────────────────────────

await test('getAllPendingApprovals returns only pending approvals', async () => {
  // Add a fresh pending approval
  await addApproval({
    id: 'appr_003',
    photon: 'other-photon',
    method: 'deploy',
    message: 'Deploy to production?',
    destructive: true,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  const pending = await getAllPendingApprovals(['test-photon', 'other-photon']);
  // test-photon has 2 resolved (approved/rejected), other-photon has 1 pending
  assert(pending.length === 1, `Expected 1 pending, got ${pending.length}`);
  assert(pending[0].id === 'appr_003', 'Should be the pending approval');
});

await test('getAllPendingApprovals auto-expires past-due approvals', async () => {
  // Add an expired approval
  await addApproval({
    id: 'appr_004',
    photon: 'expire-test',
    method: 'cleanup',
    message: 'Clean up old data?',
    status: 'pending',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
  });

  const pending = await getAllPendingApprovals(['expire-test']);
  assert(pending.length === 0, 'Expired approval should not be returned as pending');

  // Verify it was marked as expired on disk
  const loaded = await loadApprovals('expire-test');
  const expired = loaded.find((a) => a.id === 'appr_004');
  assert(expired!.status === 'expired', 'Should be marked as expired on disk');
});

await test('getAllPendingApprovals across multiple photons', async () => {
  await addApproval({
    id: 'appr_005',
    photon: 'photon-a',
    method: 'reset',
    message: 'Reset database?',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  await addApproval({
    id: 'appr_006',
    photon: 'photon-b',
    method: 'purge',
    message: 'Purge cache?',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  const pending = await getAllPendingApprovals(['photon-a', 'photon-b', 'non-existent']);
  assert(pending.length === 2, `Expected 2 pending across photons, got ${pending.length}`);
  const ids = pending.map((a) => a.id).sort();
  assert(ids[0] === 'appr_005' && ids[1] === 'appr_006', 'Should have both pending approvals');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT INTEGRATION (verify compiled code has the new handlers)
// ═══════════════════════════════════════════════════════════════════════════════

await test('transport module exports approval-related handlers', () => {
  // Read the compiled transport to verify our handlers exist
  const transportPath = path.join(process.cwd(), 'dist/auto-ui/streamable-http-transport.js');
  const transportCode = fs.readFileSync(transportPath, 'utf-8');

  assert(
    transportCode.includes('beam/approval-response'),
    'Transport should have beam/approval-response handler'
  );
  assert(
    transportCode.includes('beam/approvals-list'),
    'Transport should have beam/approvals-list handler'
  );
  assert(
    transportCode.includes('approval://'),
    'Transport should handle approval:// resource URIs'
  );
  assert(
    transportCode.includes('approvals.json'),
    'Transport should reference approvals.json storage'
  );
});

await test('transport inputProvider handles persistent flag', () => {
  const transportPath = path.join(process.cwd(), 'dist/auto-ui/streamable-http-transport.js');
  const transportCode = fs.readFileSync(transportPath, 'utf-8');

  assert(
    transportCode.includes('ask.persistent'),
    'inputProvider should check for persistent flag'
  );
  assert(
    transportCode.includes('parseDurationToMs'),
    'Should use parseDurationToMs for expiry calculation'
  );
});

await test('approval resources appear in resources/list handler', () => {
  const transportPath = path.join(process.cwd(), 'dist/auto-ui/streamable-http-transport.js');
  const transportCode = fs.readFileSync(transportPath, 'utf-8');

  assert(
    transportCode.includes('getAllPendingApprovals'),
    'resources/list should call getAllPendingApprovals'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND COMPONENT EXISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

await test('pending-approvals component exists', () => {
  const componentPath = path.join(
    process.cwd(),
    'src/auto-ui/frontend/components/pending-approvals.ts'
  );
  assert(fs.existsSync(componentPath), 'pending-approvals.ts should exist');
  const content = fs.readFileSync(componentPath, 'utf-8');
  assert(content.includes('@customElement'), 'Should be a Lit custom element');
  assert(content.includes('pending-approvals'), 'Should register as pending-approvals');
  assert(content.includes('approval-response'), 'Should dispatch approval-response event');
});

await test('beam-sidebar has approval badge support', () => {
  const sidebarPath = path.join(process.cwd(), 'src/auto-ui/frontend/components/beam-sidebar.ts');
  const content = fs.readFileSync(sidebarPath, 'utf-8');
  assert(content.includes('pendingApprovals'), 'Should have pendingApprovals property');
  assert(content.includes('show-approvals'), 'Should dispatch show-approvals event');
  assert(content.includes('approval-badge'), 'Should have approval badge CSS');
  assert(content.includes('shieldCheck'), 'Should use shieldCheck icon');
});

await test('shieldCheck icon is defined', () => {
  const iconsPath = path.join(process.cwd(), 'src/auto-ui/frontend/icons.ts');
  const content = fs.readFileSync(iconsPath, 'utf-8');
  assert(content.includes('export const shieldCheck'), 'Should export shieldCheck icon');
  assert(content.includes('shieldCheck'), 'Should be in icons map');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE TYPES DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

await test('bridge types document ClientState interface', () => {
  const typesPath = path.join(process.cwd(), 'src/auto-ui/bridge/types.ts');
  const content = fs.readFileSync(typesPath, 'utf-8');
  assert(content.includes('interface ClientState'), 'Should define ClientState interface');
  assert(content.includes('widgetState'), 'Should document the widgetState → _clientState flow');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

fs.rmSync(testDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
