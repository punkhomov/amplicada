---
title: Auth — опциональная админка
type: reference
updated: 2026-09-16
verified_commit: a5c2ac9
---

# Auth — опциональная админка

Модуль обнаруживается по `amplicada: true`; публичные ./backend и ./frontend
экспортируют регистрацию как `module`. Runtime id — `auth-password`
(`src/contracts/manifest.ts:4`, `src/frontend/index.ts:2`).

Admin — optional peer, объявленный в package.json. Без него frontend setup регистрирует
страницу `/auth/password/login`, не запрашивая административные сервисы
(`src/frontend/setup.tsx:14`, `src/contracts/paths.ts`).

При включённом admin генератор запускает его setup раньше auth. Auth проверяет
`context.modules.getById('admin')`, получает `admin:toolbar` и добавляет действие
`change-password` для документа `user` (`src/frontend/setup.tsx:19`). Если admin
подключён, но сервис отсутствует, resolve бросает ошибку: интеграция не скрывается.

Типы admin импортируются через import type. Реализация admin из auth не импортируется.
Для разработки auth пакет admin остаётся devDependency. ChangePasswordAction —
внутренний компонент, больше не экспортируется из ./frontend; публичный граф типов
не требует admin. Публично доступны module и LoginPage (`src/frontend/index.ts:1`).

При ручном подключении без генератора вызывающий код отвечает за dependencies и
порядок. Удаление admin из состава не удаляет данные auth или admin из БД.
