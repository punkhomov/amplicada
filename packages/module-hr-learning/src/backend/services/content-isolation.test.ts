import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy } from './content-isolation.js';

test('песочницы нет — она ломает поиск API в SCORM', () => {
  // Обход окон (`window` → `parent` → `top` → `opener`) работает только внутри одного origin: на
  // первом чужом окне драйвер получает SecurityError и сдаётся. Песочница обезличивает origin, то
  // есть делает чужими все окна пакета сразу.
  assert.ok(!contentSecurityPolicy().includes('sandbox'));
});

test('frame-ancestors запрещает встраивание чужим сайтам', () => {
  // Осмысленно ровно потому, что песочницы нет: origin у документа настоящий и `'self'` с ним
  // совпадает. В песочнице эта же директива запрещала бы любое встраивание, включая наше.
  assert.equal(contentSecurityPolicy(), "frame-ancestors 'self'");
});
