/**
 * Schema-driven cross-transport conformance suite
 *
 * Runs the conformance matrix (tests/conformance/matrix.ts) against fixture
 * photons. Unlike transport-parity.test.ts, the cases here are generated
 * from each photon's extracted schema: adding a method to a fixture
 * automatically adds its parity checks. Nothing to remember.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { runConformanceMatrix } from './matrix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const fixturesDir = path.join(__dirname, '..', 'fixtures');

const FIXTURES = [path.join(fixturesDir, 'promise-test.photon.ts')];

async function main() {
  console.log('🧪 Schema-driven conformance matrix\n');
  let totalChecks = 0;
  let totalFailures = 0;

  let port = 19878;
  for (const fixture of FIXTURES) {
    console.log(`── ${path.basename(fixture)} ──`);
    const report = await runConformanceMatrix(fixture, { cliPath, ssePort: port++ });
    console.log(
      `  ${report.methods} methods, ${report.invoked} invoked, ` +
        `${report.checks} checks, ${report.failures.length} failures\n`
    );
    totalChecks += report.checks;
    totalFailures += report.failures.length;
  }

  console.log(`${totalChecks - totalFailures} passed, ${totalFailures} failed`);
  if (totalFailures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ Conformance run failed:', err);
  process.exit(1);
});
