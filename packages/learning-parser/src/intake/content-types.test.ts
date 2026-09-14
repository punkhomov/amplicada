import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentTypeFor, isAllowedPackageFile } from './content-types.js';

test('типы, без которых SCORM не заработает, отдаются верно', () => {
  // Неверный MIME на этих четырёх — самая частая причина «пакет не открывается».
  assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('scripts/main.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('styles/main.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('imsmanifest.xml'), 'application/xml; charset=utf-8');
});

test('регистр расширения не важен — архивы приходят с любым', () => {
  assert.equal(contentTypeFor('IMAGE.PNG'), 'image/png');
  assert.equal(contentTypeFor('Video.MP4'), 'video/mp4');
});

test('медиа и шрифты в whitelist — без них курс рендерится сломанным', () => {
  assert.equal(contentTypeFor('media/intro.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('audio/voice.mp3'), 'audio/mpeg');
  assert.equal(contentTypeFor('fonts/icons.woff2'), 'font/woff2');
});

test('исполняемое и неизвестное в пакет не пускается', () => {
  for (const path of ['setup.exe', 'lib.dll', 'script.sh', 'legacy.swf', 'noextension']) {
    assert.equal(contentTypeFor(path), undefined, `${path} не должен иметь типа`);
    assert.equal(isAllowedPackageFile(path), false);
  }
});

test('расширение берётся из имени файла, а не из каталога', () => {
  assert.equal(contentTypeFor('assets.js/readme.txt'), 'text/plain; charset=utf-8');
});
