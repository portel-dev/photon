import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercise the CLI boundary, including the output-mode flag. Human Markdown
// rendering changes table syntax and must never hide a score drop or issue.
const root = await mkdtemp(path.join(tmpdir(), 'lookout-output-'));
const previousCli = process.env.PHOTON_CLI;

try {
  const cli = path.join(root, 'photon');
  await writeFile(
    cli,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes('--json')) {
  console.log('Score  │ 95 │ 60');
  process.exit(0);
}
if (args.includes('status')) {
  console.log(JSON.stringify({ visionBackend: { ready: true } }));
} else if (args.includes('review')) {
  console.log(JSON.stringify('Score: 60/100 (D)\\n🔴 **[CRITICAL]** Missing content — main panel\\n  The result is absent.\\n'));
} else if (args.includes('validate')) {
  console.log(JSON.stringify('❌ **Results visible**\\n  No result content.\\n\\n❓ **Actions usable**\\n  Interaction is required.\\n'));
} else if (args.includes('compare')) {
  console.log(JSON.stringify({ result: '| Score | 95 | 60 |\\n| Issues | 0 | 1 |\\n\\n## New Issues Introduced\\n\\n🔴 **[CRITICAL]** Missing content — main panel\\n  The result is absent.\\n' }));
} else {
  process.exit(1);
}
`
  );
  await chmod(cli, 0o700);
  process.env.PHOTON_CLI = cli;
  const { review, validate, compare } = await import('./beam/visual/lookout.js');

  const reviewed = await review('current.png');
  assert.equal(reviewed?.score, 60);
  assert.equal(reviewed?.criticalCount, 1);
  assert.equal(reviewed?.issues[0].category, 'Missing content');

  const validated = await validate('current.png', ['Results visible', 'Actions usable']);
  assert.equal(validated?.passed, 0);
  assert.equal(validated?.failed, 1);
  assert.equal(validated?.unclear, 1);

  const compared = await compare('baseline.png', 'current.png');
  assert.equal(compared?.beforeScore, 95);
  assert.equal(compared?.afterScore, 60);
  assert.equal(compared?.newIssues, 1);
  console.log('✅ Lookout CLI output preserves critical issues, verdicts, and score drops');
} finally {
  if (previousCli === undefined) delete process.env.PHOTON_CLI;
  else process.env.PHOTON_CLI = previousCli;
  await rm(root, { recursive: true, force: true });
}
