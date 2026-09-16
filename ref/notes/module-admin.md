---
title: module-admin — заметки разработчиков
type: notes
tier: 2
status: implemented
date: 2026-09-16
---

# module-admin — заметки разработчиков

> Не возвращать прямую регистрацию toolbar через глобальный импорт — D-001 (accepted).

## D-001. Сервис toolbar и optional-интеграция — accepted (2026-09-16)

**Контекст.** Auth должен работать без установки admin.
**Решение.** Типы toolbar вынесены в contracts, реестр стал frontend-сервисом admin:toolbar.
**Почему именно так.** Нет runtime-импортов из optional peer; экземпляры приложений не делят действия.
**Отвергнуто.** Обязательная админка ради одного действия; молчаливый services.has при
выбранном admin, скрывающий ошибку регистрации сервиса.
**Что изменит решение.** Потребность в интеграции после start или взаимных вызовах setup.
**Грабли.** Другие registry admin остаются глобальными; перенос вне этой задачи. registerToolbarAction удалён.
**Код.** `src/frontend/index.tsx:28, src/frontend/lib/toolbar-action-registry.ts:3`.
**Связано.** [ADR-06](../adr/06-module-conventions.md).

**Подробности D-001.** Сравнение прямого импорта и сервиса через контекст, причина
удаления публичного ChangePasswordAction, гарантии порядка и краткие альтернативы
собраны в [application-tools, D-004](application-tools.md). Это пояснение принятого
решения, не новая смена контракта.
