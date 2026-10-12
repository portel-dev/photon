import * as os from 'node:os';
import * as path from 'node:path';

export type MarketplaceSourceType = 'github' | 'git-ssh' | 'url' | 'local';

export interface ParsedMarketplaceSource {
  name: string;
  repo: string;
  url: string;
  sourceType: MarketplaceSourceType;
  source: string;
}

/** Pure parser for supported marketplace source syntaxes. */
export function parseMarketplaceSource(input: string): ParsedMarketplaceSource | null {
  const shorthandMatch = input.match(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+)$/);
  if (shorthandMatch) {
    const [, username, repo] = shorthandMatch;
    return {
      name: repo,
      repo: input,
      url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      sourceType: 'github',
      source: input,
    };
  }

  const httpsMatch = input.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/
  );
  if (httpsMatch) {
    const [, username, repo] = httpsMatch;
    return {
      name: repo,
      repo: `${username}/${repo}`,
      url: `https://raw.githubusercontent.com/${username}/${repo}/main`,
      sourceType: 'github',
      source: input,
    };
  }

  const sshMatch = input.match(/^git@github\.com:([a-zA-Z0-9-]+)\/([a-zA-Z0-9-_.]+?)(\.git)?$/);
  if (sshMatch) {
    const [, username, repo] = sshMatch;
    const repoName = repo.replace(/\.git$/, '');
    return {
      name: repoName,
      repo: `${username}/${repoName}`,
      url: `https://raw.githubusercontent.com/${username}/${repoName}/main`,
      sourceType: 'git-ssh',
      source: input,
    };
  }

  if (input.startsWith('http://') || input.startsWith('https://')) {
    const safeInput =
      input.startsWith('http://') && !process.env.PHOTON_ALLOW_HTTP_MARKETPLACE
        ? input.replace(/^http:\/\//, 'https://')
        : input;
    const url = new URL(safeInput);
    const pathParts = url.pathname.split('/');
    const fileName = pathParts[pathParts.length - 1];
    return {
      name: fileName.replace(/\.(json|ts)$/, '') || url.hostname,
      repo: '',
      url: safeInput.replace(/\/[^/]*$/, ''),
      sourceType: 'url',
      source: safeInput,
    };
  }

  const isLocalPath =
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('/') ||
    input.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(input);
  if (!isLocalPath) return null;

  const absolutePath = path.resolve(input.replace(/^~/, os.homedir()));
  return {
    name: path.basename(absolutePath),
    repo: '',
    url: `file://${absolutePath.replace(/\\/g, '/')}`,
    sourceType: 'local',
    source: input,
  };
}
