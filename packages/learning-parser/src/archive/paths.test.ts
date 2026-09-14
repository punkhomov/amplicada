import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionOf, isDirectoryEntry, normalizePackagePath, resolveRelativePath, stripQueryAndFragment } from './paths.js';

test('обычные пути проходят и приводятся к каноничному виду', () => {
  assert.equal(normalizePackagePath('index.html'), 'index.html');
  assert.equal(normalizePackagePath('assets/js/main.js'), 'assets/js/main.js');
  assert.equal(normalizePackagePath('./index.html'), 'index.html');
  assert.equal(normalizePackagePath('a//b///c.png'), 'a/b/c.png');
  assert.equal(normalizePackagePath('a/./b/./c.css'), 'a/b/c.css');
});

test('windows-разделители приводятся к прямым слэшам', () => {
  // Архивы, собранные на Windows, реально содержат обратные слэши в путях записей.
  assert.equal(normalizePackagePath('assets\\js\\main.js'), 'assets/js/main.js');
});

test('zip-slip: любой .. отвергается, а не схлопывается', () => {
  assert.equal(normalizePackagePath('../evil.html'), null);
  assert.equal(normalizePackagePath('a/../../evil.html'), null);
  assert.equal(normalizePackagePath('a/../b.html'), null, 'даже безобидный на вид .. — признак вредоносного пакета');
  assert.equal(normalizePackagePath('assets\\..\\..\\evil.js'), null);
});

test('абсолютные пути и UNC отвергаются', () => {
  assert.equal(normalizePackagePath('/etc/passwd'), null);
  assert.equal(normalizePackagePath('//server/share/file'), null);
  assert.equal(normalizePackagePath('C:/Windows/system32'), null);
  assert.equal(normalizePackagePath('c:evil.txt'), null);
  assert.equal(normalizePackagePath('C:\\Windows\\evil.dll'), null);
});

test('пустое, нулевой байт и «только точки» отвергаются', () => {
  assert.equal(normalizePackagePath(''), null);
  assert.equal(normalizePackagePath('.'), null);
  assert.equal(normalizePackagePath('./'), null);
  assert.equal(normalizePackagePath('a\0b'), null);
});

test('каталоги архива распознаются и в инвентарь не идут', () => {
  assert.equal(isDirectoryEntry('assets/'), true);
  assert.equal(isDirectoryEntry('assets\\'), true);
  assert.equal(isDirectoryEntry('assets/main.js'), false);
});

test('расширение берётся из имени файла, а не из пути', () => {
  assert.equal(extensionOf('a.dir/index.html'), 'html');
  assert.equal(extensionOf('IMAGE.PNG'), 'png');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf('.htaccess'), '', 'точка в начале — скрытый файл, а не расширение');
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
});

test('query и фрагмент из href манифеста отбрасываются', () => {
  assert.equal(stripQueryAndFragment('index.html?course=1'), 'index.html');
  assert.equal(stripQueryAndFragment('index.html#top'), 'index.html');
  assert.equal(stripQueryAndFragment('index.html?a=1#top'), 'index.html');
  assert.equal(stripQueryAndFragment('index.html'), 'index.html');
});

test('resolveRelativePath схлопывает `..`, а normalizePackagePath отвергает', () => {
  // Разница принципиальная: `..` в имени записи архива — это zip-slip, а в href манифеста —
  // штатная ссылка вверх относительно xml:base.
  assert.equal(resolveRelativePath('modules/intro/../../shared/player.html'), 'shared/player.html');
  assert.equal(normalizePackagePath('modules/intro/../../shared/player.html'), null);
});

test('resolveRelativePath не выпускает за корень пакета', () => {
  assert.equal(resolveRelativePath('../outside.html'), null);
  assert.equal(resolveRelativePath('a/../../outside.html'), null);
  assert.equal(resolveRelativePath('/absolute.html'), null);
  assert.equal(resolveRelativePath('C:/windows/win.ini'), null);
  assert.equal(resolveRelativePath('a/\0b'), null);
  assert.equal(resolveRelativePath('a/..'), null, 'схлопнулось в пустоту — файла нет');
});

test('resolveRelativePath чистит `.` и лишние слэши, как и нормализация', () => {
  assert.equal(resolveRelativePath('./a//b/./c.html'), 'a/b/c.html');
  assert.equal(resolveRelativePath(String.raw`a\b\c.html`), 'a/b/c.html');
});
