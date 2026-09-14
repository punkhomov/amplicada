---
title: Layout-Aware Routes
type: plan
tier: 4
status: implemented
date: 2026-07-13
note: ModuleRoutes groups routes by layout. FrontendLayoutRegistry and AdminLayout operational.
---

# Layout-Aware Routes — Plan

## Статус
Реализовано. `ModuleRoutes` группирует маршруты по layout, `FrontendLayoutRegistry` + `AdminLayout` работают.

## Что нужно

### 1. Layout Registry
```ts
// packages/core/src/frontend/registries/layout-registry.ts
const layouts = new Map<string, ComponentType>()

// Регистрация
layouts.set("public", PublicLayout)
layouts.set("app", AppLayout)

// Использование в ModuleRoutes
const Layout = layouts.get(route.layout)
```

### 2. ModuleRoutes — группировка по layout
```tsx
<Routes>
  {/* Роуты без layout */}
  {routes.filter(r => !r.layout).map(route => (
    <Route key={route.path} path={route.path} element={route.element} />
  ))}

  {/* Роуты с layout — каждый layout как отдельный <Route element> */}
  {Array.from(groupedByLayout).map(([layoutName, routes]) => {
    const Layout = layoutRegistry.get(layoutName)
    return (
      <Route key={layoutName} element={<Layout />}>
        {routes.map(route => (
          <Route key={route.path} path={route.path} element={route.element} />
        ))}
      </Route>
    )
  })}

  {children}
</Routes>
```

### 3. Убрать ручные стили из LoginPage
Сейчас LoginPage сам оборачивает себя в `<div className="min-h-screen flex items-center justify-center bg-gray-50">`. Это дублирует `PublicLayout`. После реализации layout-aware routes — убрать.

## Layouts
- `PublicLayout` — центрированный контент, bg-gray-50 (для логина, регистраций)
- `AppLayout` — header с навигацией + main content (для основного приложения)

## Пример использования
```tsx
// Модуль регистрирует route с layout
context.routes.register("/login", <LoginPage />, { layout: "public" })
context.routes.register("/dashboard", <Dashboard />, { layout: "app" })

// ModuleRoutes автоматически оборачивает в нужный layout
```
