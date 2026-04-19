# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |
| < 1.6   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Photon, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email**: Send details to **security@portel.dev**
2. **Subject**: `[SECURITY] Brief description of the vulnerability`
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgement**: Within 48 hours of your report
- **Assessment**: We'll evaluate severity and impact within 5 business days
- **Fix timeline**: Critical vulnerabilities are patched within 7 days; high-severity within 14 days
- **Disclosure**: We'll coordinate disclosure with you after the fix is released

### Scope

The following are in scope:

- **Photon CLI** (`@portel/photon`)
- **Photon Core** (`@portel/photon-core`)
- **Beam UI** (the web interface)
- **Daemon** (background process)
- **Official marketplace photons** (`portel-dev/photons`)

The following are out of scope:

- Third-party or community photons
- Issues in dependencies (report these upstream)
- Denial of service via expected resource consumption

### Security Measures

Photon implements the following security controls:

- **Path traversal protection** on all file-serving endpoints
- **Local-only binding** for Beam UI (127.0.0.1 by default)
- **Request authentication** ensuring only local processes can invoke tools
- **Input validation** on package names, URLs, and template expressions
- **Body size limits** to prevent memory exhaustion
- **Rate limiting** on public-facing endpoints (default 60/min on `/mcp` and webhook transports)
- **Security headers** (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- **HTTPS enforcement** for marketplace fetches
- **Command injection prevention** using `execFile` over `exec`
- **OAuth 2.1 Authorization Server** (RFC 6749 + 7636 PKCE S256, RFC 7591 DCR, RFC 7009 revocation, RFC 7662 introspection, RFC 8693 token exchange, OIDC Core 1.0 id_token, RS256/ES256 with RFC 7518 P1363 encoding) — see [OAuth AS internals](./docs/internals/OAUTH-AUTHORIZATION-SERVER.md)
- **CIMD client identity** with per-tenant domain allowlist, ETag revalidation, structured error taxonomy
- **Webhook source allowlist** via CIDR ranges to restrict which IPs can hit `@webhook` endpoints

### Hall of Fame

We appreciate security researchers who help keep Photon safe. Contributors will be acknowledged here (with permission).
