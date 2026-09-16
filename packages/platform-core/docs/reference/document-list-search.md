---
title: Поиск в списках документов
type: reference
updated: 2026-09-16
verified_commit: ce72875d
---

# Поиск в списках документов

`DocumentRuntime.list(type, params)` и `exportDataFiltered(type, params, ...)` принимают необязательный `search?: string` в `DocumentListParams` (`src/contracts/documents.ts:120`, `src/backend/services/document-runtime.ts:454`, `:704`). Пробелы по краям удаляются; пустая строка отключает поиск. Предел — 200 символов (`src/backend/services/document-search.ts:14`).

Поиск действует внутри одного типа документа по зарегистрированным колонкам списка. По умолчанию участвуют колонки с `type: 'text'`, `type: 'select'` и без `type`; `searchable: false` исключает поле, `searchable: true` включает поле любого типа (`src/contracts/documents.ts:150`, `src/backend/services/document-search.ts:19`). Учитываются сохранённые значения, а не переводимые подписи select.

Текущая реализация использует PostgreSQL `to_tsvector('russian', ...)` и `websearch_to_tsquery('russian', ...)` (`src/backend/services/document-search.ts:30`). Поиск соединяется через AND с фильтрами, типом документа и условием `deleted_at IS NULL`; одинаковое условие используется для `count`, страницы и экспорта (`src/backend/services/document-runtime.ts:173`, `:454`, `:704`). Порядок остаётся заданной пользователем сортировкой.

Вектор вычисляется из колонок соединённых таблиц во время запроса. Общего индекса поиска и отдельного поискового хранилища пока нет: на больших списках такой запрос может быть медленным. Конфигурация `russian` даёт морфологию русского языка; другие языки и поиск по части слова не гарантированы. Смена поискового движка требует нового адаптера уровня документа, а не замены SQL-функции.
