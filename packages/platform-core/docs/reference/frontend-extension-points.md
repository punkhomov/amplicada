---
title: "Frontend: точки расширения"
type: reference
updated: 2026-09-17
verified_commit: 5767b800
order: 20
---

# Frontend: точки расширения

Точки расширения позволяют модулям добавлять UI в места, которые рендерит core,
не импортируя друг друга. Контракт — `src/contracts/frontend/extension-point.ts`,
компонент-потребитель — `src/frontend/components/extension-point.tsx`.

## Смонтированные точки

| id | Где рендерится | Область |
|---|---|---|
| `header` | `src/frontend/layouts/app-layout.tsx` | шапка авторизованной зоны (layout `app`) |
| `floating` | `src/frontend/layouts/root-layout.tsx` | глобально, поверх всех маршрутов |

`floating` рендерится в `RootLayout`, то есть на каждой странице (app, admin, public).
Компонент-вклад сам решает, показываться ли: например, виджет поддержки
`module-support-chat` скрывается без авторизации.

## Подписка модуля

```tsx
context.extensions.contribute('floating', { component: MyWidget, order: 10 });
```

| Поле | Обязательно | Смысл |
|---|---|---|
| `component` | да | компонент без пропсов |
| `order` | нет | порядок рендера, по умолчанию 0 (`src/frontend/registries/extension-point.ts`) |
| `meta` | нет | произвольные данные для потребителя точки |

Вклады рендерятся как `<c.component key={c.id} />`; id генерирует реестр.
Регистрация происходит в `setup()` модуля до монтирования приложения, поэтому
динамическая реактивность не поддерживается — точка читает реестр при рендере.

## Когда использовать

- Точка расширения — когда вкладчиков может быть несколько и они не должны знать
  друг о друге (`header`, `floating`).
- `Slot` (`context.slots`, `src/frontend/components/slot.tsx`) — когда core рендерит
  **один** компонент в известном месте и модуль может его заменить (`override`)
  или подставить свой при отсутствии (`register` + `fallback`).
- Frontend-сервис — когда модуль отдаёт API, а не UI (например `admin:apps`).
