// Собирает единый VitePress-корень из packages/*/docs, сохраняя дерево
// `packages/<pkg>/docs/...` — поэтому относительные ссылки внутри docs
// (включая кросс-пакетные вида ../../../platform-core/docs/...) работают без переписывания.
// Запуск: `node assemble.mjs` (вызывается из docs:dev / docs:build).
// Результат gitignore-ится: content/packages/, content/.vitepress/{dist,cache}.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outRoot = join(here, 'content', 'packages');

const entries = await readdir(join(repoRoot, 'packages'), { withFileTypes: true });
await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

let copied = 0;
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const src = join(repoRoot, 'packages', entry.name, 'docs');
  try {
    await cp(src, join(outRoot, entry.name, 'docs'), { recursive: true });
    copied++;
    console.log(`docs-site: ${entry.name}/docs -> content/packages/${entry.name}/docs`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
console.log(`docs-site: assembled ${copied} packages`);
