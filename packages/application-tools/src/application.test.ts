import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { discoverApplication, planApplication, type Side, writeApplicationPlan } from './application.js';

async function generateApplication(configPath: string, side?: Side) {
  const plan = await planApplication(configPath);
  await writeApplicationPlan(plan, side);
  return plan;
}

const exec = promisify(execFile);

interface FixtureModule {
  id: string;
  requires?: string[];
  backend?: { export: string; dependencies?: string[] };
  frontend?: { export: string; dependencies?: string[] };
  styles?: string;
}
async function fixture(t: TestContext, modules: FixtureModule[]) {
  const directory = await mkdtemp(join(tmpdir(), 'amplicada-composition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'application.json');
  const dependencies = Object.fromEntries(modules.map(mod => [`@test/${mod.id}`, '1.0.0']));
  for (const target of ['api', 'web']) {
    await mkdir(join(directory, target), { recursive: true });
    await writeFile(join(directory, target, 'package.json'), JSON.stringify({ dependencies }));
  }
  for (const mod of modules) {
    const packageDirectory = join(directory, 'node_modules/@test', mod.id);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: `@test/${mod.id}`,
        version: '1.0.0',
        // No compiled files exist: planning must not import module code.
        exports: { './backend': './dist/backend.js', './frontend': './dist/frontend.js', './frontend/tailwind.css': './src/styles.css' },
        amplicada: { name: mod.id, ...mod },
      }),
    );
  }
  const select = async (ids: string[]) =>
    writeFile(
      configPath,
      JSON.stringify({
        id: 'test-app',
        modules: ids.map(id => `@test/${id}`),
        targets: { backend: './api', frontend: './web' },
      }),
    );
  await select(modules.map(mod => mod.id));
  return { directory, configPath, select };
}

test('generates isolated static imports, dependencies and styles without built packages', async t => {
  const fx = await fixture(t, [
    {
      id: 'consumer',
      backend: { export: 'consumer', dependencies: ['provider'] },
      frontend: { export: 'consumerUI' },
      styles: './frontend/tailwind.css',
    },
    { id: 'provider', backend: { export: 'provider' } },
    { id: 'ui-only', frontend: { export: 'uiOnly' } },
  ]);
  const plan = await generateApplication(fx.configPath);
  assert.deepEqual(plan.order, { backend: ['provider', 'consumer'], frontend: ['consumer', 'ui-only'] });
  const backend = await readFile(join(fx.directory, 'api/src/generated/backend-modules.ts'), 'utf8');
  const frontend = await readFile(join(fx.directory, 'web/src/generated/frontend-modules.ts'), 'utf8');
  const css = await readFile(join(fx.directory, 'web/src/generated/modules.css'), 'utf8');
  assert.match(backend, /provider as module0/);
  assert.doesNotMatch(backend, /frontend|ui-only/);
  assert.doesNotMatch(frontend, /backend|provider/);
  assert.match(css, /@test\/consumer\/frontend\/tailwind.css/);
  assert.doesNotMatch(css, /provider|ui-only/);
});

test('regeneration is idempotent and removal clears all stale generated imports and styles', async t => {
  const fx = await fixture(t, [{ id: 'a', backend: { export: 'a' }, frontend: { export: 'aUI' }, styles: './frontend/tailwind.css' }]);
  const first = await generateApplication(fx.configPath);
  const before = await Promise.all(first.files.map(file => stat(file.path)));
  await generateApplication(fx.configPath);
  const after = await Promise.all(first.files.map(file => stat(file.path)));
  assert.deepEqual(
    after.map(file => file.mtimeMs),
    before.map(file => file.mtimeMs),
  );
  await fx.select([]);
  const empty = await generateApplication(fx.configPath);
  assert.deepEqual(empty.order, { backend: [], frontend: [] });
  for (const file of empty.files) assert.doesNotMatch(await readFile(file.path, 'utf8'), /@test\/a/);
});

test('invalid composition fails before overwriting generated files', async t => {
  const fx = await fixture(t, [
    { id: 'a', backend: { export: 'a', dependencies: ['b'] } },
    { id: 'b', backend: { export: 'b' } },
  ]);
  const original = await generateApplication(fx.configPath);
  await fx.select(['a']);
  await assert.rejects(generateApplication(fx.configPath), /a -> b/);
  for (const file of original.files) assert.equal(await readFile(file.path, 'utf8'), file.content);
});

test('rejects duplicate packages and module dependency cycles', async t => {
  const fx = await fixture(t, [
    { id: 'a', backend: { export: 'a', dependencies: ['b'] } },
    { id: 'b', backend: { export: 'b', dependencies: ['a'] } },
  ]);
  await assert.rejects(planApplication(fx.configPath), /cycle: a -> b -> a/);
  await fx.select(['a', 'a']);
  await assert.rejects(planApplication(fx.configPath), /duplicates/);
});

test('distinguishes application requirements from a dependency on the same runtime side', async t => {
  const fx = await fixture(t, [
    { id: 'ui', requires: ['api'], frontend: { export: 'ui' } },
    { id: 'api', backend: { export: 'api' } },
  ]);
  assert.deepEqual((await planApplication(fx.configPath)).order, { backend: ['api'], frontend: ['ui'] });
  const path = join(fx.directory, 'node_modules/@test/ui/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.amplicada.frontend.dependencies = ['api'];
  await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(planApplication(fx.configPath), /ui -> api/);
});

test('rejects undeclared or uninstalled packages with actionable errors', async t => {
  const fx = await fixture(t, [{ id: 'a', backend: { export: 'a' } }]);
  await writeFile(join(fx.directory, 'api/package.json'), JSON.stringify({ dependencies: {} }));
  await assert.rejects(planApplication(fx.configPath), /must be declared.*api\/package.json/);
  await fx.select(['missing']);
  await assert.rejects(planApplication(fx.configPath), /not installed/);
});

test('validates metadata and does not accept misspelled configuration fields', async t => {
  const fx = await fixture(t, [{ id: 'a', frontend: { export: 'a' } }]);
  const config = JSON.parse(await readFile(fx.configPath, 'utf8'));
  config.module = [];
  await writeFile(fx.configPath, JSON.stringify(config));
  await assert.rejects(planApplication(fx.configPath), /Unknown application field "module"/);
  delete config.module;
  await writeFile(fx.configPath, JSON.stringify(config));
  const path = join(fx.directory, 'node_modules/@test/a/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.amplicada.frontend.export = 'broken;import';
  await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(planApplication(fx.configPath), /Invalid export name/);
});

test('supports a single backend target and writes only the requested side', async t => {
  const fx = await fixture(t, [{ id: 'a', backend: { export: 'a' } }]);
  await generateApplication(fx.configPath, 'backend');
  await assert.rejects(readFile(join(fx.directory, 'web/src/generated/frontend-modules.ts')), { code: 'ENOENT' });
  const config = JSON.parse(await readFile(fx.configPath, 'utf8'));
  delete config.targets.frontend;
  await writeFile(fx.configPath, JSON.stringify(config));
  assert.equal((await planApplication(fx.configPath)).files.length, 1);
  await assert.rejects(generateApplication(fx.configPath, 'frontend'), /no frontend target/);
});

test('explicit profiles select installed modules independently of the demo apps', async t => {
  const fx = await fixture(t, [
    { id: 'auth', backend: { export: 'auth' }, frontend: { export: 'authUI' }, styles: './frontend/tailwind.css' },
    { id: 'admin', backend: { export: 'admin' }, frontend: { export: 'adminUI' } },
    {
      id: 'consumer',
      backend: { export: 'consumer', dependencies: ['provider'] },
      frontend: { export: 'consumerUI' },
      styles: './frontend/tailwind.css',
    },
    { id: 'provider', backend: { export: 'provider' } },
  ]);
  for (const name of ['full', 'minimal', 'full']) {
    const profile = await readFile(new URL(`../test/fixtures/applications/${name}.json`, import.meta.url), 'utf8');
    await writeFile(fx.configPath, profile);
    const plan = await generateApplication(fx.configPath);
    assert.deepEqual(
      plan.order,
      name === 'minimal'
        ? { backend: ['auth', 'admin'], frontend: ['auth', 'admin'] }
        : { backend: ['auth', 'admin', 'provider', 'consumer'], frontend: ['auth', 'admin', 'consumer'] },
    );
    for (const file of plan.files) {
      assert.equal(await readFile(file.path, 'utf8'), file.content);
      if (name === 'minimal') assert.doesNotMatch(file.content, /@test\/(consumer|provider)/);
    }
  }
});

test('backend and frontend dependency graphs are independent', async t => {
  const fx = await fixture(t, [
    { id: 'a', backend: { export: 'a', dependencies: ['b'] }, frontend: { export: 'aUI' } },
    { id: 'b', backend: { export: 'b' }, frontend: { export: 'bUI', dependencies: ['a'] } },
  ]);
  assert.deepEqual((await planApplication(fx.configPath)).order, { backend: ['b', 'a'], frontend: ['a', 'b'] });
});

test('different packages cannot register the same module id', async t => {
  const fx = await fixture(t, [
    { id: 'a', backend: { export: 'a' } },
    { id: 'b', backend: { export: 'b' } },
  ]);
  const path = join(fx.directory, 'node_modules/@test/b/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.amplicada.id = 'a';
  await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(planApplication(fx.configPath), /Duplicate module "a"/);
});

test('zero-config discovers production dependencies, skips ordinary packages and dev-only modules', async t => {
  const fx = await fixture(t, [
    { id: 'auth', backend: { export: 'auth' }, frontend: { export: 'authUI' }, styles: './frontend/tailwind.css' },
    { id: 'dev-only', backend: { export: 'dev' } },
  ]);
  await rm(fx.configPath);
  const appDirectory = join(fx.directory, 'api');
  await mkdir(join(fx.directory, 'node_modules/ordinary'), { recursive: true });
  await writeFile(join(fx.directory, 'node_modules/ordinary/package.json'), JSON.stringify({ name: 'ordinary', version: '1' }));
  await writeFile(
    join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'external-app',
      dependencies: { '@test/auth': '1', ordinary: '1' },
      devDependencies: { '@test/dev-only': '1' },
    }),
  );
  const plan = await discoverApplication(appDirectory);
  assert.deepEqual(plan.order, { backend: ['auth'], frontend: ['auth'] });
  await writeApplicationPlan(plan);
  assert.equal(plan.files.length, 3);
  assert.match(await readFile(join(appDirectory, 'src/generated/backend-modules.ts'), 'utf8'), /@test\/auth\/backend/);
  assert.match(await readFile(join(appDirectory, 'src/generated/frontend-modules.ts'), 'utf8'), /@test\/auth\/frontend/);
  assert.match(await readFile(join(appDirectory, 'src/generated/modules.css'), 'utf8'), /@test\/auth\/frontend\/tailwind.css/);
  await writeFile(join(appDirectory, 'package.json'), JSON.stringify({ dependencies: { ordinary: '1' } }));
  await writeApplicationPlan(await discoverApplication(appDirectory));
  for (const file of plan.files) assert.doesNotMatch(await readFile(file.path, 'utf8'), /@test\/auth/);
});

test('zero-config enables an importable required peer module but not an optional module', async t => {
  const fx = await fixture(t, [
    { id: 'consumer', backend: { export: 'consumer', dependencies: ['provider'] } },
    { id: 'provider', backend: { export: 'provider' } },
    { id: 'optional', backend: { export: 'optional' } },
  ]);
  await writeFile(join(fx.directory, 'api/package.json'), JSON.stringify({ dependencies: { '@test/consumer': '1' } }));
  const path = join(fx.directory, 'node_modules/@test/consumer/package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  pkg.peerDependencies = { '@test/provider': '1', '@test/optional': '1' };
  await writeFile(path, JSON.stringify(pkg));
  assert.deepEqual((await discoverApplication(join(fx.directory, 'api'), 'backend')).order.backend, ['provider', 'consumer']);
});

test('CLI discovers dependencies by default and accepts a profile only through --config', async t => {
  const fx = await fixture(t, [
    { id: 'auth', backend: { export: 'auth' } },
    { id: 'admin', backend: { export: 'admin' } },
  ]);
  await fx.select(['auth']);
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  const appDirectory = join(fx.directory, 'api');
  const env: NodeJS.ProcessEnv = { ...process.env, AMPLICADA_APP_CONFIG: fx.configPath };
  // The CLI is a normal child process, not another Node test-runner worker.
  delete env.NODE_TEST_CONTEXT;
  const options = {
    cwd: appDirectory,
    env,
  };
  await exec(process.execPath, [cli, '--target', 'backend', '--check'], options);
  await assert.rejects(readFile(join(appDirectory, 'src/generated/backend-modules.ts')), { code: 'ENOENT' });
  await exec(process.execPath, [cli, '--target', 'backend'], options);
  const discovered = await readFile(join(appDirectory, 'src/generated/backend-modules.ts'), 'utf8');
  assert.match(discovered, /@test\/auth\/backend/);
  assert.match(discovered, /@test\/admin\/backend/);
  await exec(process.execPath, [cli, '--target', 'backend', '--config', '../application.json'], options);
  const generated = await readFile(join(appDirectory, 'src/generated/backend-modules.ts'), 'utf8');
  assert.match(generated, /@test\/auth\/backend/);
  assert.doesNotMatch(generated, /@test\/admin/);
});
