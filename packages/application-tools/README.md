# @amplicada/application-tools

Static module composition for Amplicada applications. Requires Node 24+.

Before installing, create `pnpm-workspace.yaml` (also in standalone or temporary projects):

```yaml
ignoreScripts: true
blockExoticSubdeps: true
minimumReleaseAge: 43200
```

These installation safeguards are required by the project. Do not disable them or
allow dependency install scripts to make a check pass. Zero-config module discovery
does not remove the installation security policy.

Add `amplicada-modules` before your existing build/dev commands:

```json
{
  "scripts": {
    "generate": "amplicada-modules",
    "build": "pnpm generate && tsc && vite build"
  }
}
```

The CLI reads the current application's production `dependencies` and activates
packages with `amplicada` metadata. No application config, Turbo, or workspace source
paths are required. Add a module dependency, install, and rebuild.

Generated outputs (ignore `src/generated/` in git):

- `src/generated/backend-modules.ts`: pass `modules` to backend `bootstrap`.
- `src/generated/frontend-modules.ts`: pass `modules` to `bootstrapFrontend`.
- `src/generated/modules.css`: import from your application stylesheet.

Use `--target backend` or `--target frontend` for separate applications, `--app path`
to select an application directory, and `--check` to validate without writing files.
Restart dev after changing dependencies. With both targets in one directory, give
Vite a separate output directory so it doesn't erase backend compilation output.

Optional explicit profile: `amplicada-modules --config application.json`:

```json
{
  "id": "portal",
  "modules": ["@amplicada/module-auth-password"],
  "targets": { "backend": ".", "frontend": "." }
}
```

Targets are relative to the profile. Explicit profiles require all selected modules
in target dependencies. The profile path is relative to the command working directory.
Only the explicit `--config` option selects a profile; normal builds use dependencies.

Module authors set `"amplicada": true` in package.json. Runtime sides are detected
from `exports["./backend"]` and `exports["./frontend"]`; each exports its registration
object as `module`. CSS is detected from the optional `./frontend/tailwind.css` export.
Stable runtime ids and display names live in the module's code. No `requires`,
per-side dependency lists, or stylesheet metadata are needed.

Composition includes only modules explicitly listed in the application's production
`dependencies` (or selected by `--config`). Required module dependencies and peers
must also be selected. Optional peers add setup order only if selected; otherwise
they are ignored. Libraries, devDependencies and optionalDependencies do not activate
modules. Cycles and missing required modules fail before writing outputs; duplicate
runtime ids fail in bootstrap. Discovery does not execute code or install packages.

For optional integrations, import service interfaces with `import type`, check
`context.modules.getById(id)` and resolve the service from context. The provider must
register it during setup. Auth uses this pattern for `admin:toolbar` and works without
admin installed. Package authors need the optional peer in devDependencies for type
checking; its types must not leak into the consumer's public declaration graph.

Infrastructure settings and application scaffolding remain the application's concern.
Removing a module dependency does not delete its persistent data.

## Documentation

| Page | Contents |
|---|---|
| [Overview](./docs/index.md) | Package scope and documentation map |
| [Reference](./docs/reference/composition.md) | CLI, API, metadata and constraints |
| [Composition model](./docs/explanation/composition-model.md) | Selection, ordering and setup guarantees |
| [Optional integration](./docs/how-to/optional-module-integration.md) | Package metadata, service calls, type declarations and validation |
