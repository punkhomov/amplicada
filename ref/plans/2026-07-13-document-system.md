---
title: Document System
type: plan
tier: 4
status: in-progress
date: 2026-07-13
source: clean/08-document-system
note: Core registry (DocumentRegistryImpl) + module-admin backend/frontend implemented. DocumentRuntime CRUD + list + export/import added beyond original plan. Remaining: access control, admin UI polish.
---

# Document System — Plan

## Architecture

```
Document Type (user)
  └── Page (user-card)           ← любой может зарегать
      └── Group (security)       ← любой может зарегать + прицепить к странице
          └── Extension          ← модуль расширяет + прицепляет к группе
```

Wildcard `*` — core регистрирует access page/group для ВСЕХ документов.
Default access = public.

## Files

### 1. Core contracts — `packages/platform-core/src/contracts/documents.ts`

```ts
export interface DocumentType {
  id: string
  label: string
  schema?: any
}

export interface DocumentPage {
  id: string
  document: string
  label: string
  icon?: string
}

export interface DocumentGroup {
  id: string
  document: string
  page: string
  label: string
  order: number
  icon?: string
}

export interface DocumentExtension {
  document: string
  module: string
  group: string
  schema?: any
  fields?: Record<string, FieldMetadata>
  component?: any
  save?: (tx: any, id: string, data: any) => Promise<void>
}

export interface FieldMetadata {
  label: string
  widget?: "text" | "password" | "number" | "date" | "reference" | "select" | "multi-reference" | "checkbox"
  required?: boolean
  readonly?: boolean
  default?: any
  ref?: string
  options?: { label: string; value: string }[]
  placeholder?: string
  helpText?: string
}

export interface DocumentRegistry {
  register(id: string, doc: Omit<DocumentType, "id">): void
  registerPage(id: string, page: Omit<DocumentPage, "id">): void
  registerGroup(id: string, group: Omit<DocumentGroup, "id">): void
  extend(docId: string, ext: Omit<DocumentExtension, "document">): void

  get(docId: string): DocumentType | undefined
  getPages(docId: string): DocumentPage[]
  getGroups(pageId: string): DocumentGroup[]
  getExtensions(groupId: string): DocumentExtension[]
  getAllExtensions(docId: string): DocumentExtension[]
}

export type AccessLevel = "public" | "owner" | "role" | "group"

export interface DocumentAccess {
  docType: string
  docId: string
  level: AccessLevel
  owner?: string
  role?: string
  groupId?: string
}

export const Documents = { USER: "user", USER_GROUP: "user-group" } as const

export const DocumentPages = {
  USER_CARD: "user-card",
  USER_ACCESS: "user-access",
  USER_GROUP_CARD: "user-group-card",
} as const

export const DocumentGroups = {
  SECURITY: "security",
  ACCESS_RIGHTS: "access-rights",
  MEMBERS: "members",
} as const
```

### 2–17: Core + module-admin implementation

See full implementation plan in original file (`clean/08-document-system.md`).

## Implementation Order

| # | File | Action |
|---|------|--------|
| 1 | `platform-core/contracts/documents.ts` | Create |
| 2 | `platform-core/contracts/index.ts` | Update — re-export |
| 3 | `platform-core/contracts/backend/setup.ts` | Update — add documents |
| 4 | `platform-core/contracts/backend/module.ts` | Update — add app param |
| 5 | `platform-core/backend/documents.ts` | Create — DocumentRegistryImpl |
| 6 | `platform-core/backend/access.ts` | Create — checkAccess() |
| 7 | `platform-core/backend/schema/access.ts` | Create — Drizzle schemas |
| 8 | `platform-core/migrations/0002_*.sql` | Create — tables |
| 9 | `platform-core/backend/app.ts` | Update — documents in context, bootstrap |
| 10 | `platform-core/backend/index.ts` | Update — re-export |
| 11 | `module-admin/package.json` | Create |
| 12 | `module-admin/tsconfig.json` | Create |
| 13 | `module-admin/backend/index.ts` | Create — Fastify plugin |
| 14 | `module-admin/backend/routes/documents.ts` | Create — CRUD |
| 15 | `module-admin/backend/routes/registry.ts` | Create — registry |
| 16 | `module-admin/contracts/index.ts` | Create — admin API types |
| 17 | `apps/api/src/index.ts` | Update — add adminModule |
| 18 | `apps/api/package.json` | Update — add dependency |

## API

Base path: `/api/admin/`

### Document CRUD

```
GET    /api/admin/documents/:type          — list
GET    /api/admin/documents/:type/:id      — get one
POST   /api/admin/documents/:type          — create
PUT    /api/admin/documents/:type/:id      — update
DELETE /api/admin/documents/:type/:id      — delete
```

### Registry (read-only, for admin UI)

```
GET    /api/admin/registry/documents
GET    /api/admin/registry/pages/:docType
GET    /api/admin/registry/groups/:pageId
GET    /api/admin/registry/extensions/:groupId
```

## Split

| Core (platform-core) | module-admin |
|----------------------|--------------|
| contracts (types + constants) | Routes (CRUD + registry) |
| DocumentRegistryImpl | preHandler middleware (auth + access) |
| checkAccess() | Frontend (admin UI) |
| Drizzle schemas (user_groups, group_users, document_access) | |
| Migrations | |
| Base document registration (user, user-group, access page/group) | |
