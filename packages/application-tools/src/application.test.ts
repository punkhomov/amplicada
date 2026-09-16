import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { discoverApplication, planApplication, type Side, writeApplicationPlan } from './application.js';

const exec = promisify(execFile);
interface FixtureModule {
  name: string;
  backend?: boolean;
  frontend?: boolean;
  styles?: boolean;
  dependencies?: string[];
  peers?: string[];
  optionalPeers?: string[];
}
async function fixture(t: TestContext, modules: FixtureModule[], roots = modules.map(mod => mod.name)) {
  const directory = await mkdtemp(join(tmpdir(), 'amplicada-composition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'application.json');
  const appDirectory = join(directory, 'api');
  const deps = (names: string[]) => Object.fromEntries(names.map(name => [`@test/${name}`, '1.0.0']));
  for (const side of ['api', 'web']) {
    await mkdir(join(directory, side), { recursive: true });
    await writeFile(join(directory, side, 'package.json'), JSON.stringify({ dependencies: deps(roots) }));
  }
  for (const mod of modules) {
    const pkgDirectory = join(directory, 'node_modules/@test', mod.name);
    await mkdir(pkgDirectory, { recursive: true });
    await writeFile(
      join(pkgDirectory, 'package.json'),
      JSON.stringify({
        name: `@test/${mod.name}`,
        version: '1.0.0',
        amplicada: true,
        // No compiled code: discovery must work without importing entry points.
        exports: {
          ...(mod.backend ? { './backend': './dist/backend.js' } : {}),
          ...(mod.frontend ? { './frontend': './dist/frontend.js' } : {}),
          ...(mod.styles ? { './frontend/tailwind.css': './styles.css' } : {}),
        },
        dependencies: deps(mod.dependencies ?? []),
        peerDependencies: deps([...(mod.peers ?? []), ...(mod.optionalPeers ?? [])]),
        peerDependenciesMeta: Object.fromEntries((mod.optionalPeers ?? []).map(name => [`@test/${name}`, { optional: true }])),
      }),
    );
  }
  const select = async (names: string[]) =>
    writeFile(
      configPath,
      JSON.stringify({
        id: 'test-app',
        modules: names.map(name => `@test/${name}`),
        targets: { backend: './api', frontend: './web' },
      }),
    );
  await select(roots);
  const editPackage = async (name: string, change: (pkg: Record<string, unknown>) => void) => {
    const path = join(directory, 'node_modules/@test', name, 'package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    change(pkg);
    await writeFile(path, JSON.stringify(pkg));
  };
  return { directory, appDirectory, configPath, select, editPackage };
}
async function generate(configPath: string, side?: Side) {
  const plan = await planApplication(configPath);
  await writeApplicationPlan(plan, side);
  return plan;
}

test('orders explicitly installed modules by dependencies and required peers on both sides', async t => {
  const fx = await fixture(t, [
    { name: 'consumer', backend: true, frontend: true, styles: true, peers: ['provider'] },
    { name: 'provider', backend: true, frontend: true, dependencies: ['base'] },
    { name: 'base', backend: true },
  ]);
  const plan = await discoverApplication(fx.appDirectory);
  assert.deepEqual(plan.order, {
    backend: ['@test/base', '@test/provider', '@test/consumer'],
    frontend: ['@test/provider', '@test/consumer'],
  });
  await writeApplicationPlan(plan);
  const backend = await readFile(join(fx.appDirectory, 'src/generated/backend-modules.ts'), 'utf8');
  const frontend = await readFile(join(fx.appDirectory, 'src/generated/frontend-modules.ts'), 'utf8');
  const css = await readFile(join(fx.appDirectory, 'src/generated/modules.css'), 'utf8');
  assert.match(backend, /import \{ module as module0 \} from '@test\/base\/backend'/);
  assert.match(backend, /\.\.\.module2, dependencies: \[module1.id\]/);
  assert.doesNotMatch(backend, /\/frontend/);
  assert.doesNotMatch(frontend, /\/backend|@test\/base/);
  assert.match(frontend, /\.\.\.module1, dependencies: \[module0.id\]/);
  assert.match(css, /@test\/consumer\/frontend\/tailwind.css/);
  assert.doesNotMatch(css, /provider|base/);
});

test('preserves dependency order through a module with only the other runtime side', async t => {
  const fx = await fixture(t, [
    { name: 'consumer', frontend: true, dependencies: ['bridge'] },
    { name: 'bridge', backend: true, dependencies: ['provider'] },
    { name: 'provider', frontend: true },
  ]);
  const plan = await discoverApplication(fx.appDirectory, 'frontend');
  assert.deepEqual(plan.order.frontend, ['@test/provider', '@test/consumer']);
  assert.match(plan.files[0].content, /\.\.\.module1, dependencies: \[module0.id\]/);
});

test('skips ordinary libraries, optional peers, optional dependencies and dev-only modules', async t => {
  const fx = await fixture(
    t,
    [
      { name: 'auth', backend: true, optionalPeers: ['optional', 'absent'], dependencies: ['library'] },
      { name: 'optional', backend: true },
      { name: 'dev', backend: true },
      { name: 'library', backend: true, dependencies: ['dev'] },
    ],
    ['auth'],
  );
  await fx.editPackage('library', pkg => {
    delete pkg.amplicada;
  });
  await fx.editPackage('auth', pkg => {
    pkg.devDependencies = { '@test/dev': '1' };
    pkg.optionalDependencies = { '@test/optional': '1' };
  });
  const app = { dependencies: { '@test/auth': '1' }, devDependencies: { '@test/dev': '1' } };
  await writeFile(join(fx.appDirectory, 'package.json'), JSON.stringify(app));
  assert.deepEqual((await discoverApplication(fx.appDirectory)).order.backend, ['@test/auth']);
});

test('an explicitly selected optional peer runs before its consumer', async t => {
  const fx = await fixture(t, [
    { name: 'auth', backend: true, optionalPeers: ['optional'] },
    { name: 'optional', backend: true },
  ]);
  const plan = await discoverApplication(fx.appDirectory);
  assert.deepEqual(plan.order.backend, ['@test/optional', '@test/auth']);
  assert.match(plan.files[0].content, /\.\.\.module1, dependencies: \[module0.id\]/);
});

test('optional peers omitted from a profile do not activate and optional cycles fail explicitly', async t => {
  const fx = await fixture(t, [
    { name: 'auth', backend: true, optionalPeers: ['admin'] },
    { name: 'admin', backend: true, optionalPeers: ['auth'] },
  ]);
  await fx.select(['auth']);
  assert.deepEqual((await planApplication(fx.configPath)).order.backend, ['@test/auth']);
  await assert.rejects(discoverApplication(fx.appDirectory), /cycle:/);
});

test('a required module must be a direct application dependency even when installed transitively', async t => {
  const fx = await fixture(
    t,
    [
      { name: 'auth', backend: true, peers: ['admin'] },
      { name: 'admin', backend: true },
    ],
    ['auth'],
  );
  await assert.rejects(discoverApplication(fx.appDirectory), /requires @test\/admin.*declare it in application dependencies/);
});

test('regeneration is idempotent and removing an optional module clears its imports, order edge and CSS', async t => {
  const fx = await fixture(t, [
    { name: 'auth', backend: true, frontend: true, optionalPeers: ['admin'] },
    { name: 'admin', backend: true, frontend: true, styles: true },
  ]);
  const first = await discoverApplication(fx.appDirectory);
  await writeApplicationPlan(first);
  const before = await Promise.all(first.files.map(file => stat(file.path)));
  await writeApplicationPlan(await discoverApplication(fx.appDirectory));
  const after = await Promise.all(first.files.map(file => stat(file.path)));
  assert.deepEqual(
    after.map(s => s.mtimeMs),
    before.map(s => s.mtimeMs),
  );
  await writeFile(join(fx.appDirectory, 'package.json'), JSON.stringify({ dependencies: { '@test/auth': '1' } }));
  await writeApplicationPlan(await discoverApplication(fx.appDirectory));
  for (const file of first.files) assert.doesNotMatch(await readFile(file.path, 'utf8'), /@test\/admin|dependencies: \[module/);
});

test('cycles and missing dependencies fail before any output is changed', async t => {
  const fx = await fixture(t, [
    { name: 'a', backend: true, dependencies: ['b'] },
    { name: 'b', backend: true },
  ]);
  const original = await generate(fx.configPath);
  await fx.editPackage('b', pkg => {
    pkg.dependencies = { '@test/a': '1' };
  });
  await assert.rejects(generate(fx.configPath), /cycle: @test\/b -> @test\/a -> @test\/b|cycle: @test\/a -> @test\/b -> @test\/a/);
  await fx.editPackage('b', pkg => {
    pkg.dependencies = { '@test/missing': '1' };
  });
  await assert.rejects(generate(fx.configPath), /@test\/missing.*not installed/);
  for (const file of original.files) assert.equal(await readFile(file.path, 'utf8'), file.content);
});

test('rejects old object metadata and modules without a runtime export', async t => {
  const fx = await fixture(t, [{ name: 'a', backend: true }]);
  await fx.editPackage('a', pkg => {
    pkg.amplicada = { id: 'a' };
  });
  await assert.rejects(discoverApplication(fx.appDirectory), /amplicada must be true/);
  await fx.editPackage('a', pkg => {
    pkg.amplicada = true;
    pkg.exports = { './contracts': './contracts.js' };
  });
  await assert.rejects(discoverApplication(fx.appDirectory), /must export/);
});

test('rejects conflicting versions and private nested modules with actionable errors', async t => {
  const fx = await fixture(t, [
    { name: 'a', backend: true, dependencies: ['b'] },
    { name: 'b', backend: true },
  ]);
  const nested = join(fx.directory, 'node_modules/@test/a/node_modules/@test/b');
  await mkdir(nested, { recursive: true });
  await writeFile(
    join(nested, 'package.json'),
    JSON.stringify({ name: '@test/b', version: '2.0.0', amplicada: true, exports: { './backend': './backend.js' } }),
  );
  await assert.rejects(discoverApplication(fx.appDirectory), /Conflicting installations/);
  await fx.select(['a']);
  await assert.rejects(planApplication(fx.configPath), /@test\/b.*declare it in application dependencies/);
});

test('explicit profiles select a complete composition and reject missing required modules', async t => {
  const fx = await fixture(t, [
    { name: 'auth', backend: true, frontend: true, styles: true },
    { name: 'admin', backend: true, frontend: true },
    { name: 'consumer', backend: true, frontend: true, dependencies: ['provider'] },
    { name: 'provider', backend: true },
  ]);
  for (const name of ['full', 'minimal', 'full']) {
    await writeFile(fx.configPath, await readFile(new URL(`../test/fixtures/applications/${name}.json`, import.meta.url)));
    const plan = await generate(fx.configPath);
    assert.deepEqual(
      plan.order.backend,
      name === 'minimal' ? ['@test/auth', '@test/admin'] : ['@test/auth', '@test/admin', '@test/provider', '@test/consumer'],
    );
  }
  await fx.select(['consumer']);
  await assert.rejects(planApplication(fx.configPath), /requires @test\/provider.*include it in the selected composition/);
});

test('validates profile fields and declared roots and generates one requested side', async t => {
  const fx = await fixture(t, [{ name: 'a', backend: true }]);
  await generate(fx.configPath, 'backend');
  await assert.rejects(readFile(join(fx.directory, 'web/src/generated/frontend-modules.ts')), { code: 'ENOENT' });
  await fx.select(['a', 'a']);
  await assert.rejects(planApplication(fx.configPath), /duplicates/);
  await fx.select(['a']);
  await writeFile(join(fx.appDirectory, 'package.json'), '{}');
  await assert.rejects(planApplication(fx.configPath), /must be declared/);
  await writeFile(fx.configPath, JSON.stringify({ id: 'app', module: [] }));
  await assert.rejects(planApplication(fx.configPath), /Unknown application field/);
});

test('CLI discovers dependencies and changes composition only with explicit --config', async t => {
  const fx = await fixture(t, [
    { name: 'auth', backend: true },
    { name: 'admin', backend: true },
  ]);
  await fx.select(['auth']);
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, AMPLICADA_APP_CONFIG: fx.configPath };
  delete env.NODE_TEST_CONTEXT;
  const options = { cwd: fx.appDirectory, env };
  const generated = join(fx.appDirectory, 'src/generated/backend-modules.ts');
  await exec(process.execPath, [cli, '--target', 'backend', '--check'], options);
  await assert.rejects(readFile(generated), { code: 'ENOENT' });
  await exec(process.execPath, [cli, '--target', 'backend'], options);
  assert.match(await readFile(generated, 'utf8'), /@test\/admin/);
  await exec(process.execPath, [cli, '--target', 'backend', '--config', '../application.json'], options);
  assert.doesNotMatch(await readFile(generated, 'utf8'), /@test\/admin/);
});

test('CLI ignores packages visible only through NODE_PATH', async t => {
  const fx = await fixture(t, [{ name: 'auth', backend: true }]);
  const globalModules = join(fx.directory, 'global_modules');
  await mkdir(join(globalModules, '@test'), { recursive: true });
  await rename(join(fx.directory, 'node_modules/@test/auth'), join(globalModules, '@test/auth'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: globalModules };
  delete env.NODE_TEST_CONTEXT;
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  await assert.rejects(exec(process.execPath, [cli, '--check'], { cwd: fx.appDirectory, env }), { code: 1 });
  await assert.rejects(readFile(join(fx.appDirectory, 'src/generated/backend-modules.ts')), { code: 'ENOENT' });
});
