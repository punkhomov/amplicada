---
title: module-auth-password — заметки разработчиков
type: notes
tier: 2
status: implemented
date: 2026-09-16
---

# module-auth-password — заметки разработчиков

> Не возвращать прямую регистрацию toolbar через глобальный импорт — D-001 (accepted).

## D-001. Сервис toolbar и optional-интеграция — accepted (2026-09-16)

**Контекст.** Добавление кнопки смены пароля не должно требовать admin.
**Решение.** Admin — optional peer, setup проверяет getById и использует admin:toolbar.
**Почему именно так.** Автор использует типы через devDependency; готовое приложение не требует admin.
**Отвергнуто.** Обязательная админка ради одного действия; молчаливый services.has при
выбранном admin, скрывающий ошибку регистрации сервиса.
**Что изменит решение.** Потребность в интеграции после start или взаимных вызовах setup.
**Грабли.** ChangePasswordAction убран из публичного frontend barrel, иначе его .d.ts требовал бы admin. Полная проверка чужих .d.ts без skipLibCheck на внешнем проекте падает на Drizzle/Node; публичный граф auth проверен отдельно.
**Код.** `src/frontend/setup.tsx:19, src/frontend/index.ts:1`.
**Связано.** [ADR-06](../adr/06-module-conventions.md).

**Подробности D-001.** Сравнение прямого импорта и сервиса через контекст, причина
удаления публичного ChangePasswordAction, гарантии порядка и краткие альтернативы
собраны в [application-tools, D-004](application-tools.md). Это пояснение принятого
решения, не новая смена контракта.
