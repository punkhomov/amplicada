---
title: module-hr-poll — заметки разработчиков
type: notes
tier: 2
status: implemented
date: 2026-09-16
---

# module-hr-poll — заметки разработчиков

> Не возвращать прямую регистрацию toolbar через глобальный импорт — D-001 (accepted).

## D-001. Сервис toolbar и optional-интеграция — accepted (2026-09-16)

**Контекст.** Toolbar admin переведён на сервис для optional-интеграции auth.
**Решение.** Публикация опроса использует context.services.resolve<AdminToolbarService>(admin:toolbar).
**Почему именно так.** Все потребители используют один реестр конкретного приложения.
**Отвергнуто.** Обязательная админка ради одного действия; молчаливый services.has при
выбранном admin, скрывающий ошибку регистрации сервиса.
**Что изменит решение.** Потребность в интеграции после start или взаимных вызовах setup.
**Грабли.** Admin остаётся обязательным peer: есть другие runtime-импорты component registry и UI.
**Код.** `src/frontend/setup.tsx:19`.
**Связано.** [ADR-06](../adr/06-module-conventions.md).
