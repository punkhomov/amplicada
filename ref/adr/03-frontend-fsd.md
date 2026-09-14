---
title: Feature-Sliced Design for Module Frontends
type: adr
tier: 1
status: accepted
date: 2026-07-21
---

# ADR-003: Feature-Sliced Design for Module Frontends

## Status

Accepted

## Context

Each module's `src/frontend/` has evolved organically. While the codebase already uses `pages/`, `components/`, and `lib/` directories — mirroring FSD's segment structure — there are no formal layer conventions. As modules grow (module-admin has 22 files across 4 sections, module-workflow has 11), the lack of consistent structure creates problems:

- No clear boundary between page-specific code and reusable components
- Components are placed in a flat `components/` directory regardless of reuse scope
- No per-slice public API — any file can import any other file directly
- It's unclear when to extract shared logic vs. keep it local
- New modules have no structural template to follow

FSD v2.1 addresses these concerns with a proven methodology for structuring UI code.

## Decision

Adopt Feature-Sliced Design v2.1 for all module `src/frontend/` directories.

Each module's frontend will be organized into FSD layers:

```
src/frontend/
├── app/                      # App-level providers, layouts (module-specific)
├── pages/                    # Route-level page slices
├── widgets/                  # Large composite UI blocks reused across 2+ pages
├── features/                 # User interactions reused across 2+ pages
├── entities/                 # Business domain models (rare, when needed)
└── shared/                   # Module-internal utilities (most shared infra comes from platform-core)
```

### Layer mapping for existing code

| Current | FSD layer | When |
|---------|-----------|------|
| `pages/*.tsx` | `pages/<name>/ui/<name>.tsx` | Always — each page is a slice |
| `components/` (app-level: ExtensionPoint, ModuleRoutes) | stays in `components/` (platform-core) | Only in platform-core |
| `components/` (module-level: large reusable blocks) | `widgets/<name>/` | When used in 2+ pages |
| `components/` (interactions: forms, dialogs) | `features/<name>/` | When used in 2+ pages |
| `components/` (single-use) | inline in `pages/<name>/components/` | When used only in 1 page |
| `lib/` (registries, utilities) | `shared/lib/` or stay in `lib/` | Module-internal shared |

### Key rules

1. **Public API per slice**: each slice exports from `index.ts` only. No direct imports of internal files (`ui/`, `model/`, etc.).
2. **Layer imports only downward**: `pages → widgets → features → entities → shared`. No upward or cross-layer imports.
3. **No cross-imports between slices on the same layer**. Use composition from higher layers (IoC via hooks/render props) or extract to a lower layer.
4. **Domain-based naming**: no `types.ts`, `utils.ts`. Name files after the domain: `user.ts`, `order.ts`.
5. **No business logic in shared/**: shared contains only utilities, registries, infrastructure. Business logic belongs in pages, features, or entities.
6. **Platform-core = shared/ + app/ layers**: platform-core provides the shared UI kit (`ui/`), API client, hooks, and app-level infrastructure (routing, layouts). Modules import from it as their primary shared layer.

### Minimal layers approach

Start with only the layers that have code. Empty layer folders are not created:

- `pages/` — always present if the module has routes
- `shared/` — if there are module-internal utilities (most infrastructure comes from platform-core)
- `features/`, `widgets/`, `entities/` — only when there is actual multi-use code
- `app/` — only if the module registers its own layouts or providers

### Relation to package boundaries

FSD layers apply **inside** each module's `src/frontend/`. The package boundary (npm package with subpath exports) is the outermost architectural boundary. Modules remain independent packages — FSD layers within a module do not affect cross-module imports.

## Rationale

### Why FSD v2.1

1. **Proven methodology**: FSD is battle-tested in large React codebases. The v2.1 update removed deprecated `processes/` layer and endorses "start simple, extract when needed."
2. **Natural fit**: The codebase already uses a structure close to FSD. Formalizing it with layer rules catches drift early.
3. **Scalability**: As modules grow (especially module-admin and module-workflow), clear slice boundaries prevent spaghetti imports.
4. **Onboarding**: New contributors and agents have a predictable structure to follow.

### Alternatives considered

- **Flat `components/` + `pages/`**: Current approach. Works for small modules but doesn't scale. No guidance on extraction.
- **Atomic Design**: Too granular (atoms/molecules/organisms). Doesn't map well to business domains. FSD's slice-based approach is a better fit for feature modules.
- **No change**: Risk of continuing ad-hoc structure. Inconsistency between modules increases over time.

## Consequences

### Positive

- All modules follow the same frontend structure
- Clear guidance on where to place new code
- Per-slice public API reduces coupling
- Layer import rules prevent dependency cycles
- Easy to see if a component is reused or page-specific

### Negative

- Migration cost: renaming `components/` to `widgets/` and/or `features/`, adding `ui/` subfolders, updating imports
- Additional files per slice (index.ts public API, ui/ subfolder) — slightly more boilerplate
- Learning curve for developers new to FSD
- Some single-use components in `components/` need to be either moved to page slices or kept as widgets

### Risks

- Over-extraction: premature creation of entities/features before actual multi-use is confirmed
  - Mitigation: FSD v2.1 explicitly recommends keeping code in pages. Extract only when confirmed multi-use.
- Over-splitting: too many small slice directories
  - Mitigation: small slices (< 3 files) should stay in pages. Only extract when the slice has clear responsibility.

## Implementation Notes

Implementation follows an incremental pattern:

1. Update `ref/guides/module-structure.md` with FSD structure
2. Per module: rename `components/` → `widgets/` or `features/`, wrap pages in slice folders with `ui/` + `index.ts`, update barrel exports and imports
3. Add `ui/` segment to page slices — wrap page components in `pages/<name>/ui/<name>.tsx`
4. Remove old files after migration
5. Verify with `pnpm build`

Each module is migrated independently. Modules with few files (module-hr, module-auth-password) can serve as templates.

## Related

- ADR-001: Architecture — defines module structure, subpath exports, package boundaries
- `ref/guides/module-structure.md` — updated to reflect FSD structure
- FSD v2.1 guide: `ref/guides/frontend-fsd.md` (this decision maps FSD onto the existing module architecture)
