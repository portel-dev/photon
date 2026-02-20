/**
 * Verify all photons with new middleware tags parse correctly at schema level
 * (No instantiation needed — just verifies JSDoc → middleware declarations)
 */
import { SchemaExtractor } from '@portel/photon-core';
import { readFileSync } from 'fs';

const extractor = new SchemaExtractor();
let passed = 0;
let failed = 0;

const photons = [
  {
    path: '/Users/arul/Projects/photons/slack.photon.ts',
    expectMiddleware: ['post', 'channels', 'channel', 'history', 'react', 'upload', 'search'],
  },
  {
    path: '/Users/arul/Projects/photons/github-issues.photon.ts',
    expectMiddleware: ['list', 'get', 'create', 'update', 'comment', 'comments', 'search'],
  },
  {
    path: '/Users/arul/Projects/photons/email.photon.ts',
    expectMiddleware: ['send', 'attach', 'inbox', 'get', 'search', 'read', 'remove', 'move'],
  },
  {
    path: '/Users/arul/Projects/arul-photons/telegram.photon.ts',
    expectMiddleware: [
      'send',
      'sendPhoto',
      'sendDocument',
      'sendLocation',
      'sendPoll',
      'getMe',
      'getChat',
      'getUpdates',
      'deleteMessage',
      'pinMessage',
    ],
  },
  {
    path: '/Users/arul/Projects/arul-photons/discord.photon.ts',
    expectMiddleware: ['send', 'embed'],
  },
  {
    path: '/Users/arul/Projects/photons/google-calendar.photon.ts',
    expectMiddleware: [
      'list',
      'get',
      'create',
      'update',
      'remove',
      'calendars',
      'availability',
      'search',
      'upcoming',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/postgres.photon.ts',
    expectMiddleware: ['query', 'transaction', 'tables', 'describe', 'indexes', 'stats'],
  },
  {
    path: '/Users/arul/Projects/photons/docker.photon.ts',
    expectMiddleware: ['containers', 'start', 'stop', 'restart', 'logs', 'stats', 'images', 'pull'],
  },
  {
    path: '/Users/arul/Projects/photons/aws-s3.photon.ts',
    expectMiddleware: [
      'buckets',
      'bucket',
      'list',
      'upload',
      'download',
      'metadata',
      'copy',
      'delete',
      'purge',
      'presign',
    ],
  },
  // ── State-heavy photons ──
  {
    path: '/Users/arul/Projects/photons/kanban.photon.ts',
    expectMiddleware: [
      'add',
      'move',
      'reorder',
      'edit',
      'drop',
      'comment',
      'block',
      'column',
      'clear',
      'sweep',
      'scheduledArchiveOldTasks',
      'scheduledMorningPull',
      'scheduledAutoRelease',
      'scheduledStaleTaskCheck',
      'handleGithubIssue',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/git-box.photon.ts',
    expectMiddleware: [
      'repoAdd',
      'repoRemove',
      'projectsRootSet',
      'repos',
      'commits',
      'commitFiles',
      'status',
      'branches',
      'diff',
      'commitDiff',
      'pull',
      'push',
      'fetch',
      'branchMerge',
      'commitsSquash',
      'commitMessageAmend',
      'fileRemoveFromHistory',
      'cherryPick',
      'commitRevert',
      'commitFixup',
      'rebaseScripted',
      'blame',
      'commitsSearch',
      'changeFind',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/filesystem.photon.ts',
    expectMiddleware: [
      'read',
      'write',
      'append',
      'remove',
      'copy',
      'move',
      'list',
      'rmdir',
      'search',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/redis.photon.ts',
    expectMiddleware: [
      'get',
      'set',
      'del',
      'exists',
      'keys',
      'incr',
      'decr',
      'expire',
      'ttl',
      'lpush',
      'rpush',
      'lpop',
      'rpop',
      'llen',
      'hget',
      'hset',
      'hgetall',
      'flush',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/mongodb.photon.ts',
    expectMiddleware: [
      'find',
      'get',
      'insert',
      'bulk',
      'replace',
      'update',
      'remove',
      'delete',
      'aggregate',
      'count',
      'collections',
      'index',
      'distinct',
      'drop',
    ],
  },
  {
    path: '/Users/arul/Projects/photons/sqlite.photon.ts',
    expectMiddleware: ['query', 'one', 'execute', 'transaction', 'tables', 'schema', 'backup'],
  },
  {
    path: '/Users/arul/Projects/photons/data-sync.photon.ts',
    expectMiddleware: ['exportToJson', 'importFromJson', 'compare'],
  },
];

for (const { path, expectMiddleware } of photons) {
  const name = path.split('/').pop()!.replace('.photon.ts', '');
  try {
    const source = readFileSync(path, 'utf-8');
    const tools = extractor.extractFromSource(source);
    const toolsWithMiddleware = tools.filter((t: any) => t.middleware?.length > 0);
    const toolNames = toolsWithMiddleware.map((t: any) => t.name);

    const missing = expectMiddleware.filter((m) => !toolNames.includes(m));
    if (missing.length > 0) {
      console.log(`  ❌ ${name}: missing middleware on: ${missing.join(', ')}`);
      failed++;
    } else {
      const total = toolsWithMiddleware.reduce(
        (sum: number, t: any) => sum + t.middleware.length,
        0
      );
      console.log(
        `  ✅ ${name}: ${toolsWithMiddleware.length} methods, ${total} middleware declarations`
      );
      passed++;
    }
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
