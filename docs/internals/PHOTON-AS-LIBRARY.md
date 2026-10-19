# Photon as a library

Status: exploration of the current public API; proposed changes are identified below.

Photon's complete-application model already supports reuse inside another
application. A consumer can load a Photon and call its methods in-process, or a
Photon can declare another Photon as a dependency. The same source can still be
served through CLI, MCP, and Beam. No new command or authoring format is needed.

## Existing public API

`@portel/photon` re-exports the direct TypeScript API from
`@portel/photon-core`. Applications that only need this API can depend on core
directly. Photon requires core 2.28.1 or later, which includes constructor dependency ownership.

For a single load, the existing entry point is:

```ts
import { photon, disposePhoton } from '@portel/photon';

const notes = await photon<{
  add(p: { text: string }): Promise<unknown>;
}>('./notes.photon.ts', { baseDir: '/srv/my-app/photons' });

try {
  await notes.add({ text: 'Created by application code' });
} finally {
  await disposePhoton('./notes.photon.ts');
}
```

An application with a lifecycle should prefer its own existing runtime owner:

```ts
import { createPhotonRuntime } from '@portel/photon';

const runtime = createPhotonRuntime();
try {
  const notes = await runtime.photon<{
    add(p: { text: string }): Promise<unknown>;
  }>('./notes.photon.ts', {
    baseDir: '/srv/my-app/photons',
    instanceName: 'work',
  });
  await notes.add({ text: 'Created by application code' });
} finally {
  await runtime.close();
}
```

The generic describes the API expected by the caller; it is not runtime
verification that the loaded Photon implements that interface. File paths are
relative to the process working directory unless absolute. Use trusted source:
loading a Photon executes application code in the host process.

The direct API compiles source, enhances plain classes, resolves constructor
injections, invokes `onInitialize`, and returns a method proxy with supported
middleware. Its options include a data directory, namespace, named instance,
session, event callback, MCP client factory, and Cloudflare capability factory
or raw environment. An owned runtime caches loads by source and context and
offers disposal methods; `close()` runs shutdown for its owned cached instances
and prevents further loads. See the dependency lifecycle guarantees below.

This is closer to an application component than a DLL: it is runtime-managed
TypeScript source, with initialization, configuration, storage, and lifecycle.
It does not require opening an HTTP or MCP server.

## Composition already has a vocabulary

Inside another Photon, use constructor injection for a declared dependency:

```ts
/** @photon notes ./notes.photon.ts */
export default class Digest {
  constructor(private notes: any) {}

  async capture(p: { text: string }) {
    return await this.notes.add(p);
  }
}
```

Use `this.photon.use(name)` for dynamic resolution or `this.call('notes.add',
params)` for a named invocation. `photon use <name> <instance>` is the existing
CLI command for selecting a runtime instance; it is a different operation from
the TypeScript resolver.

The full `PhotonLoader` also resolves `@photon` dependencies from marketplace,
local files, GitHub, and npm. Its npm source syntax supports a package version
and an explicit file, such as `npm:@example/notes@1.2.3#notes.photon.ts`. It
locates Photon source inside the package; this does not make every npm package
a Photon. The lite `photon()` API currently accepts local and installed flat
marketplace dependency paths, and explicitly rejects npm/GitHub dependency
sources. Installing a package and supplying a resolved local source path is a
separate host responsibility.

Importing the raw class and constructing it with `new` can work for ordinary
class logic. It does not establish the runtime's injection, middleware,
identity, events, or lifecycle. Document `photon()` as the normal reuse path.

## Boundaries to preserve

| Concern | Current boundary |
| --- | --- |
| Identity and authorization | The lite direct-call proxy does not perform the full loader/transport authorization gate. The embedding application is a trusted host; loading a Photon does not authenticate an end user. |
| Shared live state | An embedded object is not automatically the same live instance managed by a running daemon or Beam. Independent runtime caches are separate objects, even if storage paths match. Shared files alone do not provide safe concurrent writers or live synchronization. |
| Persistence | `this.memory` is available and persists across runtime recreation. Named in-memory instances and `@stateful` event emission alone do not establish daemon-equivalent snapshot persistence. |
| Events | `onEvent` receives lite `@stateful` method events. It does not subscribe the application to Beam's network event stream. |
| Interaction and cancellation | `PhotonOptions` has no per-call caller, input-provider, or abort-signal options. Do not promise human confirmation, client sampling, or cancellation parity for arbitrary direct method calls. |
| Cloudflare | Native bindings require host-supplied `cloudflareFactory` / `cloudflareEnv`. Importing into Node does not provide a Worker environment. |
| Typing and packaging | The generic is caller-supplied. There is no generated checked package interface in this path, and lite resolution does not install remote dependencies. |
| Dependency lifecycle | Core `2.28.1` routes constructor dependencies and injected `Photon` helpers through the owning runtime. Closing it shuts down cached children and grandchildren once; late initialization results are shut down when they settle. Concurrent circular dependencies reject. Photon requires core `2.28.1` or later; earlier versions have a constructor ownership gap. |

When an embedding application must operate on the same live instance as Beam
or another client, use an existing served interface such as MCP. A future local
client convenience wrapper should use that shared execution path rather than
silently constructing another instance.

## Smallest useful next steps (proposed)

1. Document `photon()` and `createPhotonRuntime()` as the existing reuse API,
   alongside the existing `@photon` composition guide. Show a Node application
   using a real Photon with memory and explicit shutdown.
2. Keep the core ownership regressions as an upgrade gate. Core `2.28.1` fixes
   transitive shutdown, shared dependencies, independent owners, late completion,
   and circular dependency rejection, including concurrent roots.
3. Create a behavioral matrix for direct library calls versus full-runtime
   execution. State which annotations and guarantees apply; centralize shared
   execution only where it closes a verified gap.
4. Explore checked types and version-pinned Photon packages after lifecycle
   and dispatch parity. Keep npm distribution compatible with existing source
   resolution rather than adding another package manager or CLI keyword.

The capability expansion is a new consumer surface for existing Photons:
application code can reuse a capability while humans and agents retain their
existing interfaces. Its quality bar should include explicit ownership and
shared-state semantics, rather than merely demonstrating a callable class.

## Verification and evidence

`tests/photon-library.test.ts` exercises the root package exports against actual
temporary `.photon.ts` files. Six checks cover initialized callable instances,
cache reuse and independent owners, shutdown, persistent memory, local
constructor composition, nested/shared cleanup, and transitive/concurrent cycle
rejection against the installed core package. Run:

```sh
vitest run tests/photon-library.test.ts
```

The sibling core regression suite (`tests/photon-loader-runtime.test.ts`) now
checks child/grandchild shutdown, shared-instance cleanup, runtime isolation,
injected helper ownership, late completion, and bounded rejection of direct,
transitive, and concurrent cycles. Run it with `bun run tests/photon-loader-runtime.test.ts`
from `../photon-core`. These checks do not establish authorization. Further
coverage should verify successful and rejected calls through an explicit
authenticated execution surface. A collaboration test should separately verify that a served client
updates the same named instance observed by Beam.

Evidence locations:

- `src/index.ts`: public runtime exports and core re-export.
- `src/loader.ts`: `getPhotonInstance`, `resolveAndLoadPhoton`,
  `resolveNpmPhoton`, and `executeTool` in the full runtime.
- `@portel/photon-core` `photon-loader-lite.ts`: `PhotonOptions`,
  `createPhotonRuntime`, `resolveConstructorArgs`, `buildMiddlewareProxy`, and
  `resolvePhotonDepPath`.
- `@portel/photon-core` `runtime/loader-runtime.ts`: cache context and ownership.
- `docs/internals/CONSTRUCTOR-INJECTION.md`: existing dependency vocabulary.

The lifecycle implementation change is released in `@portel/photon-core@2.28.1`
and adopted through Photon’s registry dependency and lockfile.
