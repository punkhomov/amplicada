---
title: Гварды в update()
type: plan
tier: 4
status: implemented
date: 2026-08-05
size: S
depends-on: []
---

# 03 — Гварды в `update()`

> Реализовано 2026-08-06, см. entry.
> Проверка (`assertDocumentActive`) сделана **внутри** транзакции: снаружи между SELECT и записью
> проскакивало бы параллельное удаление.

## Проблема

`update()` проверяет существование **типа**, но не документа:

```ts
async update(type, id, body, actor) {
  this.getDocOrFail(type);   // тип, не документ
  await this.db.transaction(async tx => {
    await this.saveExtensionData(tx, type, id, body);
    await tx.update(documentIndex).set({...}).where(eq(documentIndex.id, id));  // 0 строк — не ошибка
  });
}
```

Следствия:

- `PUT /admin/documents/:type/<несуществующий-id>` возвращает `{ok: true}` — клиент считает, что
  сохранил;
- soft-deleted документ спокойно редактируется, хотя `getAnyById` его уже не отдаёт: там есть
  `activeFilter`, здесь его нет;
- гварда уровня `creatable`/`deletable` для редактирования не существует вовсе.

## Решение

В начале `update()` — один `SELECT` по базовой таблице с тем же `activeFilter`, что использует
`getAnyById`; нет строки → `DocumentRuntimeError(404)`.

Цена — один дополнительный запрос на сохранение.

После [06-index-primary](./06-index-primary.md) проверка станет дешевле и проще: наличие живого
документа — это строка индекса, базовая таблица для этого не нужна. Переписывание — десяток строк,
ждать ради этого не стоит.

## Что НЕ делаем

Флаг «только чтение» для типа (по аналогии с `creatable`/`deletable`) не заводим — нет потребителя.
Если появится, это отдельная правка контракта `DocumentType`.

## Тесты

Юнит на 404 при отсутствующем и при soft-deleted документе.
