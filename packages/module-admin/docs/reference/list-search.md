---
title: Поиск в списке документов админки
type: reference
updated: 2026-09-16
verified_commit: ce72875d
---

# Поиск в списке документов админки

На `/admin/:type` поле поиска передаёт `search` в `GET /admin/documents/:type`. Максимальная длина — 200 символов; запрос отправляется через 300 мс после изменения ввода (`src/frontend/pages/admin-document-list/ui/admin-document-list.tsx:194`, `src/backend/routes/documents.ts:33`). Изменение строки сбрасывает страницу и выделение строк (`src/frontend/pages/admin-document-list/ui/admin-document-list.tsx:750`).

Поиск выполняется на сервере во всём списке данного типа, вместе с фильтрами. Оба режима пагинации и экспорт текущего вида передают одинаковый `search` (`src/frontend/pages/admin-document-list/lib/list-query.ts:42`, `src/frontend/pages/admin-document-list/ui/admin-document-list.tsx:98`, `:125`, `:265`). Экспорт всех данных через `/export` остаётся полным экспортом.

Ищутся значения текстовых колонок, объявленных расширениями списка; точные правила выбора полей и ограничения приведены в документации `@amplicada/platform-core`.
