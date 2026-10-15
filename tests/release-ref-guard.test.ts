import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const GUARD = path.join(ROOT, 'scripts', 'verify-release-ref.mjs');

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}

async function setupRepo(): Promise<{ cwd: string; remote: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-release-ref-'));
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-release-remote-'));
  await exec('git', ['init', '--bare', remote]);
  await exec('git', ['init', '-b', 'main', cwd]);
  await git(cwd, 'config', 'user.email', 'test@example.com');
  await git(cwd, 'config', 'user.name', 'Release Guard Test');
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"test","version":"9.9.9"}\n');
  await git(cwd, 'add', 'package.json');
  await git(cwd, 'commit', '-m', 'initial');
  await git(cwd, 'remote', 'add', 'origin', remote);
  await git(cwd, 'push', '-u', 'origin', 'main');
  return { cwd, remote };
}

async function runGuard(cwd: string, mode: string): Promise<{ code: number; output: string }> {
  try {
    const result = await exec('node', [GUARD, mode], {
      cwd,
      env: {
        ...process.env,
        PHOTON_RELEASE_SKIP_REMOTE_URL: '1',
        PHOTON_RELEASE_VERSION: '9.9.9',
      },
    });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error: any) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

async function main() {
  let cwd = '';
  let remote = '';
  try {
    ({ cwd, remote } = await setupRepo());

    const passing = await runGuard(cwd, '--preflight');
    assert.equal(passing.code, 0, passing.output);

    await git(cwd, 'switch', '-c', 'architecture-hardening');
    const wrongBranch = await runGuard(cwd, '--preflight');
    assert.notEqual(wrongBranch.code, 0);
    assert.match(wrongBranch.output, /main/);

    await git(cwd, 'switch', 'main');
    await git(cwd, 'tag', '--annotate', '--message', 'Release 9.9.9', 'v9.9.9');
    await git(cwd, 'push', 'origin', 'refs/tags/v9.9.9');
    const passingTag = await runGuard(cwd, '--post-push');
    assert.equal(passingTag.code, 0, passingTag.output);

    const oldCommit = await git(cwd, 'rev-parse', 'HEAD');
    await fs.writeFile(path.join(cwd, 'wrong.txt'), 'wrong\n');
    await git(cwd, 'add', 'wrong.txt');
    await git(cwd, 'commit', '-m', 'wrong target');
    await git(cwd, 'tag', '--force', '--annotate', '--message', 'Release 9.9.9', 'v9.9.9');
    await git(cwd, 'push', '--force', 'origin', 'refs/tags/v9.9.9');
    const mismatch = await runGuard(cwd, '--post-push');
    assert.notEqual(mismatch.code, 0);
    assert.match(mismatch.output, /tag|commit|target/i);
    assert.notEqual(oldCommit, await git(cwd, 'rev-parse', 'HEAD'));
  } finally {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    if (remote) await fs.rm(remote, { recursive: true, force: true });
  }

  console.log('Release reference guard tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
