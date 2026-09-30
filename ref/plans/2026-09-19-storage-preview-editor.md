---
title: Storage — превью текста (Monaco/Shiki) и multi-format решения
type: plan
tier: 3
status: superseded
superseded_by: 2026-09-29-admin-storage-roadmap.md
date: 2026-09-19
---

# Storage — превью текста (Monaco/Shiki) и multi-format решения

> **Реализовано 2026-09-19:** общий пакет `@amplicada/file-viewer` (D-001…D-004 в
> `ref/notes/file-viewer.md`): рендереры image (зум/панорамирование), video, audio, pdf,
> text (Monaco lazy, view/edit), external (браузер), реестр + `FileSource`.
> `module-admin /admin/storage` переведён на него.
>
> **Дозакрыто 2026-09-29 (итерация 1 roadmap):** `PUT`-роут в storage + правка текста в UI
> (D-006), клиентские Office-рендереры docx/xlsx через `@silurus/ooxml` (D-005) вместо
> «открыть в браузере». Направление дальше (Explorer-UI, поддержка-chat, enabler'ы) ведёт
> `ref/plans/2026-09-29-admin-storage-roadmap.md`; этот план — историческая рамка, заменён им.
> См. `packages/file-viewer/docs/reference/file-viewer.md`.

Направление на будущее: чем усилить диалог предпросмотра `/admin/storage`. Текущий вариант —
ручной и без зависимостей: `image`/`video`/`audio` через теги, `pdf` через `<iframe>`
(встроенный вьюер браузера), текст — `<pre>` через `Range` до 256 КБ
(`packages/module-admin/src/frontend/pages/admin-storage/ui/storage-preview-dialog.tsx`).
Пробелы: нет подсветки синтаксиса, поиска и сворачивания; нет Office; большой текст
показывается как есть.

## Ограничения, которые отсекают половину готовых решений

1. **Файлы за сессионной авторизацией.** URL `/api/admin/storage/objects/view?key=...`
   отдаётся только с cookie. Всё, что ходит во внешний сервис (Office Online / Google Docs
   viewer, облачная конвертация), отпадает: URL не публичный, а отдавать его наружу нельзя.
2. **Тот же origin.** Браузерные вьюеры, которые делают `fetch`/`<img>`/`<iframe>` на наш URL,
   куки отправят (same-origin, а в dev — через Vite-прокси `/api`). Это ок.
3. **Бюджет бандла.** Админка — часть SPA. Всё тяжёлое — только `React.lazy` + динамический
   импорт, иначе первый заход на любую страницу потянет мегабайты.
4. **Политика зависимостей.** `minimumReleaseAge: 10080` (7 дней), `ignoreScripts`,
   `blockExoticSubdeps`. Совсем свежие библиотеки подождут неделю.

## Текст: Monaco против Shiki

| Вариант | Вес | Что даёт | Цена |
|---|---|---|---|
| Текущий `<pre>` | 0 | читаемый текст, Ctrl+F браузера | нет подсветки/нумерации/сворачивания |
| **Shiki** (рекомендую) | tree-shakable, языки грузятся по требованию | подсветка уровня VS Code (те же TextMate-грамматики), только чтение | нет редакторских фич; асинхронная инициализация (WASM), нужен fallback `<pre>` |
| `@monaco-editor/react` + `monaco-editor` | ~2.9 МБ min / ~0.8 МБ brotli + воркеры | полноценный редактор: поиск, сворачивание, minimap, diff | тяжело; настройка `MonacoEnvironment` и воркеров под Vite; для «посмотреть» избыточно |
| `react-syntax-highlighter` | большой на язык (highlight.js) | подсветка | устаревшие грамматики; Dify ушли на Shiki — повторять не стоит |

**Monaco, как подключить, если выберем его.** С версии 4.7.0 peer включает React 19 —
`@next` больше не нужен. Vite требует явных воркеров:

```ts
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// ...css/html/ts воркеры по необходимости
self.MonacoEnvironment = { getWorker: (_, label) => /* выбрать воркер */ };
loader.config({ monaco });
```

`import * as monaco` статический — значит Monaco попадёт в основной чанк, если файл не
ленивый. Оборачивать в `React.lazy(() => import('./monaco-preview'))`, иначе весь SPA
потянет редактор на старте.

**Кандидат `modern-monaco`**: подсвечивает Shiki и лениво грузит `monaco-editor-core`,
но по умолчанию тянет грамматики и темы с CDN (`esm.sh`). Для внутренней сети с S3 за
непубличным URL это лишняя внешняя зависимость — не подходит без самоподготовки ассетов.

**Экономика.** Shiki закрывает 90% сценария («прочитать конфиг/JSON/лог») без редакторской
тяжести; браузерный Ctrl+F уже работает по отрендеренному тексту. Monaco оправдан, если
админам правда нужно листать огромные логи/JSON со сворачиванием и поиском по документу.
Если выбираем Monaco — он заменяет и `<pre>`, и Shiki одним компонентом.

## Office и «всё в одном»

| Решение | Office в браузере | Особенности |
|---|---|---|
| `@cyntler/react-doc-viewer` | через Office Online / Google | **не подходит**: нужен публичный URL к файлу |
| `@iamjariwala/react-doc-viewer` | да (`docx-preview` и др.) | свежий форк, большой dep-граф, Apache-2.0, много наворотов (аннотации, поиск) |
| `@lamberl-lee/file-preview` (FileVista) | да, opt-in плагины (`pdfjs-dist`, `docx-preview`, `exceljs`) | база + плагины; нужны публичные ассеты и CORS-источник, под наш auth-URL — свой blob источник |
| `@eternalheart/react-file-preview` | да | video.js, shiki, framer-motion — очень тяжёлый |
| `react-pdf` (pdfjs) | только PDF | ~280 КБ worker, лениво; даёт единый вьюер вместо `<iframe>` |
| `open-file-viewer` | есть | framework-agnostic, плагины вплоть до CAD/GIS; молодой, большой scope |

**Вывод.** Единый «всё-в-одном» компонент стоит брать, только если предпросмотр Office —
твёрдое требование. Иначе дешевле и честнее собрать мелкие рендереры поверх уже готового
определения типа (`lib/storage-file-kind.ts`) и лениво подгружать каждый: `pdf` — оставить
`<iframe>` (или `react-pdf` ради тулбара/аннотаций), `docx` — отдельный плагин,
`xlsx`/`pptx` — как решим по реальной надобности. Office в браузере всё равно рендерится
приблизительно (без формул, анимаций, сложной вёрстки), поэтому для «документ посмотреть
точно» честнее оставить скачивание.

## Рекомендация по шагам

1. **Текст (низкий риск):** добавить Shiki в ленивом компоненте с fallback на текущий `<pre>`;
   порог 256 КБ оставить. Это самое заметное улучшение за небольшую цену.
2. **Если нужен редакторский опыт:** заменить на ленивый Monaco; отдельной задачей — воркеры
   под Vite, ограничение языков и фич для размера.
3. **Office (только по запросу):** точечные ленивые рендереры (`docx-preview` и т.п.), не
   единый комбайн. Внешние вьюеры не рассматривать — несовместимы с auth.

## Связано

- `packages/module-admin/src/frontend/pages/admin-storage/ui/storage-preview-dialog.tsx`
- `packages/module-admin/docs/reference/storage.md`
- `ref/notes/module-admin.md` (D-004)
