import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ISSUE_CODES, issueError, issueWarning, type ValidationIssue } from './issue.js';
import { applyPolicy } from './options.js';

const SAMPLE: ValidationIssue[] = [
  issueError('common.no-launchable', 'нечего запускать', 'imsmanifest.xml'),
  issueWarning('scorm.orphaned-resource', 'ресурс никому не нужен', 'imsmanifest.xml#r1'),
  issueError('common.file-missing', 'файла нет', 'imsmanifest.xml#index.html'),
];

function levels(issues: readonly ValidationIssue[]): string[] {
  return issues.map(issue => `${issue.severity}:${issue.code}`);
}

test('без опций отчёт остаётся прежним', () => {
  assert.deepEqual(applyPolicy(SAMPLE), SAMPLE);
  assert.deepEqual(applyPolicy(SAMPLE, {}), SAMPLE);
});

test('strict поднимает всё до ошибок', () => {
  assert.deepEqual(levels(applyPolicy(SAMPLE, { strictness: 'strict' })), [
    'error:common.no-launchable',
    'error:scorm.orphaned-resource',
    'error:common.file-missing',
  ]);
});

test('lenient не оставляет ошибок вовсе', () => {
  const relaxed = applyPolicy(SAMPLE, { strictness: 'lenient' });
  assert.equal(
    relaxed.every(issue => issue.severity === 'warning'),
    true,
  );
});

test('disableRules убирает находку целиком, а не понижает её', () => {
  const kept = applyPolicy(SAMPLE, { disableRules: ['common.file-missing'] });
  assert.deepEqual(levels(kept), ['error:common.no-launchable', 'warning:scorm.orphaned-resource']);
});

test('опечатка в disableRules — исключение, а не тишина', () => {
  // Молчание здесь выглядело бы как «правило не сработало», и искать причину пошли бы в разборщик.
  assert.throws(
    // @ts-expect-error — проверяется поведение в рантайме: код мог прийти из конфига, а не из литерала.
    () => applyPolicy(SAMPLE, { disableRules: ['common.file-missng'] }),
    /Неизвестные коды правил/,
  );
});

test('находки, которых политика не касается, не копируются', () => {
  // Не оптимизация, а свойство: потребитель вправе сравнивать находки по ссылке.
  const kept = applyPolicy(SAMPLE, { disableRules: ['common.file-missing'] });
  assert.equal(kept[0], SAMPLE[0]);
});

test('перечень ISSUE_CODES полон и не содержит лишнего', async () => {
  // Список руками — значит рано или поздно разойдётся с кодом. Сверяем с исходниками: тесты идут
  // по `dist`, а `src` лежит в корне пакета.
  const source = join(import.meta.dirname, '..', 'src');
  const used = new Set<string>();

  for (const file of await filesIn(source)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('issue.ts')) continue;
    const text = await readFile(file, 'utf8');
    // Только файлы, которые вообще умеют завести находку. Иначе в улов попадают строки вроде
    // `cmi5.xml` — это имя описателя, а не код.
    if (!/from '(?:\.\.\/)*issue\.js'/.test(text)) continue;
    for (const [, code] of text.matchAll(/'((?:common|scorm|cmi5|xapi|aicc)\.[a-z][a-z-]*)'/g)) used.add(code);
  }

  const declared = new Set<string>(ISSUE_CODES);
  assert.deepEqual([...used].filter(code => !declared.has(code)).sort(), [], 'коды есть в коде, но не в перечне');
  assert.deepEqual([...declared].filter(code => !used.has(code)).sort(), [], 'коды есть в перечне, но не в коде');
});

async function filesIn(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await filesIn(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
