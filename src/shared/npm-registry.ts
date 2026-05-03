/**
 * Direct npm registry client.
 *
 * Replaces shelling out to `npm view ...` for version checks. Avoids two
 * production failure modes seen on launchd-managed daemons (Bug 3 in
 * v1.27.0):
 *
 *   1. `npm` not on the launchd PATH — the spawn fails before any HTTP
 *      call happens, and the previous code reported it as
 *      "Could not reach npm registry". Misleading; the registry is fine.
 *   2. The npm CLI swallows useful diagnostics (auth-required messages,
 *      registry redirects, malformed manifests) into its own one-liner.
 *
 * The registry's `/{name}/latest` endpoint is unauthenticated, returns a
 * compact JSON manifest, and is what `npm view ... version` itself
 * resolves to. Hitting it directly removes the npm CLI dependency,
 * surfaces real status codes, and gives us a concrete error string
 * callers can show the user.
 */
import { request } from 'https';
import { PHOTON_VERSION } from '../version.js';

export interface NpmRegistryError extends Error {
  /** HTTP status code if the failure was at the response layer. */
  statusCode?: number;
  /** Network error code (ENOTFOUND, ETIMEDOUT, ECONNRESET, …). */
  code?: string;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 10_000;

function makeError(message: string, extras?: Partial<NpmRegistryError>): NpmRegistryError {
  const err = new Error(message) as NpmRegistryError;
  if (extras?.statusCode !== undefined) err.statusCode = extras.statusCode;
  if (extras?.code !== undefined) err.code = extras.code;
  return err;
}

/**
 * Fetch the `latest` dist-tag manifest for `pkg` from the public npm
 * registry. Returns the parsed JSON.
 *
 * Throws `NpmRegistryError` with a concrete `.message` describing the
 * actual failure (HTTP status, network error code, parse failure). The
 * caller should surface that string instead of replacing it with a
 * generic "registry unreachable" — that wording was the original bug.
 */
export async function fetchLatestManifest(
  pkg: string,
  opts: { registry?: string; timeoutMs?: number } = {}
): Promise<{ version: string; [key: string]: unknown }> {
  const registry = (opts.registry || process.env.npm_config_registry || DEFAULT_REGISTRY).replace(
    /\/+$/,
    ''
  );
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${registry}/${pkg}/latest`;

  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          // Required by some registries; npm CLI defaults exclude common
          // browser User-Agents which can trip rate-limit / WAF rules on
          // proxies. Identifying as our own client is the cleanest path.
          'User-Agent': `photon/${PHOTON_VERSION} (+https://github.com/portel-dev/photon)`,
          Accept: 'application/json',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (status < 200 || status >= 300) {
            // Trim body so a verbose HTML 502 page doesn't blow up logs.
            const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
            reject(
              makeError(
                `npm registry returned HTTP ${status} for ${pkg} (${snippet || 'no body'})`,
                { statusCode: status }
              )
            );
            return;
          }
          try {
            const parsed = JSON.parse(body) as { version?: unknown; [key: string]: unknown };
            if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
              reject(makeError(`npm registry response missing 'version' for ${pkg}`));
              return;
            }
            resolve(parsed as { version: string; [key: string]: unknown });
          } catch (parseErr) {
            const reason = parseErr instanceof Error ? parseErr.message : String(parseErr);
            reject(makeError(`npm registry returned malformed JSON for ${pkg}: ${reason}`));
          }
        });
      }
    );

    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        makeError(
          `npm registry request failed for ${pkg}: ${err.code ?? ''} ${err.message}`.trim(),
          { code: err.code }
        )
      );
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(makeError(`npm registry request timed out after ${timeoutMs}ms`));
    });

    req.end();
  });
}

/**
 * Convenience wrapper: returns just the `latest` version string.
 */
export async function fetchLatestVersion(
  pkg: string,
  opts: { registry?: string; timeoutMs?: number } = {}
): Promise<string> {
  const manifest = await fetchLatestManifest(pkg, opts);
  return manifest.version;
}
