/**
 * Class-level inbound MCP authentication directive.
 *
 * `@auth` historically accepted a single opaque value.  Keep that source
 * compatible while giving the OAuth runtime a structured contract:
 *
 *   @auth required
 *   @auth optional
 *   @auth oauth required
 *   @auth oauth optional
 *   @auth cf-access
 *   @auth email passkey
 *   @auth email passkey optional
 */

export type PhotonAuthMode = 'required' | 'optional';
export type PhotonAuthMethod = 'email' | 'passkey';

export interface PhotonAuthDirective {
  /** Authentication mechanism. `legacy` preserves the original token prompt. */
  scheme: string;
  /** Whether an anonymous caller may reach the MCP endpoint. */
  mode: PhotonAuthMode;
  /** Passwordless login methods requested by the Photon, when declared. */
  methods?: PhotonAuthMethod[];
  /** Normalized source representation used for diagnostics and code generation. */
  raw: string;
}

export type PhotonAuthDirectiveResult =
  | { directive: PhotonAuthDirective; error?: undefined }
  | { directive?: undefined; error: string };

const MODES = new Set<PhotonAuthMode>(['required', 'optional']);
const METHODS = new Set<PhotonAuthMethod>(['email', 'passkey']);

/** Parse the text following `@auth`, without the tag name itself. */
export function parsePhotonAuthDirective(value?: string): PhotonAuthDirectiveResult {
  const tokens = (value ?? '').trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { directive: { scheme: 'legacy', mode: 'required', raw: 'required' } };
  }

  if (tokens.length === 1) {
    const token = tokens[0].toLowerCase();
    if (MODES.has(token as PhotonAuthMode)) {
      return {
        directive: {
          scheme: 'legacy',
          mode: token as PhotonAuthMode,
          raw: token,
        },
      };
    }
    // `@auth oauth` predates inbound MCP OAuth and binds legacy per-caller
    // instances by OAuth subject. Requiring an explicit mode keeps that
    // behavior source-compatible while making inbound OAuth unambiguous.
    if (token === 'oauth') {
      return {
        directive: {
          scheme: 'legacy',
          mode: 'required',
          raw: 'oauth',
        },
      };
    }
    if (METHODS.has(token as PhotonAuthMethod)) {
      return {
        directive: {
          // Email and passkey are login methods used by Photon's inbound
          // OAuth authorization server, not separate MCP transports.
          scheme: 'oauth',
          mode: 'required',
          methods: [token as PhotonAuthMethod],
          raw: token,
        },
      };
    }
    return {
      directive: {
        scheme: token,
        mode: 'required',
        raw: token,
      },
    };
  }

  const normalized = tokens.map((token) => token.toLowerCase());
  const last = normalized[normalized.length - 1];
  const mode = MODES.has(last as PhotonAuthMode) ? (last as PhotonAuthMode) : 'required';
  const methodTokens = MODES.has(last as PhotonAuthMode) ? normalized.slice(0, -1) : normalized;

  if (
    methodTokens.length > 0 &&
    methodTokens.every((token) => METHODS.has(token as PhotonAuthMethod))
  ) {
    const methods = methodTokens as PhotonAuthMethod[];
    if (new Set(methods).size !== methods.length) {
      return {
        error: `Invalid @auth directive '${tokens.join(' ')}'. Each authentication method may appear only once.`,
      };
    }
    return {
      directive: {
        scheme: 'oauth',
        mode,
        methods,
        raw: normalized.join(' '),
      },
    };
  }

  if (tokens.length !== 2) {
    return {
      error: `Invalid @auth directive '${tokens.join(' ')}'. Expected '@auth <mode>' or '@auth <scheme> <mode>'.`,
    };
  }

  const scheme = tokens[0].toLowerCase();
  const legacyMode = tokens[1].toLowerCase();
  if (MODES.has(scheme as PhotonAuthMode)) {
    return {
      error: `Invalid @auth directive '${tokens.join(' ')}'. Put the scheme before the mode, for example '@auth oauth optional'.`,
    };
  }
  if (!MODES.has(legacyMode as PhotonAuthMode)) {
    return {
      error: `Invalid @auth mode '${tokens[1]}'. Expected 'required' or 'optional'.`,
    };
  }
  if (scheme !== 'oauth') {
    return {
      error: `Legacy @auth schemes accept exactly one token; use '@auth oauth ${legacyMode}' for OAuth.`,
    };
  }

  return {
    directive: {
      scheme,
      mode: legacyMode as PhotonAuthMode,
      raw: `${scheme} ${legacyMode}`,
    },
  };
}

/** Extract and parse the class-level `@auth` line from a JSDoc block. */
export function extractPhotonAuthDirective(
  docblock: string
): PhotonAuthDirectiveResult | undefined {
  const matches = [...docblock.matchAll(/@auth\b([^\r\n*]*)/gi)];
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return { error: 'Only one class-level @auth tag is allowed.' };
  return parsePhotonAuthDirective(matches[0][1]);
}

/** Extract inbound auth metadata from the Photon class or its leading file docblock. */
export function extractPhotonAuthDirectiveFromSource(
  source: string
): PhotonAuthDirectiveResult | undefined {
  const classMatch = source.match(/\/\*\*([\s\S]*?)\*\/\s*export\s+default\s+class\b/);
  const leadingMatch = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  return extractPhotonAuthDirective(classMatch?.[1] ?? leadingMatch?.[1] ?? '');
}

/** Backward-compatible value exposed as `mcp.auth`. */
export function legacyAuthValue(directive: PhotonAuthDirective): string {
  return directive.raw;
}
