import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { sortModules } from '@amplicada/platform-core/contracts';

export type Side = 'backend' | 'frontend';
const sides: Side[] = ['backend', 'frontend'];
interface SelectedModule {
  packageName: string;
  version: string;
  dependencies: string[];
  backend: boolean;
  frontend: boolean;
  styles: boolean;
}
interface PackageLocation {
  pkg: Record<string, unknown>;
  directory: string;
}
export interface GeneratedFile {
  path: string;
  content: string;
  side: Side;
}
export interface ApplicationPlan {
  id: string;
  modules: SelectedModule[];
  order: Record<Side, string[]>;
  files: GeneratedFile[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const values = value.map(item => string(item, label));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
  return values;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field "${key}"`);
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  return record(JSON.parse(await readFile(path, 'utf8')), path);
}

/** Read metadata through the declaring package, without importing executable code. */
async function packageLocation(name: string, directory: string): Promise<PackageLocation | undefined> {
  if (!/^(?:@[a-z0-9_-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`Invalid package name: ${name}`);
  // Use local Node resolution only. pnpm's CLI launcher can inject NODE_PATH
  // entries that are not available to the generated application imports.
  for (let current = resolve(directory); ; current = dirname(current)) {
    try {
      if (basename(current) !== 'node_modules') {
        const path = join(current, 'node_modules', name, 'package.json');
        return { pkg: await readJson(path), directory: await realpath(dirname(path)) };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) break;
  }
  return undefined;
}

function metadataOf(pkg: Record<string, unknown>, name: string): SelectedModule | undefined {
  if (pkg.amplicada === undefined || pkg.amplicada === false) return undefined;
  if (pkg.amplicada !== true) throw new Error(`${name}: amplicada must be true; object manifests are no longer supported`);
  const exports = record(pkg.exports, `${name}.exports`);
  const mod = {
    packageName: name,
    version: string(pkg.version, `${name}.version`),
    dependencies: [] as string[],
    backend: Boolean(exports['./backend']),
    frontend: Boolean(exports['./frontend']),
    styles: Boolean(exports['./frontend/tailwind.css']),
  };
  if (!mod.backend && !mod.frontend) throw new Error(`${name} must export ./backend or ./frontend`);
  if (mod.styles && !mod.frontend) throw new Error(`${name}: ./frontend/tailwind.css requires ./frontend`);
  return mod;
}

function requiredPackages(pkg: Record<string, unknown>): string[] {
  const dependencies = record(pkg.dependencies ?? {}, 'dependencies');
  const optional = record(pkg.optionalDependencies ?? {}, 'optionalDependencies');
  const peers = record(pkg.peerDependencies ?? {}, 'peerDependencies');
  const peerMeta = record(pkg.peerDependenciesMeta ?? {}, 'peerDependenciesMeta');
  return [
    ...new Set([
      ...Object.keys(dependencies).filter(name => !(name in optional)),
      ...Object.keys(peers).filter(
        name => !(name in optional) && record(peerMeta[name] ?? {}, `peerDependenciesMeta.${name}`).optional !== true,
      ),
    ]),
  ];
}

async function collectModules(directory: string, roots?: string[]): Promise<SelectedModule[]> {
  const app = await readJson(join(directory, 'package.json'));
  const dependencies = record(app.dependencies ?? {}, 'application.dependencies');
  const selected = new Map<string, SelectedModule>();
  const locations = new Map<string, PackageLocation>();

  for (const name of roots ?? Object.keys(dependencies)) {
    if (!(name in dependencies)) throw new Error(`${name} must be declared in ${join(directory, 'package.json')} dependencies`);
    const location = await packageLocation(name, directory);
    if (!location) throw new Error(`Dependency ${name} is not installed for ${directory}. Run pnpm install.`);
    const mod = metadataOf(location.pkg, name);
    if (!mod) {
      if (roots) throw new Error(`${name} is not an Amplicada module (amplicada: true)`);
      continue;
    }
    selected.set(name, mod);
    locations.set(name, location);
  }

  for (const [name, location] of locations) {
    const required = requiredPackages(location.pkg);
    const peers = record(location.pkg.peerDependencies ?? {}, 'peerDependencies');
    // Optional peers add order only when explicitly selected by the application.
    const candidates = new Set([...required, ...Object.keys(peers).filter(peer => selected.has(peer))]);
    for (const dependency of candidates) {
      const provider = await packageLocation(dependency, location.directory);
      if (!provider) throw new Error(`Dependency ${dependency} is not installed for ${name}. Run pnpm install.`);
      if (!metadataOf(provider.pkg, dependency)) continue;
      const active = locations.get(dependency);
      if (!active) {
        throw new Error(
          `Module ${name} requires ${dependency}; declare it in application dependencies and include it in the selected composition`,
        );
      }
      if (active.directory !== provider.directory)
        throw new Error(`Conflicting installations of module ${dependency}; use one shared version and peer context`);
      selected.get(name)?.dependencies.push(dependency);
    }
  }
  return sortModules([...selected.values()].map(mod => ({ id: mod.packageName, dependencies: mod.dependencies, module: mod }))).map(
    node => node.module,
  );
}

function renderTarget(modules: SelectedModule[], side: Side, directory: string): GeneratedFile[] {
  const selected = modules.filter(mod => mod[side]);
  const indices = new Map(selected.map((mod, index) => [mod.packageName, index]));
  const byName = new Map(modules.map(mod => [mod.packageName, mod]));
  // Preserve ordering through a dependency that provides only the other runtime side.
  function predecessors(mod: SelectedModule): number[] {
    const result = new Set<number>();
    function visit(name: string): void {
      const index = indices.get(name);
      if (index !== undefined) result.add(index);
      else for (const dependency of byName.get(name)?.dependencies ?? []) visit(dependency);
    }
    for (const name of mod.dependencies) visit(name);
    return [...result];
  }
  const type = side === 'backend' ? 'BackendModule' : 'FrontendModule';
  const files: GeneratedFile[] = [
    {
      side,
      path: join(directory, `src/generated/${side}-modules.ts`),
      content: [
        '// Generated by amplicada-modules. Do not edit.',
        `import type { ${type} } from '@amplicada/platform-core/contracts/${side}';`,
        ...selected.map((mod, index) => `import { module as module${index} } from '${mod.packageName}/${side}';`),
        '',
        `export const modules: ${type}[] = [`,
        ...selected.map(
          (mod, index) =>
            `  { ...module${index}, dependencies: [${predecessors(mod)
              .map(provider => `module${provider}.id`)
              .join(', ')}] },`,
        ),
        '];',
        '',
      ].join('\n'),
    },
  ];
  if (side === 'frontend')
    files.push({
      side,
      path: join(directory, 'src/generated/modules.css'),
      content: [
        '/* Generated by amplicada-modules. Do not edit. */',
        ...selected.filter(mod => mod.styles).map(mod => `@import "${mod.packageName}/frontend/tailwind.css";`),
        '',
      ].join('\n'),
    });
  return files;
}

export async function discoverApplication(appDirectory: string, side?: Side): Promise<ApplicationPlan> {
  const directory = resolve(appDirectory);
  const app = await readJson(join(directory, 'package.json'));
  const modules = await collectModules(directory);
  const targets = side ? [side] : sides;
  return {
    id: typeof app.name === 'string' ? app.name : 'application',
    modules,
    order: {
      backend: targets.includes('backend') ? modules.filter(mod => mod.backend).map(mod => mod.packageName) : [],
      frontend: targets.includes('frontend') ? modules.filter(mod => mod.frontend).map(mod => mod.packageName) : [],
    },
    files: targets.flatMap(target => renderTarget(modules, target, directory)),
  };
}

/** An explicit profile selects the complete composition; required modules must be listed. */
export async function planApplication(configPath: string): Promise<ApplicationPlan> {
  const config = await readJson(configPath);
  keys(config, ['id', 'modules', 'targets'], 'application');
  const id = string(config.id, 'application.id');
  const roots = strings(config.modules, 'application.modules');
  const targets = record(config.targets, 'application.targets');
  keys(targets, sides, 'application.targets');
  const plan: ApplicationPlan = { id, modules: [], order: { backend: [], frontend: [] }, files: [] };
  for (const side of sides) {
    if (targets[side] === undefined) continue;
    const directory = resolve(dirname(configPath), string(targets[side], `targets.${side}`));
    const modules = await collectModules(directory, roots);
    for (const mod of modules) {
      const existing = plan.modules.find(other => other.packageName === mod.packageName);
      if (existing && JSON.stringify(existing) !== JSON.stringify(mod))
        throw new Error(`Module ${mod.packageName} has different versions or metadata in application targets`);
      if (!existing) plan.modules.push(mod);
    }
    plan.order[side] = modules.filter(mod => mod[side]).map(mod => mod.packageName);
    plan.files.push(...renderTarget(modules, side, directory));
  }
  if (!plan.files.length) throw new Error('Application must have at least one target');
  return plan;
}

export async function writeApplicationPlan(plan: ApplicationPlan, side?: Side): Promise<void> {
  const files = plan.files.filter(file => !side || file.side === side);
  if (!files.length) throw new Error(`Application ${plan.id} has no ${side} target`);
  for (const file of files) {
    let previous: string | undefined;
    try {
      previous = await readFile(file.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous === file.content) continue;
    await mkdir(dirname(file.path), { recursive: true });
    const temporary = `${file.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, file.content);
    await rename(temporary, file.path);
  }
}
