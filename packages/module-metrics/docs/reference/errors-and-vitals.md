---
title: "Ошибки и Web Vitals"
type: reference
updated: 2026-09-18
verified_commit: 9e0cfb80
order: 60
---

# Ошибки и Web Vitals

Клиентская диагностика: сгруппированные ошибки (issues) и Core Web Vitals.
Код: `src/frontend/lib/{error-capture,vitals}.ts`, `src/backend/services/error-fingerprint.ts`,
`src/backend/services/web-vitals.ts`.

## Ошибки

Трекер слушает три источника и шлёт события `error.frontend` (kind `error`):

| Источник | Как ловится |
|---|---|
| `window-error` | `window.addEventListener('error', …, true)` — включая ошибки ресурсов |
| `unhandled-rejection` | `window.addEventListener('unhandledrejection', …)` |
| `react-uncaught` / `react-caught` | React 19 `createRoot({ onUncaughtError, onCaughtError })` через репортер ядра `frontendErrors` (`apps/web/src/main.tsx`) |

Атрибуты: `error.type`, `error.message`, `error.stack` (≤ 10 кадров), `error.component_stack`,
`source`. Клиент и сервер **независимо** нормализуют тексты: origin и query убираются, UUID/hex
заменяются на `<id>`/`<hex>` — персональные данные в issue не попадают.

**Группировка (issue).** Fingerprint = sha256(`error.type` + шаблон маршрута + первые 5 кадров
стека). Сообщение в fingerprint не входит — оно меняется от данных. Параметр передаётся в
дедупликации: повторная доставка того же события не увеличивает счётчик issue (инкремент идёт
только по реально вставленным строкам).

Хранение: `metrics.error_issues` (fingerprint PK, тип, шаблон сообщения, маршрут, счётчик,
first/last seen, релизы) + события с колонкой `error_fingerprint`.

## Web Vitals

Метрики собираются библиотекой `web-vitals` (6.2.1) и уходят как события
`web_vital.lcp|inp|cls|fcp|ttfb` с `measures.value`/`delta` и атрибутами `rating`,
`navigation_type`. Одновременно сервер превращает их в **гистограммы** (`web_vital.*`,
границы = пороги good/poor), поэтому p75/p95 считаются по истории без полного перебора
событий.

| Метрика | Порог good / poor | Единица |
|---|---|---|
| LCP | 2500 / 4000 | мс |
| INP | 200 / 500 | мс |
| CLS | 0.1 / 0.25 | — |
| FCP | 1800 / 3000 | мс |
| TTFB | 800 / 1800 | мс |

## HTTP

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/metrics/errors?from&to&limit` | Issues с периодным счётчиком и affected actors |
| `GET` | `/api/metrics/errors/:fingerprint/samples?limit` | Последние примеры ошибки (стек, контекст) |
| `GET` | `/api/metrics/vitals?from&to` | p75/p95 и раскладка good/needs-improvement/poor |

## UI

Вкладка «Ошибки» — таблица issues, клик по строке раскрывает примеры со стеком.
Вкладка «Web Vitals» — карточки метрик с p75 и раскладкой по рейтингам.

## Ограничения

- Release health (crash-free sessions/users) не считается; релиз хранится у issue как
  first/last, но сессийная модель не строится.
- Параметры и значения полей не собираются; маскирование сообщений — эвристика, а не гарантия.
- `affectedActors` — уникальные псевдонимы в периоде; для анонимных событий актора нет.
