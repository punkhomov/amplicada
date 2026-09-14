import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { BackendDbService } from '../../contracts/backend/db.js';
import type { DocumentExtension } from '../../contracts/documents.js';
import { DocumentRegistryImpl } from '../documents.js';
import { DocumentRuntime } from './document-runtime.js';

/**
 * Две таблицы расширений одного документа. Своей таблицы у типа документа нет — она такое же
 * расширение, как и остальные (этап 3 плана 06). Реальных запросов нет: клиент подменён и только
 * записывает SQL.
 */
const owned = pgTable('probe_doc', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name'),
  isActive: boolean('is_active'),
});

const satellite = pgTable('probe_profile', {
  docId: uuid('doc_id').primaryKey(),
  phone: text('phone'),
});

interface RecordedQuery {
  text: string;
  values: unknown[];
}

/**
 * drizzle поверх клиента-заглушки: запросы не выполняются, а складываются в массив уже
 * отрендеренными. `responses[i]` — что вернуть на i-й запрос; drizzle просит `rowMode: 'array'`,
 * поэтому строка задаётся массивом значений в порядке SELECT/RETURNING. Ответы поштучно нужны там,
 * где ветка зависит от результата предыдущего запроса (UPDATE задел строку или нет).
 */
function recordingDb(responses: unknown[][][] = []): { db: BackendDbService; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    // biome-ignore lint/suspicious/noExplicitAny: минимальная заглушка pg-клиента
    query: async (config: any, params?: unknown[]) => {
      const text = typeof config === 'string' ? config : config.text;
      const rows = responses[queries.length] ?? [];
      queries.push({ text, values: (params ?? config?.values ?? []) as unknown[] });
      return { rows, rowCount: rows.length, fields: [] };
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: драйвер подменён, реального соединения нет
  return { db: drizzle({ client: client as any }) as unknown as BackendDbService, queries };
}

function setup(
  ext: Omit<DocumentExtension, 'document'>,
  responses: unknown[][][] = [],
): {
  runtime: DocumentRuntime;
  ext: DocumentExtension;
  db: BackendDbService;
  queries: RecordedQuery[];
} {
  const registry = new DocumentRegistryImpl();
  registry.register('probe', { module: 'test', label: 'Probe' });
  registry.objects.extend('probe', ext);
  const { db, queries } = recordingDb(responses);
  return {
    runtime: new DocumentRuntime(db, registry),
    ext: registry.objects.getExtensions('probe')[0],
    db,
    queries,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: saveExtension/loadExtension приватные — тест бьёт по границе поведения, а не по публичному API
type RuntimeInternals = any;

const ID = '00000000-0000-0000-0000-000000000001';

/** Одна задетая строка UPDATE'а: RETURNING отдаёт id. */
const ONE_ROW: unknown[][] = [[ID]];

test('расширение пишется UPDATE-ом, когда строка уже есть', async () => {
  const { runtime, ext, db, queries } = setup(
    { module: 'm', layout: {}, fields: { phone: { label: 'Phone' } }, schema: satellite, idColumn: 'docId' },
    [ONE_ROW],
  );

  await (runtime as RuntimeInternals).saveExtension(ext, db, ID, { phone: '+7' });

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /^update "probe_profile" set/);
  assert.match(queries[0].text, /returning "doc_id"$/);
  assert.deepEqual(queries[0].values, ['+7', ID]);
});

test('UPDATE задел 0 строк → INSERT: первая запись расширения иначе терялась бы молча', async () => {
  const { runtime, ext, db, queries } = setup({
    module: 'm',
    layout: {},
    fields: { phone: { label: 'Phone' } },
    schema: satellite,
    idColumn: 'docId',
  });

  await (runtime as RuntimeInternals).saveExtension(ext, db, ID, { phone: '+7' });

  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /^update "probe_profile" set/);
  assert.match(queries[1].text, /^insert into "probe_profile"/);
  // Голого `on conflict do update` здесь быть не должно: Postgres проверяет NOT NULL до разрешения
  // конфликта, а карточка при частичном сохранении присылает не все обязательные колонки.
  assert.doesNotMatch(queries[1].text, /on conflict/);
  assert.deepEqual(queries[1].values, [ID, '+7']);
});

test('в запись идут только колонки таблицы расширения', async () => {
  const { runtime, ext, db, queries } = setup({ module: 'm', layout: {}, fields: { code: { label: 'Code' } }, schema: owned }, [ONE_ROW]);

  await (runtime as RuntimeInternals).saveExtension(ext, db, ID, { code: 'C-1', phone: 'чужая колонка' });

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /^update "probe_doc" set "code"/);
  assert.doesNotMatch(queries[0].text, /phone/);
  assert.deepEqual(queries[0].values, ['C-1', ID]);
});

test('чтение расширения берёт строку его таблицы по idColumn', async () => {
  const { runtime, ext, db, queries } = setup({
    module: 'm',
    layout: {},
    fields: { phone: { label: 'Phone' } },
    schema: satellite,
    idColumn: 'docId',
  });

  await (runtime as RuntimeInternals).loadExtension(ext, db, ID);

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /^select .* from "probe_profile" where "probe_profile"\."doc_id" = \$1/);
});

test('пустой набор значений не порождает запроса', async () => {
  const { runtime, ext, db, queries } = setup({
    module: 'm',
    layout: {},
    fields: { phone: { label: 'Phone' } },
    schema: satellite,
    idColumn: 'docId',
  });

  await (runtime as RuntimeInternals).saveExtension(ext, db, ID, { unknownField: 1 });

  assert.equal(queries.length, 0);
});

test('расширение без таблицы (одна раскладка) в чужие таблицы не лезет', async () => {
  const { runtime, ext, db, queries } = setup({ module: 'm', layout: {} });

  await (runtime as RuntimeInternals).saveExtension(ext, db, ID, { code: 'C-1' });

  assert.equal(queries.length, 0);
});

test('findItemId спускается на два уровня — id объявлен полем расширения, а не корнем item', () => {
  const { runtime } = setup({ module: 'm', layout: {} });

  const id = (runtime as RuntimeInternals).findItemId({
    hr: { base: { code: 'C-1' }, extra: { id: ID } },
  });

  assert.equal(id, ID);
});

test('findItemId не принимает вложенный объект-значение за бакет расширения', () => {
  const { runtime } = setup({ module: 'm', layout: {} });

  // metadata — само поле (jsonb), а не бакет: его ключи не должны читаться как поля документа.
  const id = (runtime as RuntimeInternals).findItemId({ hr: { base: { metadata: { id: 'не тот id' } } } });

  assert.equal(id, undefined);
});

test('allocateDocumentId заводит строку индекса и отдаёт сгенерированный БД id', async () => {
  const { runtime, db, queries } = setup({ module: 'm', layout: {} }, [[[ID]]]);

  const allocated = await runtime.allocateDocumentId('probe', db);

  assert.equal(allocated, ID);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /^insert into "core"\."document_index"/);
  assert.match(queries[0].text, /returning "id"$/);
  // id не передаётся — на его месте `default`, то есть gen_random_uuid() самой таблицы.
  assert.match(queries[0].text, /values \(default, \$1/);
  assert.equal(queries[0].values[0], 'probe');
});

test('список читает из индекса, отбирает по типу и отсеивает удалённые', async () => {
  const registry = new DocumentRegistryImpl();
  registry.register('probe', { module: 'test', label: 'Probe' });
  registry.lists.extend('probe', { module: 'm', schema: owned, foreignKey: 'id', fields: { code: { label: 'Code' } } });
  const { db, queries } = recordingDb([[[0]]]);

  await new DocumentRuntime(db, registry).list('probe', {});

  // Первый запрос — count, второй — сама страница; проверяем оба: ни отбор по типу, ни фильтр
  // живости не должны потеряться, иначе total разъедется с содержимым.
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.match(q.text, /from "core"\."document_index"/);
    assert.match(q.text, /left join "probe_doc" on "probe_doc"\."id" = "core"\."document_index"\."id"/);
    assert.match(q.text, /"core"\."document_index"\."type" = \$1/);
    assert.match(q.text, /"core"\."document_index"\."deleted_at" is null/);
    assert.equal(q.values[0], 'probe');
  }
});

test('create заводит индекс, пишет расширения и отдаёт только id', async () => {
  const registry = new DocumentRegistryImpl();
  registry.register('probe', { module: 'test', label: 'Probe' });
  registry.objects.extend('probe', { module: 'm', layout: {}, schema: owned, fields: { code: { label: 'Code' } } });
  // begin → allocate (returning id) → update (0 строк) → insert → commit
  const { db, queries } = recordingDb([[], [[ID]]]);

  const created = await new DocumentRuntime(db, registry).create('probe', { m: { base: { code: 'C-1' } } });

  assert.deepEqual(created, { id: ID });
  const texts = queries.map(q => q.text);
  assert.deepEqual(texts[0], 'begin');
  assert.match(texts[1], /^insert into "core"\."document_index"/);
  assert.match(texts[2], /^update "probe_doc" set/);
  assert.match(texts[3], /^insert into "probe_doc"/);
  assert.deepEqual(texts[4], 'commit');
});

test('hard delete чистит расширения до индекса — их таблицы ссылаются на него FK', async () => {
  const registry = new DocumentRegistryImpl();
  registry.register('probe', { module: 'test', label: 'Probe' });
  registry.objects.extend('probe', { module: 'm', layout: {}, schema: owned, fields: { code: { label: 'Code' } } });
  const { db, queries } = recordingDb();

  await new DocumentRuntime(db, registry).delete('probe', ID);

  const texts = queries.map(q => q.text);
  assert.deepEqual(texts[0], 'begin');
  assert.match(texts[1], /^delete from "probe_doc"/);
  assert.match(texts[2], /^delete from "core"\."document_index"/);
  assert.deepEqual(texts[3], 'commit');
});
