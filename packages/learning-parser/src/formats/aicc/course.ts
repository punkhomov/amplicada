import { issueError, issueWarning, type ValidationIssue } from '../../issue.js';
import { type Activity, firstLaunchable, withoutSequencing, withoutXapiTraits } from '../../model/activity.js';
import { parseDurationSeconds } from '../../model/duration.js';
import { tryResolveLaunch } from '../../model/launch.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { type Prerequisite, parsePrerequisites } from '../../model/prerequisite.js';
import { normalizeMastery } from '../../model/score.js';
import { parseCsv } from './csv.js';
import { parseIni } from './ini.js';
import { parseAiccObjectives } from './objectives.js';
import { parseAiccPrerequisiteFile, prerequisiteExpressionOf } from './prerequisites.js';
import { type AiccStructure, parseAiccStructure } from './structure.js';

/**
 * AICC — формат, который старше всех остальных и на XML не похож вовсе.
 *
 * Курс описан набором файлов с общим именем и разными расширениями: `.crs` (INI-подобный —
 * заголовок курса), `.au` (CSV — запускаемые единицы), `.des` (CSV — их названия), `.cst`
 * (структура). Опознаётся по `.crs` с секцией `[Course]`.
 *
 * Проигрывать AICC мы не умеем: обмен идёт по HACP — form-encoded POST'ы с session-ключом и
 * командами `GetParam`/`PutParam`, третий протокол рантайма, ни на что не похожий. Разбор от этого
 * не зависит: что делать с разобранным, решает потребитель.
 */

export interface AiccFiles {
  /** Содержимое `.crs` — без него пакет не AICC. */
  course: string;
  /** `.au` — запускаемые единицы. Без него запускать нечего. */
  assignableUnits: string | null;
  /** `.des` — названия единиц. Необязателен. */
  descriptors: string | null;
  /** `.cst` — структура курса. Необязателен: без него дерево плоское. */
  structure: string | null;
  /** `.pre` — условия открытия. Необязателен: чаще всего курс проходится подряд. */
  prerequisites: string | null;
  /** `.ort` — связи целей с единицами. Необязателен. */
  objectives: string | null;
}

export function isAiccCourseFile(content: string): boolean {
  // Секция `[Course]` — единственный надёжный признак: расширение `.crs` встречается и у чужих файлов.
  return /^\s*\[course\]/im.test(content);
}

export function parseAicc(files: AiccFiles, descriptorPath: string, issues: ValidationIssue[] = []): PackageMetadata {
  const course = parseIni(files.course);
  const section = course.get('course') ?? new Map<string, string>();

  const units = files.assignableUnits ? parseCsv(files.assignableUnits) : [];
  if (!units.length) {
    issues.push(issueError('aicc.au-missing', 'В AICC-пакете нет файла .au с запускаемыми единицами', descriptorPath));
  }

  const structure = files.structure ? parseAiccStructure(files.structure) : null;
  // Цели разбираются до дерева: у пункта на них ссылки, а проверить ссылку можно только зная,
  // какие единицы вообще объявлены.
  const objectives = parseAiccObjectives(files.objectives, unitIds(units), issues, descriptorPath);

  const context: BuildContext = {
    descriptors: parseDescriptors(files.descriptors),
    conditions: prerequisiteLookup(files.prerequisites, structure, issues, descriptorPath),
    objectiveRefs: objectives.byUnit,
    issues,
    descriptorPath,
  };

  const byId = new Map<string, Activity>();
  for (const [index, unit] of units.entries()) {
    const activity = toActivity(unit, index, context);
    byId.set(activity.identifier.toLowerCase(), activity);
  }

  const activities = structure ? assemble(structure, byId, context) : [...byId.values()];
  const entry = firstLaunchable(activities);

  return {
    format: 'aicc',
    descriptorPath,
    identifier: section.get('course_id') ?? section.get('course_creator') ?? null,
    schemaVersion: section.get('version') ?? null,
    title: section.get('course_title') ?? entry?.title ?? null,
    description: course.get('course_description')?.get('#text') ?? null,
    entryPoint: entry?.launch?.entryPoint ?? null,
    entryUrl: entry?.launch?.entryUrl ?? null,
    entryParameters: entry?.launch?.entryParameters ?? '',
    activities,
    details: {
      level: section.get('level') ?? null,
      courseSystem: section.get('course_system') ?? null,
      maxAttempts: numberOf(course.get('course_behavior')?.get('max_normal')),
      declaredUnits: numberOf(section.get('total_aus')),
      declaredBlocks: numberOf(section.get('total_blocks')),
      objectives: objectives.objectives,
    },
    // LOM в AICC не объявляется: формат старше его на десятилетие, и ожидаемого времени
    // прохождения в нём тоже нет — `max_time_allowed` на единице это лимит, а не оценка.
    lom: null,
    typicalLearningTimeSeconds: null,
    externalMetadata: [],
    // Вложенных описателей в AICC не бывает: структура задаётся `.cst` внутри одного набора файлов.
    subManifests: [],
    // Заполняет parsePackage по источнику — описатель этого не знает.
    fileCount: null,
    totalBytes: null,
    alsoDetected: [],
    // AICC описывает запуск и структуру, а не состав: перечня файлов в формате нет.
    declaredFiles: [],
    masteryScore: entry?.masteryScore ?? null,
  };
}

/** Общее для сборки дерева: то, что читается один раз на пакет, а нужно каждому пункту. */
interface BuildContext {
  descriptors: Map<string, AiccDescriptor>;
  conditions: PrerequisiteLookup;
  objectiveRefs: Map<string, string[]>;
  issues: ValidationIssue[];
  descriptorPath: string;
}

/** Идентификаторы единиц — те же, что достанутся пунктам, включая позиционные для строк без `system_id`. */
function unitIds(units: readonly Map<string, string>[]): Set<string> {
  return new Set(units.map((unit, index) => (unit.get('system_id') ?? `#${index}`).toLowerCase()));
}

function numberOf(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Условие открытия для элемента: `.pre`, колонка самой единицы, колонка `.cst` — в этом порядке.
 *
 * Приоритет не произвольный: `.pre` отведён под условия спецификацией, поэтому объявленное там —
 * это то, что автор написал нарочно, а колонки в `.au` и `.cst` дописывают сборщики.
 */
type PrerequisiteLookup = (identifier: string, row?: Map<string, string>) => Prerequisite | null;

function prerequisiteLookup(
  file: string | null,
  structure: AiccStructure | null,
  issues: ValidationIssue[],
  descriptorPath: string,
): PrerequisiteLookup {
  const fromFile = parseAiccPrerequisiteFile(file, issues, descriptorPath);
  const fromStructure = structure?.prerequisites;

  return (identifier, row) => {
    const key = identifier.toLowerCase();
    // `.pre` отдаёт готовое условие: там бывает не только выражение, но и запись рёбрами, которую
    // выражением не записать без риска переврать идентификатор с пробелом.
    const fromPre = fromFile.get(key);
    if (fromPre) return fromPre;

    const source = (row && prerequisiteExpressionOf(row)) ?? fromStructure?.get(key) ?? null;
    return parsePrerequisites(source, issues, `${descriptorPath}#${identifier}`);
  };
}

function toActivity(unit: Map<string, string>, index: number, context: BuildContext): Activity {
  const systemId = unit.get('system_id') ?? `#${index}`;
  const launch = unit.get('file_name') ?? unit.get('command_line');
  const where = `${context.descriptorPath}#${systemId}`;
  const issues = context.issues;
  const descriptor = context.descriptors.get(systemId.toLowerCase());

  if (!launch) {
    issues.push(issueWarning('aicc.launch-url-missing', `У единицы "${systemId}" нет колонки file_name — запускать нечего`, where));
  }

  const title = unit.get('title') ?? descriptor?.title ?? null;
  return {
    identifier: systemId,
    title,
    // Языков в AICC нет вовсе: файлы курса пишутся в одной кодировке и на одном языке, и объявить
    // второй перевод в CSV негде. Отсюда единственный ключ — «язык не объявлен».
    titles: labels(title),
    descriptions: labels(descriptor?.description ?? null),
    launch: launch ? launchOf(launch, unit.get('web_launch'), issues, where) : null,
    resourceId: null,
    visible: true,
    // В AICC проходной балл — проценты, как в SCORM 1.2.
    masteryScore: normalizeMastery(unit.get('mastery_score'), 'percent'),
    maxTimeSeconds: parseDurationSeconds(unit.get('max_time_allowed')),
    timeLimitAction: unit.get('time_limit_action') ?? null,
    // `core_vendor` в AICC — то же, что `cmi.launch_data` в SCORM: строка от автора самому курсу.
    launchData: unit.get('core_vendor') ?? null,
    prerequisites: context.conditions(systemId, unit),
    ...withoutSequencing(),
    ...withoutXapiTraits(),
    objectiveRefs: context.objectiveRefs.get(systemId.toLowerCase()) ?? [],
    children: [],
  };
}

function launchOf(file: string, webLaunch: string | undefined, issues: ValidationIssue[], where: string): Activity['launch'] {
  const target = tryResolveLaunch(file, 'Точка запуска AICC', issues, where);
  if (!target) return null;
  // `web_launch` несёт query-строку отдельно от имени файла — иначе она потерялась бы.
  return { ...target, entryParameters: mergeWebLaunch(target.entryParameters, webLaunch) };
}

/**
 * Сборка дерева из рёбер `.cst`. Участник — либо единица из `.au`, либо имя другого блока;
 * различаются по тому, нашлась ли единица с таким `system_id`.
 *
 * `seen` защищает от цикла: `.cst` — это список пар, и ничто в формате не мешает объявить блок
 * своим же потомком. Без защиты сборка ушла бы в бесконечную рекурсию на кривом пакете.
 */
function assemble(structure: AiccStructure, byId: Map<string, Activity>, context: BuildContext): Activity[] {
  const used = new Set<string>();

  const build = (name: string, seen: Set<string>): Activity | null => {
    const key = name.toLowerCase();
    if (seen.has(key)) return null;

    const unit = byId.get(key);
    if (unit) {
      used.add(key);
      return unit;
    }

    const members = structure.members.get(key);
    if (!members) return null;

    const nested = new Set(seen).add(key);
    const descriptor = context.descriptors.get(key);
    return {
      identifier: name,
      title: descriptor?.title ?? null,
      titles: labels(descriptor?.title ?? null),
      descriptions: labels(descriptor?.description ?? null),
      // Блок сам не запускается — это глава, а не единица.
      launch: null,
      resourceId: null,
      visible: true,
      masteryScore: null,
      maxTimeSeconds: null,
      timeLimitAction: null,
      launchData: null,
      // Условие бывает и на блоке: `.pre` перечисляет элементы структуры, а не только единицы.
      prerequisites: context.conditions(name),
      ...withoutSequencing(),
      ...withoutXapiTraits(),
      // Цели `.ort` привязываются к единицам, а не к блокам.
      objectiveRefs: [],
      children: members.map(member => build(member, nested)).filter((child): child is Activity => child !== null),
    };
  };

  const roots = structure.roots.map(name => build(name, new Set())).filter((node): node is Activity => node !== null);

  // Единицы, которых нет в структуре, теряться не должны: `.cst` в живых пакетах бывает неполным,
  // а незапущенная единица — это непройденный курс.
  const orphans = [...byId].filter(([key]) => !used.has(key)).map(([, activity]) => activity);
  return [...roots, ...orphans];
}

/** Строка `.des`: название и описание элемента курса — и единицы, и блока. */
interface AiccDescriptor {
  title: string | null;
  description: string | null;
}

/**
 * `.des` — названия и описания элементов курса. Для названия единицы это запасной вариант (своя
 * колонка `title` в `.au` главнее), для описания — единственный: в `.au` описания нет вовсе.
 */
function parseDescriptors(descriptors: string | null): Map<string, AiccDescriptor> {
  const byId = new Map<string, AiccDescriptor>();
  if (!descriptors) return byId;

  for (const row of parseCsv(descriptors)) {
    const id = row.get('system_id');
    if (!id) continue;
    byId.set(id.toLowerCase(), { title: row.get('title') ?? null, description: row.get('description') ?? null });
  }
  return byId;
}

/** Одноязычный словарь: в AICC объявить второй перевод негде, ключом остаётся «язык не объявлен». */
function labels(text: string | null): Record<string, string> {
  return text === null ? {} : { '': text };
}

function mergeWebLaunch(fromFile: string, webLaunch: string | undefined): string {
  if (!webLaunch) return fromFile;
  const suffix = webLaunch.startsWith('?') ? webLaunch : `?${webLaunch}`;
  if (!fromFile) return suffix;
  return fromFile.includes('?') ? `${fromFile}&${suffix.slice(1)}` : `${fromFile}${suffix}`;
}
