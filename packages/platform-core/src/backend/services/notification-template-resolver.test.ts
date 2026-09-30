import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { BackendDbService } from '../../contracts/backend/db.js';
import { loadTemplate, pickTemplateLocale } from './notification-template-resolver.js';

/** drizzle поверх клиента-заглушки: запросы не выполняются, ответы задаются по порядку. */
function recordingDb(responses: unknown[][][] = []): BackendDbService {
  let call = 0;
  const client = {
    // biome-ignore lint/suspicious/noExplicitAny: минимальная заглушка pg-клиента
    query: async () => {
      const rows = responses[call] ?? [];
      call += 1;
      return { rows, rowCount: rows.length, fields: [] };
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: драйвер подменён, реального соединения нет
  return drizzle({ client: client as any }) as unknown as BackendDbService;
}

/** Строка выборки шаблона в порядке select-колонок: subject, body, html, sender, attachments, locale. */
function templateRow(locale: string | null, subject: string): unknown[] {
  return [subject, 'тело', null, null, [], locale];
}

test('pickTemplateLocale: точная локаль приоритетнее', () => {
  const rows = [{ locale: 'en' }, { locale: 'ru' }];
  assert.equal(pickTemplateLocale(rows, 'en')?.locale, 'en');
});

test('pickTemplateLocale: fallback на ru', () => {
  const rows = [{ locale: 'en' }, { locale: 'ru' }];
  assert.equal(pickTemplateLocale(rows, 'de')?.locale, 'ru');
});

test('pickTemplateLocale: fallback на любую доступную', () => {
  const rows = [{ locale: 'en' }];
  assert.equal(pickTemplateLocale(rows, 'de')?.locale, 'en');
  assert.equal(pickTemplateLocale(rows, undefined)?.locale, 'en');
});

test('pickTemplateLocale: пустой список → null', () => {
  assert.equal(pickTemplateLocale([], 'ru'), null);
});

test('loadTemplate по id находит строку', async () => {
  const db = recordingDb([[[...templateRow('ru', 'Сброс пароля')]]]);
  const loaded = await loadTemplate(db, { id: '00000000-0000-0000-0000-000000000001' });
  assert.equal(loaded?.subject, 'Сброс пароля');
  assert.equal(loaded?.locale, 'ru');
});

test('loadTemplate по id: нет строки → null', async () => {
  const db = recordingDb([[]]);
  assert.equal(await loadTemplate(db, { id: '00000000-0000-0000-0000-000000000001' }), null);
});

test('loadTemplate по code: точная локаль', async () => {
  const db = recordingDb([
    [
      [...templateRow('en', 'Reset')],
      [...templateRow('ru', 'Сброс')],
    ],
  ]);
  const loaded = await loadTemplate(db, { code: 'auth.password-reset' }, 'en');
  assert.equal(loaded?.subject, 'Reset');
});

test('loadTemplate по code: fallback на ru', async () => {
  const db = recordingDb([
    [
      [...templateRow('en', 'Reset')],
      [...templateRow('ru', 'Сброс')],
    ],
  ]);
  const loaded = await loadTemplate(db, { code: 'auth.password-reset' }, 'de');
  assert.equal(loaded?.subject, 'Сброс');
});

test('loadTemplate по code: fallback на любую доступную', async () => {
  const db = recordingDb([[[...templateRow('en', 'Reset')]]]);
  const loaded = await loadTemplate(db, { code: 'auth.password-reset' }, 'de');
  assert.equal(loaded?.subject, 'Reset');
});

test('loadTemplate по code: нет шаблона → null', async () => {
  const db = recordingDb([[]]);
  assert.equal(await loadTemplate(db, { code: 'auth.password-reset' }), null);
});
