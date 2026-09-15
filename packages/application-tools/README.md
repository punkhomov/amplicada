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

Module authors declare `amplicada` in their package.json:

```json
{
  "amplicada": {
    "id": "example",
    "name": "Example",
    "backend": { "export": "exampleModule", "dependencies": [] },
    "frontend": { "export": "exampleFrontendModule", "dependencies": [] },
    "styles": "./frontend/tailwind.css"
  }
}
```

The corresponding `./backend`, `./frontend` and optional stylesheet must be package
exports. Either runtime side can be omitted. `requires` optionally lists module ids
required by the whole composition; per-side dependencies control setup order.

Discovery includes required modules available through dependencies/peerDependencies
of the declaring module, provided they are importable from the app. For isolated
nested packages, add the provider to app dependencies. Ordinary libraries and
unused peer modules don't activate. Missing modules, cycles and duplicate ids fail
before writing outputs. Code generation doesn't execute module code or install packages.

Infrastructure settings and application scaffolding remain the application's concern.
Removing a module dependency does not delete its persistent data.

## Documentation

| Page | Contents |
|---|---|
| [Overview](./docs/index.md) | Package scope and documentation map |
| [Reference](./docs/reference/composition.md) | CLI, API, metadata and constraints |
