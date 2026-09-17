#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(packageDir, 'src/frontend');
const roots = [path.join(srcDir, 'ui'), path.join(srcDir, 'hooks')];
const aliasRoots = {
  '@/ui': path.join(srcDir, 'ui'),
  '@/hooks': path.join(srcDir, 'hooks'),
  '@/lib': path.join(srcDir, 'lib'),
  '@/components': path.join(srcDir, 'components'),
};

const rawArgs = process.argv.slice(2);
const checkOnly = rawArgs.includes('--check');
const components = rawArgs.filter(arg => !arg.startsWith('-'));

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toRelativeSpecifier(fromFile, targetAbs) {
  const rel = path.relative(path.dirname(fromFile), targetAbs).split(path.sep).join('/');
  return `${rel.startsWith('.') ? rel : `./${rel}`}.js`;
}

function mapSpecifier(fromFile, specifier, problems) {
  const bare = specifier.replace(/\.(js|jsx|ts|tsx)$/, '');
  for (const [alias, root] of Object.entries(aliasRoots)) {
    if (bare === alias || bare.startsWith(`${alias}/`)) {
      const rest = bare === alias ? '' : bare.slice(alias.length + 1);
      if (!rest) {
        problems.push({ file: fromFile, specifier });
        return null;
      }
      return toRelativeSpecifier(fromFile, path.join(root, rest));
    }
  }
  if (bare.startsWith('@/')) {
    problems.push({ file: fromFile, specifier });
    return null;
  }
  return null;
}

const USE_CLIENT_RE = /^\s*(['"])use client\1;?\s*$/;

function stripUseClient(source) {
  const lines = source.split('\n');
  if (!USE_CLIENT_RE.test(lines[0] ?? '')) return source;
  lines.shift();
  while (lines[0]?.trim() === '') lines.shift();
  return lines.join('\n');
}

function rewriteImports(file, source, problems) {
  return source
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      const isModuleDecl =
        trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('}') || trimmed.startsWith('type ');
      if (!isModuleDecl) return line;
      return line.replace(/(from\s*|import\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => {
        if (!specifier.startsWith('@/')) return match;
        const mapped = mapSpecifier(file, specifier, problems);
        return mapped ? `${prefix}${quote}${mapped}${quote}` : match;
      });
    })
    .join('\n');
}

function normalize({ write }) {
  const problems = [];
  const changed = [];
  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const source = readFileSync(file, 'utf8');
      const next = stripUseClient(rewriteImports(file, source, problems));
      if (next !== source) {
        changed.push(path.relative(packageDir, file));
        if (write) writeFileSync(file, next, 'utf8');
      }
    }
  }
  return { changed, problems };
}

function runCodemod({ write }) {
  const { changed, problems } = normalize({ write });
  const label = write ? 'Rewritten' : 'Would rewrite';
  for (const file of changed) console.log(`  ${label}: ${file}`);
  if (!changed.length) console.log(`  ${write ? 'Rewritten' : 'Would rewrite'}: nothing`);
  if (problems.length) {
    console.error('\nUnresolved alias imports (shadcn registry escaped the configured aliases):');
    for (const { file, specifier } of problems) {
      console.error(`  ${path.relative(packageDir, file)}: ${specifier}`);
    }
    return 1;
  }
  if (checkOnly && changed.length) {
    console.error('\nVendored shadcn imports are not normalized. Run `pnpm ui:sync`.');
    return 1;
  }
  return 0;
}

function runCli() {
  const cli = path.join(packageDir, 'node_modules/shadcn/dist/index.js');
  const shimDir = mkdtempSync(path.join(tmpdir(), 'shadcn-nodeps-'));
  for (const name of ['pnpm', 'npm', 'yarn', 'bun', 'deno']) {
    const shim = path.join(shimDir, name);
    writeFileSync(shim, `#!/bin/sh\necho "shadcn-sync: intercepted dependency install: ${name} $*" >&2\nexit 0\n`, 'utf8');
    chmodSync(shim, 0o755);
  }
  const cliArgs = components.length ? components : ['--all'];
  console.log(`Running: shadcn add ${cliArgs.join(' ')} --yes --overwrite (dependency install intercepted)\n`);
  const result = spawnSync(process.execPath, [cli, 'add', ...cliArgs, '--yes', '--overwrite'], {
    cwd: packageDir,
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    stdio: 'inherit',
  });
  rmSync(shimDir, { recursive: true, force: true });
  return result.status ?? 1;
}

if (checkOnly && components.length) {
  console.error('--check cannot be combined with component names.');
  process.exit(2);
}

console.log('Normalizing vendored shadcn imports');
if (checkOnly) {
  process.exit(runCodemod({ write: false }));
}

if (runCli() !== 0) {
  console.error('\nshadcn add failed.');
  process.exit(1);
}

console.log('');
const status = runCodemod({ write: true });
if (status === 0) {
  console.log('\nDone. Review with `git diff`, then run typecheck/build.');
}
process.exit(status);
