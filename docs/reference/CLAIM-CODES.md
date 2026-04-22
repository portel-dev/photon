# Claim Codes — scoped remote access

By default a Photon daemon exposes every installed photon to every
connected MCP client. That's fine on your own machine. It stops
working the moment you want to give a *remote* agent access to a
*subset* of photons — a phone-side Claude Code session pointed at Beam
running on your laptop, a coworker driving your workspace from their
editor, a CI agent scoped to exactly one project.

A claim code is a short-lived bearer token you generate locally, tied
to a directory. Any MCP session that presents the code gets to see
only the photons whose source file lives under that directory.
Sessions without a code keep full access — nothing changes for
existing clients.

---

## The basic shape

```bash
# Create a claim for the current dir (default: cwd, TTL 24h)
$ photon claim
✓ Claim code: R3K-9QZ
  Scope:      /Users/arul/Projects/my-app
  Expires in: 23h 59m

To use this code, set the Mcp-Claim-Code header on your
MCP client connection (Streamable HTTP transports such as Beam):
  Mcp-Claim-Code: R3K9QZ
```

Hand that code to the remote agent. It presents the code on MCP
initialize, Beam scopes the session, `tools/list` returns only photons
under the claim's directory.

---

## Full command surface

```bash
photon claim                         # default: scope=cwd, TTL=24h
photon claim --scope /path/to/proj   # restrict to a specific dir
photon claim --ttl 1h                # shorter expiry (30m, 2h, 7d all work)
photon claim --label "phone"         # human-readable note

photon claim list                    # show active (non-expired) codes
photon claim revoke ABC-123          # remove a code — immediate effect
```

Codes are 6 characters from a base32-like alphabet (no `0/O/1/I/L`
lookalikes). Stored uppercase without dashes; the dash in `R3K-9QZ`
is purely for readability.

---

## How clients present the code

### Streamable HTTP (Beam, remote MCP clients)

On the initialize request, set:

```
Mcp-Claim-Code: R3K9QZ
```

The transport reads the header on every request and stamps the scope
onto the session. Subsequent `tools/list` filters photons against the
scope.

For SSE `GET` requests that can't set arbitrary headers, pass the code
as a query param instead:

```
GET /?claim=R3K9QZ
Accept: text/event-stream
```

### stdio clients (Claude Desktop et al.)

Stdio clients spawn `photon mcp <target>` as a subprocess. Since they
already have local spawn access, the workstation-security question is
already answered — claim codes aren't needed. The stdio transport
doesn't check for them.

---

## How scoping works

The daemon stores `{code, scopeDir, createdAt, expiresAt, label}`
records in `{baseDir}/.data/claims.json`. On session init, the HTTP
transport:

1. Reads `Mcp-Claim-Code` from the header or `?claim=` from the query
2. Validates the code against the store (existence + expiry)
3. If valid, stamps `claimScopeDir` on the session
4. Absent or invalid codes leave the session unscoped — full access

On `tools/list`, a session with `claimScopeDir` set filters out any
photon whose source file doesn't resolve under that directory. The
match uses a path-separator guard: `/workspace/proj` does **not** match
a photon at `/workspace/projX/foo.photon.ts`.

Expired claims are garbage-collected lazily on every `list` /
`validate` pass — no background sweeper.

---

## What claim codes are not

**Not authentication.** A claim code is a bearer token. Anyone who
holds a valid code gets the scoped access — no per-user identity
check. Treat them like API keys: keep TTLs short, revoke when done,
don't paste into chat logs.

**Not per-tool authorization.** Scope is directory-based. A code
either grants access to every photon under its dir or none. If you
need finer-grained gates (read-only, methods-only, method-by-method),
use `@auth` and OAuth — claim codes are orthogonal.

**Not encrypted transport.** The code travels in a header. Use HTTPS
in front of Beam for remote access; don't expose Beam to the open
internet on port 3000 without a tunnel (Tailscale, ngrok, cloudflared,
etc.).

**Not a session identity.** MCP's `Mcp-Session-Id` is separate and
still required — the claim code only attaches a *scope* to whatever
session the client already has.

---

## Typical workflows

### Pair your phone with Beam on your laptop

```bash
# On the laptop, in your project dir:
$ photon beam &         # starts Beam at http://localhost:3000
$ photon claim          # scope defaults to cwd
Claim code: R3K-9QZ
```

Expose port 3000 via Tailscale / tunnel. On the phone, configure an
MCP client (Claude Code iOS when available, Cursor Mobile, etc.) with
the tunnel URL and the `Mcp-Claim-Code: R3K9QZ` header.

### Give a teammate access to just one project

```bash
$ photon claim --scope /workspace/shared-proj --ttl 4h --label "alice-review"
Claim code: FHX-K42
```

Paste the code to the teammate; they configure their MCP client with
the code. When the review window closes:

```bash
$ photon claim revoke FHX-K42
```

### CI agent with a single photon's scope

Build a short-lived code as part of the CI bootstrap:

```bash
$ photon claim --scope "$CI_PROJECT_DIR" --ttl 30m --label "ci-run-$CI_RUN_ID"
```

Pass the code to the agent via a secret env var. Revoke after the
run completes (or let TTL expire on its own).

---

## Storage + rotation

- Codes live at `{PHOTON_DIR}/.data/claims.json`. Don't check that
  file into git — add `.data/` to your `.gitignore` (the default does).
- Deleting the file revokes everything instantly.
- Daemon restarts don't invalidate live codes (they're on disk, not
  in daemon memory).
- No limit on concurrent codes — `photon claim` always creates a new
  record. Use `photon claim list` to audit.

---

## Troubleshooting

**"The agent still sees photons from other directories."**
The agent's MCP client isn't actually presenting the header. Check
the client's config. With `curl`:

```bash
curl -s http://localhost:3000/ \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Claim-Code: R3K9QZ' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","clientInfo":{"name":"curl","version":"0"},"capabilities":{}}}'
```

Then call `tools/list` with the same session ID — you should see only
the scoped photons.

**"The code doesn't work right after I revoked something nearby."**
Revokes are immediate, but some MCP clients cache the `tools/list`
result across the session. Force a tools-list refresh or open a new
session.

**"I get unscoped access even though my client sends the header."**
The code might be expired. `photon claim list` won't show expired
codes (they're purged on list). Regenerate with `photon claim`.
