---
title: Browser smoke tests (Playwright) в песочнице
type: guide
tier: 3
status: implemented
date: 2026-09-19
---

# Browser smoke tests (Playwright) в песочнице

Как проверить UI живьём: браузер уже установлен глобально, писать конфиги и
`pnpm install` не нужно. Только headless — окон нет.

## Что есть в песочнице

| Что | Где |
|---|---|
| CLI Playwright 1.61 | `/usr/local/share/npm-global/bin/playwright` (глобальный npm) |
| Библиотека (ESM) | `/usr/local/share/npm-global/lib/node_modules/playwright/index.mjs` |
| Браузеры (Chromium + headless shell) | `/opt/ms-playwright/` |

Зависимость ставить не нужно: в `node_modules` проекта её нет, а глобальный пакет
не резолвится по имени. Импортируй **абсолютным путём** и задавай
`PLAYWRIGHT_BROWSERS_PATH`.

## Минимальный запуск

```js
// /tmp/opencode/smoke.mjs
import { chromium } from '/usr/local/share/npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/admin/storage', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: '/tmp/opencode/shots/root.png' });
await browser.close();
```

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright node /tmp/opencode/smoke.mjs
```

Скрипт держи в `/tmp/opencode/`, скриншоты туда же — это вне рабочего дерева,
чтобы не коммитить тестовый мусор.

## Грабли (набиты на живом прогоне)

- **`waitUntil: 'networkidle'` не наступает.** У приложения есть SSE/polling
  (support-chat, метрики), сеть не затихает. Жди явно: `waitForSelector`,
  `waitForURL`, `waitForTimeout(500-1500)` на settle React Query.
- **Импорт по имени падает** с `ERR_MODULE_NOT_FOUND`, `NODE_PATH` для ESM не
  работает. Только абсолютный путь из таблицы выше.
- **Без `PLAYWRIGHT_BROWSERS_PATH`** браузер не находится (ищется в `~/.cache/ms-playwright`).
- **API стартует раньше S3.** Если `curl http://localhost:3000/api/auth/context`
  не отвечает, а в `dev.log` `ECONNRESET` на S3 — подожди/перезапусти: `touch apps/api/src/index.ts`.
- **`confirm`/`alert` блокируют страницу.** Один раз на страницу:
  `page.on('dialog', d => d.accept())` до клика по удалению.
- **SPA-навигация не триггерит `goto`.** Ходи по кликам (`page.locator('tr',...).click()`),
  URL проверяй через `page.url()`.
- **`fullPage: true`** полезен для длинных таблиц, но со sticky-шапкой даёт двойной
  заголовок; для рутинных снимков хватает вьюпорта.

## Вход в приложение

Логина два шага: любой приватный маршрут редиректит на `/auth/password/login`.

```js
await page.goto(`${BASE}/admin/storage`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[type="submit"]');
await page.locator('input[type="text"]').first().fill('admin');
await page.locator('input[type="password"]').first().fill('admin');
await page.click('button[type="submit"]');
await page.waitForURL(url => !url.pathname.startsWith('/auth/'));
```

Учётки — из сида `module-auth-password/migrations/0000_init.sql` (`admin` / `admin`;
в комментарии миграции пароль указан неверно). Сессия — cookie, поэтому
`page.context().request` после логина уже авторизован: им удобно готовить данные
через API, а UI проверять глазами.

## Полезные паттерны

```js
// API-запрос в авторизованном контексте страницы
await page.context().request.post('http://localhost:5173/api/...', { multipart: {...} });

// проверить скачивание
const dl = page.waitForEvent('download');
await page.locator('button[title="Download"]').click();
await (await dl).saveAs('/tmp/opencode/downloaded.bin');

// собрать ошибки страницы для ассерта
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
```

Анализ: делай `page.screenshot(...)` на каждом шаге и читай PNG через инструмент
чтения изображений — по DOM часто не видно, а на картинке видно сразу (пустая
таблица, застрявший диалог, съехавший layout).

Проверенный пример полного сценария: логин → загрузка → превью → скачивание →
навигация по папкам → удаление. См. историю ветки `feat/admin-storage-explorer`.
