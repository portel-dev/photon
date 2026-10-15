#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
);
const releaseVersion = process.env.PHOTON_RELEASE_VERSION || packageJson.version;

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function fail(message) {
  console.error(`Release reference check failed: ${message}`);
  process.exit(1);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) fail(`${message} (got ${actual || '<empty>'}, expected ${expected})`);
}

function assertCanonicalRemote() {
  if (process.env.PHOTON_RELEASE_SKIP_REMOTE_URL === '1') return;
  const remote = git(['remote', 'get-url', 'origin']);
  if (!/(?:github\.com[/:])portel-dev\/photon(?:\.git)?$/.test(remote)) {
    fail(`origin must point to github.com/portel-dev/photon (got ${remote})`);
  }
}

function verifyPreflight() {
  assertEqual(
    git(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    'main',
    'release must run from main'
  );
  assertEqual(
    git(['rev-parse', '--abbrev-ref', '@{upstream}']),
    'origin/main',
    'main must track origin/main'
  );
  assertCanonicalRemote();

  git(['fetch', '--quiet', 'origin', 'main']);
  assertEqual(
    git(['rev-parse', 'HEAD']),
    git(['rev-parse', 'origin/main']),
    'HEAD must match origin/main'
  );
  console.log('Release preflight refs verified: main tracks origin/main at HEAD.');
}

function remoteTagCommit(tag) {
  const lines = git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
    .split('\n')
    .filter(Boolean);
  const peeled = lines.find((line) => line.endsWith(`\trefs/tags/${tag}^{}`));
  const direct = lines.find((line) => line.endsWith(`\trefs/tags/${tag}`));
  return (peeled || direct || '').split(/\s+/)[0] || '';
}

function verifyPostPush() {
  assertCanonicalRemote();
  const tag = `v${releaseVersion}`;
  const head = git(['rev-parse', 'HEAD']);
  const localTag = git(['rev-parse', `${tag}^{commit}`], { allowFailure: true });
  assertEqual(localTag, head, `${tag} must point to the release commit`);

  const remoteTag = remoteTagCommit(tag);
  assertEqual(remoteTag, head, `remote ${tag} must point to the release commit`);
  assertEqual(
    git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0],
    head,
    'remote main must point to the release commit'
  );
  console.log(`Release tag verified: ${tag} -> ${head}`);
}

if (mode === '--preflight') verifyPreflight();
else if (mode === '--post-push') verifyPostPush();
else fail('usage: verify-release-ref.mjs --preflight|--post-push');
