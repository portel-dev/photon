#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(
  /\/+$/,
  ''
);
const packagePath = encodeURIComponent(pkg.name).replace(/^%40/, '@');
const versionUrl = `${registry}/${packagePath}/${encodeURIComponent(pkg.version)}`;

function request(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': `${pkg.name}/${pkg.version} publish-version-check`,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error(`Timed out checking ${url}`));
    });
    req.end();
  });
}

try {
  const status = await request(versionUrl);

  if (status === 404) {
    console.log(`✓ ${pkg.name}@${pkg.version} is not published yet`);
    process.exit(0);
  }

  if (status >= 200 && status < 300) {
    console.error(`ERROR: ${pkg.name}@${pkg.version} is already published on npm.`);
    console.error('Bump the package version before publishing; npm will reject this version.');
    process.exit(1);
  }

  console.error(`ERROR: Could not verify publish version. Registry returned HTTP ${status}.`);
  console.error(`Checked: ${versionUrl}`);
  process.exit(1);
} catch (err) {
  console.error(`ERROR: Could not verify publish version: ${err.message || err}`);
  console.error(`Checked: ${versionUrl}`);
  process.exit(1);
}
