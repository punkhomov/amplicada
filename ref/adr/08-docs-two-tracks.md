---
title: Документация двумя треками — Pages per-module + встроенный вьювер
type: adr
tier: 1
status: accepted
date: 2026-09-30
---

# ADR-08: Документация двумя треками — Pages per-module + встроенный вьювер на инстансе

## Context

Потребительская документация живёт рядом с кодом (`packages/*/docs/`, 7 пакетов с
`index.md`), VitePress-ready по скиллу `module-docs` (чистый Markdown, `index.md`,
относительные ссылки, front matter `title/type/updated/verified_commit`). Рационал —
в `ref/notes/`, это dev-скоп и в прод не едет.

Версионирования нет вообще: git-тегов нет, все пакеты `version: 0.0.0`, CI нет
(`.github/` отсутствует). Требуется два независимых свойства:

1. **Публичная версионная дока per-module** — версии модулей независимы («хмхм»:
   `module-admin@0.5.0` живёт рядом с `platform-core@1.2.0`).
2. **Мануал на инстансе** — community-модуль привозит справку с собой; на запущенном
   сервере она доступна без поиска внешнего хостинга.

Лимиты GitHub сверены с официальной документацией 2026-09-30: Pages site 1 ГБ
(soft), bandwidth 100 ГБ/мес (soft), 10 builds/hour — только Jekyll-пайплайн
(custom Actions workflow без лимита), deploy timeout 10 мин (hard); Actions
artifacts на Free — 500 МБ общий пул с Packages, retention 90 дней по дефолту;
Release assets — долгоживущие, файл до 2 ГБ. Markdown-зависимостей в репо нет
(проверены все `package.json`) — выбор рендера свободен.

## Decision

1. **Два трека, один источник.** Источник — `packages/<pkg>/docs/` (чистый Markdown,
   требование `module-docs` сохраняется). Трек 1 — GitHub Pages, трек 2 — вьювер
   на инстансе. `ref/` не публикуется нигде, кроме локальной dev-сборки.
2. **Независимое версионирование, теги `<pkg>@vX.Y.Z`** (например
   `module-admin@v0.5.0`). Локстеп отвергнут: 13 пакетов с разным темпом.
3. **Трек 1 — VitePress, per-package сборки.** На каждый тег CI собирает только
   этот пакет (`vitepress build packages/<pkg>/docs --base /<pkg>/<ver>/`) в ветку
   `gh-pages`: `/<pkg>/<ver>/` (иммутабельно) + `/<pkg>/latest/` + корневой
   `versions.json` с селектором версий. Тот же workflow цепляет
   `docs-<pkg>-<ver>.zip` к GitHub Release тега. На Pages — последние 5 миноров
   на пакет (prune-джоба); всё остальное — Release assets + браузинг тега.
   Оценка: ~0.5 МБ на версию модуля, 14 пакетов × 20 версий ≈ 140 МБ < 1 ГБ.
4. **Трек 2 — собственный лёгкий вьювер на React** (`react-markdown` + `remark-gfm` +
   `rehype-sanitize`, стили Tailwind/shadcn-кита). Контракт: наличие `docs/index.md`
   + поле `audience: user|admin|dev` во front matter = платформа сама регистрирует
   справку (`/help/:moduleId/*` для пользователей, запись в `admin:apps` для
   админов). На инстансе ровно одна версия — установленная, рядом ссылка «другие
   версии на Pages».
5. **Actions artifacts — только транспорт между джобами**, не архив версий
   (протухают за 90 дней, делят 500 МБ квоту с Packages).

## Rationale

Отвергнутые альтернативы:

- **Docusaurus как сайт** — его версионирование одноосевое (снапшот всего сайта),
  нам нужны независимые оси на модуль; плюс тяжёлый бандл (~200 КБ JS) и
  Algolia-зависимость поиска. Для per-module проще честное ручное версионирование.
- **Docusaurus/VitePress, встроенные в приложение** — Docusaurus не библиотека, а
  site-фреймворк (свой роутер/сборка); VitePress — Vue-рантайм. Ни то ни другое не
  рендерится в React-дереве и не шарит shadcn-кит.
- **SaaS-вики (Mintlify/GitBook)** — данные уходят из периметра, отдельная база
  юзеров и SSO-синк; противоречит «сервер сам база знаний».
- **Outline/Wiki.js/BookStack как продуктовая база знаний** — отдельная identity,
  ops-цена (Outline вообще без локального логина — только OIDC/Slack/Google);
  максимум — внутренняя dev-вики команды, не справка в релизе.
- **Артефакты как архив версий** — retention 90 дней и общий пул 500 МБ.
- **Локстеп-тег `v1.0.0` на всё** — заставляет релизить нетронутые пакеты и врёт
  в `verified_commit`.

## Consequences

### Positive

- Версия доки = версия кода автоматически; community-модуль документирован
  из коробки на любом инстансе, offline.
- Один source of truth в двух рендерах; `verified_commit` становится бейджем
  «проверено на …».
- Нет второго фреймворка в монорепе на треке 2; на треке 1 Vue никого не волнует.

### Negative

- Новый `.github/` + пакет `docs-site/` + prune-политика — поддерживать нам.
- Новые зависимости вьювера (`react-markdown`, `remark-gfm`, `rehype-sanitize`);
  политика `minimumReleaseAge`/`trustPolicy` применяется как обычно.
- `files[]` пакетов += `docs` (иначе вьюверу нечего читать из npm-пакета);
  поле `audience` дозаполнить по существующим `packages/*/docs`.

### Risks

- Рассинхрон «код ↔ дока» между релизами — митигация: CI-гейт «тег без
  обновлённого `updated/verified_commit` не собирается» (предупреждение, не блок).
- Спам тегами при частых релизах — митигация: prune до 5 миноров, архив в Releases.

## Related

- Скилл `module-docs` (VitePress-ready, `ref/notes` append-only).
- План: `ref/plans/2026-09-30-docs-two-tracks.md`.
- Потребительские docs пакетов: `packages/*/docs/index.md`.
- Точки встраивания трека 2: `admin:apps` (`packages/module-admin/src/contracts/apps.ts:3`).

## Amendment — спайк трека 1 (2026-09-30)

Безверсионный VitePress собран и проверен локально: `docs/` + `assemble.mjs`
(копия `packages/*/docs` с сохранением дерева — кросс-пакетные относительные
ссылки работают без переписывания) + `.github/workflows/docs.yml` (Pages
`punkhomov.github.io/amplicada`). Факт: сборка 2.68с, 9 пакетов, 39/39
внутренних ссылок резолвятся, скриншоты в `/tmp/opencode/docs-0*.png`.

Два уточнения к Decision:

1. **`docs/` — standalone workspace, не `packages/docs-site/`.** VitePress 1.6.4
   требует `vite ^5.4.14`, а резолв `vite@5.4.21` (2025-10-20, без provenance
   новых мажоров) падает под корневым `trustPolicy: no-downgrade` — проверка
   идёт по trust evidence из реестра, а не по semver, и бьёт везде, включая
   чистые машины и CI. Поэтому у `docs/` свой `pnpm-workspace.yaml` (зеркало
   строгой политики) + точечный `trustPolicyExclude: [vite@5.4.21]`.
2. **Отвергнуто:** `vite` в корневой `trustPolicyExclude` (ослабило бы supply
   chain основного продукта ради тулзы); override vite→8 для VitePress
   (hard-dep `^5`, сломается); `.npmrc`-политики для `docs/` (pnpm 12 читает
   из `.npmrc` только auth/registry — остальное игнорируется молча).
