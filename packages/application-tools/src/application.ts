import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { sortModules } from '@amplicada/platform-core/contracts';

export type Side = 'backend' | 'frontend';
const sides: Side[] = ['backend', 'frontend'];
interface ModulePart {
  export: string;
  dependencies: string[];
}
interface ModuleMetadata {
  id: string;
  name: string;
  requires: string[];
  backend?: ModulePart;
  frontend?: ModulePart;
  styles?: string;
}
interface SelectedModule {
  packageName: string;
  version: string;
  metadata: ModuleMetadata;
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
function metadataOf(pkg: Record<string, unknown>, name: string): ModuleMetadata {
  const raw = record(pkg.amplicada, `${name}.amplicada`);
  keys(raw, ['id', 'name', 'requires', 'backend', 'frontend', 'styles'], `${name}.amplicada`);
  const metadata: ModuleMetadata = {
    id: string(raw.id, `${name}.amplicada.id`),
    name: string(raw.name, `${name}.amplicada.name`),
    requires: strings(raw.requires ?? [], `${name}.amplicada.requires`),
  };
  const exports = record(pkg.exports, `${name}.exports`);
  for (const side of sides) {
    if (raw[side] === undefined) continue;
    const part = record(raw[side], `${name}.${side}`);
    keys(part, ['export', 'dependencies'], `${name}.${side}`);
    const symbol = string(part.export, `${name}.${side}.export`);
    if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) throw new Error(`Invalid export name ${name}.${side}: ${symbol}`);
    if (!exports[`./${side}`]) throw new Error(`${name} does not export ./${side}`);
    metadata[side] = { export: symbol, dependencies: strings(part.dependencies ?? [], `${name}.${side}.dependencies`) };
  }
  if (!metadata.backend && !metadata.frontend) throw new Error(`${name} must provide backend or frontend`);
  if (raw.styles !== undefined) {
    metadata.styles = string(raw.styles, `${name}.styles`);
    if (!metadata.frontend || metadata.styles !== './frontend/tailwind.css' || !exports[metadata.styles]) {
      throw new Error(`${name}.styles must reference its exported ./frontend/tailwind.css and requires frontend`);
    }
  }
  return metadata;
}

/** Reads package metadata without resolving compiled entry points or importing module code. */
async function installedPackage(name: string, appDirectory: string): Promise<Record<string, unknown> | undefined> {
  return (await packageLocation(name, appDirectory))?.pkg;
}

async function packageLocation(
  name: string,
  appDirectory: string,
): Promise<{ pkg: Record<string, unknown>; directory: string } | undefined> {
  if (!/^(?:@[a-z0-9_-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`Invalid module package name: ${name}`);
  const require = createRequire(join(appDirectory, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    const path = join(directory, name, 'package.json');
    try {
      const pkg = await readJson(path);
      if (pkg.name !== name) throw new Error(`${path}: expected package ${name}`);
      return { pkg, directory: await realpath(dirname(path)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

export async function planApplication(configPath: string): Promise<ApplicationPlan> {
  const config = await readJson(configPath);
  keys(config, ['id', 'modules', 'targets'], 'application');
  const id = string(config.id, 'application.id');
  const packages = strings(config.modules, 'application.modules');
  for (const name of packages) {
    if (!/^(?:@[a-z0-9_-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`Invalid module package name: ${name}`);
  }
  const targetConfig = record(config.targets, 'application.targets');
  keys(targetConfig, sides, 'application.targets');
  const targets: { side: Side; directory: string; pkg: Record<string, unknown> }[] = [];
  for (const side of sides) {
    if (targetConfig[side] === undefined) continue;
    const directory = resolve(dirname(configPath), string(targetConfig[side], `targets.${side}`));
    targets.push({ side, directory, pkg: await readJson(join(directory, 'package.json')) });
  }
  if (!targets.length) throw new Error('Application must have at least one target');

  const modules: SelectedModule[] = [];
  for (const name of packages) {
    const installed = await Promise.all(targets.map(target => installedPackage(name, target.directory)));
    const pkg = installed.find(candidate => candidate !== undefined);
    if (!pkg) throw new Error(`Module package ${name} is not installed. Declare it in the target package.json and run pnpm install.`);
    const metadata = metadataOf(pkg, name);
    const version = string(pkg.version, `${name}.version`);
    if (!targets.some(target => metadata[target.side])) throw new Error(`${name} has no part for this application's targets`);
    for (const [index, target] of targets.entries()) {
      if (!metadata[target.side]) continue;
      const dependencies = record(target.pkg.dependencies ?? {}, `${target.directory}.dependencies`);
      if (!dependencies[name]) throw new Error(`${name} must be declared in ${join(target.directory, 'package.json')} dependencies`);
      const targetPkg = installed[index];
      if (!targetPkg) throw new Error(`${name} is not installed for ${target.side}. Run pnpm install.`);
      if (targetPkg.version !== version || JSON.stringify(metadataOf(targetPkg, name)) !== JSON.stringify(metadata)) {
        throw new Error(`Module ${name} has different versions or metadata in application targets`);
      }
    }
    modules.push({ packageName: name, version, metadata });
  }

  return renderPlan(id, modules, targets);
}

function renderPlan(id: string, modules: SelectedModule[], targets: { side: Side; directory: string }[]): ApplicationPlan {
  // Application requirements can refer to a module that has only the other side.
  sortModules(
    modules.map(mod => ({
      id: mod.metadata.id,
      dependencies: mod.metadata.requires,
    })),
  );
  const files: GeneratedFile[] = [];
  const order: Record<Side, string[]> = { backend: [], frontend: [] };
  for (const target of targets) {
    const selected = sortModules(
      modules
        .filter(mod => mod.metadata[target.side])
        .map(mod => ({
          ...mod,
          id: mod.metadata.id,
          dependencies: mod.metadata[target.side]?.dependencies ?? [],
        })),
    );
    order[target.side] = selected.map(mod => mod.id);
    const type = target.side === 'backend' ? 'BackendModule' : 'FrontendModule';
    const imports = selected.map(
      (mod, index) => `import { ${mod.metadata[target.side]?.export} as module${index} } from '${mod.packageName}/${target.side}';`,
    );
    files.push({
      side: target.side,
      path: join(target.directory, `src/generated/${target.side}-modules.ts`),
      content: [
        '// Generated by amplicada-modules. Do not edit.',
        `import type { ${type} } from '@amplicada/platform-core/contracts/${target.side}';`,
        ...imports,
        '',
        `export const modules: ${type}[] = [${selected.map((_, index) => `module${index}`).join(', ')}];`,
        '',
      ].join('\n'),
    });
    if (target.side === 'frontend')
      files.push({
        side: target.side,
        path: join(target.directory, 'src/generated/modules.css'),
        content: [
          '/* Generated by amplicada-modules. Do not edit. */',
          ...selected.filter(mod => mod.metadata.styles).map(mod => `@import "${mod.packageName}/${mod.metadata.styles?.slice(2)}";`),
          '',
        ].join('\n'),
      });
  }
  return { id, modules, order, files };
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

/** Zero-config: activate direct production dependencies and their declared module requirements. */
export async function discoverApplication(appDirectory: string, side?: Side): Promise<ApplicationPlan> {
  appDirectory = resolve(appDirectory);
  const app = await readJson(join(appDirectory, 'package.json'));
  const activeSides = side ? [side] : sides;
  const selected: SelectedModule[] = [];
  const locations = new Map<string, { pkg: Record<string, unknown>; directory: string }>();
  const byId = new Map<string, SelectedModule>();

  async function add(name: string): Promise<SelectedModule | undefined> {
    const location = await packageLocation(name, appDirectory);
    if (!location) throw new Error(`Dependency ${name} is not installed for ${appDirectory}. Run pnpm install.`);
    if (location.pkg.amplicada === undefined) return undefined;
    const metadata = metadataOf(location.pkg, name);
    const existing = byId.get(metadata.id);
    if (existing) {
      if (existing.packageName !== name) throw new Error(`Duplicate module "${metadata.id}": ${existing.packageName}, ${name}`);
      return existing;
    }
    const mod = { packageName: name, version: string(location.pkg.version, `${name}.version`), metadata };
    locations.set(name, location);
    selected.push(mod);
    byId.set(metadata.id, mod);
    return mod;
  }

  // Never scan all of node_modules or activate modules merely because a dev tool uses them.
  for (const name of Object.keys(record(app.dependencies ?? {}, 'application.dependencies'))) await add(name);
  for (let index = 0; index < selected.length; index++) {
    const mod = selected[index];
    const location = locations.get(mod.packageName);
    if (!location) throw new Error(`Missing package metadata for ${mod.packageName}`);
    const required = [...new Set([...mod.metadata.requires, ...activeSides.flatMap(target => mod.metadata[target]?.dependencies ?? [])])];
    for (const id of required) {
      if (byId.has(id)) continue;
      const candidateNames = Object.keys({
        ...record(location.pkg.dependencies ?? {}, `${mod.packageName}.dependencies`),
        ...record(location.pkg.peerDependencies ?? {}, `${mod.packageName}.peerDependencies`),
      });
      let providerName: string | undefined;
      for (const name of candidateNames) {
        const candidate = await packageLocation(name, location.directory);
        if (!candidate || candidate.pkg.amplicada === undefined) continue;
        if (metadataOf(candidate.pkg, name).id !== id) continue;
        if (providerName && providerName !== name) throw new Error(`Ambiguous providers for module "${id}" required by ${mod.metadata.id}`);
        providerName = name;
      }
      if (!providerName)
        throw new Error(
          `Missing module dependency: ${mod.metadata.id} -> ${id}. Install its package and declare it in application dependencies.`,
        );
      // Static generated imports must also resolve from the app. A private nested dependency
      // isn't a public application dependency under pnpm's isolated node_modules layout.
      if (!(await packageLocation(providerName, appDirectory))) {
        throw new Error(
          `Module ${mod.metadata.id} requires ${providerName}; declare it in application dependencies so its entry point is importable.`,
        );
      }
      await add(providerName);
    }
  }
  return renderPlan(
    typeof app.name === 'string' ? app.name : 'application',
    selected,
    activeSides.map(target => ({ side: target, directory: appDirectory })),
  );
}
