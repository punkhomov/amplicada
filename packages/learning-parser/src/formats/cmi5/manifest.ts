import { issueError, issueWarning, type ValidationIssue } from '../../issue.js';
import { type Activity, firstLaunchable, withoutSequencing } from '../../model/activity.js';
import type { Cmi5ContextTemplate, Cmi5Objective, MoveOn } from '../../model/details.js';
import { parseDurationSeconds } from '../../model/duration.js';
import { tryResolveLaunch } from '../../model/launch.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { normalizeMastery } from '../../model/score.js';
import { array, asText, attr, child, labelOf, labelsOf, textOf, type XmlNode } from '../../xml/nodes.js';
import { createXmlReader } from '../../xml/parser.js';
import { CMI5_FILENAME } from '../descriptors.js';

/**
 * cmi5 — `cmi5.xml`, «course structure».
 *
 * Формат описывает курс как дерево из блоков (`<block>`) и запускаемых единиц (`<au>`); у каждой
 * AU свой `<url>`, который может вести и внутрь пакета, и на чужой сервер.
 *
 * Проигрывать cmi5 мы не умеем: результаты уходят statement'ами в LRS, а `LMS.LaunchData` и
 * настройки учащегося — это документы State API. Разбор от этого не зависит и делается полностью:
 * что с ним делать, решает потребитель.
 */

/**
 * `<au>` и `<block>` строят дерево курса, `<langstring>` повторяется по одному на язык. `activity`
 * и `extension` — из `<contextTemplate>`, где они тоже повторяемы.
 */
const reader = createXmlReader(['au', 'block', 'langstring', 'objective', 'alternative', 'activity', 'extension']);

/** Четыре области `contextActivities` из xAPI. Перечень закрытый: своих областей в нём не бывает. */
const CONTEXT_ACTIVITY_KINDS = ['parent', 'grouping', 'category', 'other'] as const;

/** Значения `moveOn` из спецификации. Своих сюда не добавляем: перечень закрытый. */
const MOVE_ON: readonly MoveOn[] = ['Passed', 'Completed', 'CompletedAndPassed', 'CompletedOrPassed', 'NotApplicable'];

export function parseCmi5(xml: string, descriptorPath = CMI5_FILENAME, issues: ValidationIssue[] = []): PackageMetadata {
  const root = reader.root(xml, 'courseStructure', CMI5_FILENAME, issues);
  const course = child(root, 'course');
  if (!course) issues.push(issueWarning('cmi5.course-missing', 'В cmi5.xml нет элемента <course>', descriptorPath));

  const context: BuildContext = { issues, descriptorPath };
  const activities = buildActivities(root, '', context);
  // Курс без единиц и курс, где у единиц нет `<url>`, — разные беды с разными причинами: первая
  // означает неправильную сборку, вторая обычно внешний запуск, забытый при экспорте.
  if (!countUnits(root)) {
    issues.push(issueError('cmi5.au-missing', 'В cmi5.xml нет ни одной запускаемой единицы <au>', descriptorPath));
  }

  const entry = firstLaunchable(activities);

  return {
    format: 'cmi5',
    descriptorPath,
    // id курса и AU по спецификации — IRI, а не произвольная строка.
    identifier: attr(course, 'id'),
    schemaVersion: attr(root, 'version'),
    title: labelOf(course, 'title') ?? entry?.title ?? null,
    description: labelOf(course, 'description'),
    entryPoint: entry?.launch?.entryPoint ?? null,
    entryUrl: entry?.launch?.entryUrl ?? null,
    entryParameters: entry?.launch?.entryParameters ?? '',
    activities,
    // Цели объявляются один раз на курс, а единицы ссылаются на них по `idref` — поэтому список
    // здесь, а на пункте только ссылки.
    details: {
      objectives: parseObjectives(root),
      courseTitles: labelsOf(course, 'title'),
      courseDescriptions: labelsOf(course, 'description'),
      contextTemplate: parseContextTemplate(course),
    },
    lom: null,
    typicalLearningTimeSeconds: null,
    externalMetadata: [],
    // Вложенных описателей в cmi5 не бывает: агрегаты собираются блоками внутри одного файла.
    subManifests: [],
    // Заполняет parsePackage по источнику — описатель этого не знает.
    fileCount: null,
    totalBytes: null,
    alsoDetected: [],
    // cmi5 описывает запуск, а не состав пакета: перечня файлов в формате нет.
    declaredFiles: [],
    masteryScore: entry?.masteryScore ?? null,
  };
}

interface BuildContext {
  issues: ValidationIssue[];
  descriptorPath: string;
}

function countUnits(node: XmlNode | null): number {
  return array(node, 'au').length + array(node, 'block').reduce((sum, block) => sum + countUnits(block), 0);
}

/**
 * `<block>` — узел, `<au>` — лист. Порядок обхода pre-order, как в оглавлении: первая найденная AU
 * и есть та, с которой курс начинается.
 *
 * Раньше дерево здесь уплощалось в список — блоки терялись целиком, вместе со своими названиями.
 */
function buildActivities(node: XmlNode | null, path: string, context: BuildContext): Activity[] {
  const blocks = array(node, 'block').map((block, index) => {
    const position = path ? `${path}.b${index}` : `b${index}`;
    return {
      ...baseActivity(block, position, context),
      // Блок сам не запускается — это глава, а не единица прохождения.
      launch: null,
      children: buildActivities(block, position, context),
    };
  });

  const units = array(node, 'au').map((au, index) => {
    const position = path ? `${path}.a${index}` : `a${index}`;
    const activity = baseActivity(au, position, context);
    return { ...activity, launch: launchOf(au, context, activity.identifier), children: [] };
  });

  // Единицы перед блоками: AU, лежащая в корне рядом с блоками, по спецификации идёт первой.
  return [...units, ...blocks];
}

function baseActivity(node: XmlNode, position: string, context: BuildContext): Activity {
  const identifier = attr(node, 'id') ?? `#${position}`;
  return {
    identifier,
    title: labelOf(node, 'title'),
    titles: labelsOf(node, 'title'),
    descriptions: labelsOf(node, 'description'),
    launch: null,
    resourceId: null,
    visible: true,
    // В cmi5 masteryScore — уже доля 0..1, в отличие от процентов SCORM 1.2 и AICC.
    masteryScore: normalizeMastery(attr(node, 'masteryScore'), 'fraction'),
    // Ограничение времени в cmi5 записано по ISO 8601, как и всё остальное в xAPI-семействе.
    maxTimeSeconds: parseDurationSeconds(attr(node, 'maxTimeAllowed')),
    timeLimitAction: null,
    // `launchParameters` cmi5 — ближайший аналог `cmi.launch_data`: строка от автора самому курсу.
    launchData: textOf(node, 'launchParameters'),
    // Условий открытия в cmi5 нет: порядок задаётся типом блока (`ordered`/`unordered`) и `moveOn`.
    prerequisites: null,
    ...withoutSequencing(),
    moveOn: parseMoveOn(node, context, identifier),
    launchMethod: attr(node, 'launchMethod'),
    // `<entitlementKey scope="...">` бывает и с альтернативами; берём объявленный ключ как есть.
    entitlementKey: textOf(node, 'entitlementKey') ?? textOf(child(node, 'entitlementKey'), 'alternative'),
    contextTemplate: parseContextTemplate(node),
    // В cmi5 это атрибут единицы, а не элемент, — в отличие от `<url>` и `<launchParameters>` рядом.
    activityType: attr(node, 'activityType'),
    objectiveRefs: objectiveRefsOf(node),
    // Расширений в cmi5 нет — это устройство tincan.xml.
    extensions: {},
    children: [],
  };
}

/**
 * Перечень `moveOn` закрыт спецификацией, и чужое значение девать некуда. Подставить умолчание
 * нельзя: `NotApplicable` и `CompletedAndPassed` — это «зачесть сразу» против «зачесть только после
 * двух условий», и разница видна учащемуся, а не в логе.
 */
function parseMoveOn(node: XmlNode, context: BuildContext, identifier: string): MoveOn | null {
  const raw = attr(node, 'moveOn');
  if (!raw) return null;
  if ((MOVE_ON as readonly string[]).includes(raw)) return raw as MoveOn;

  context.issues.push(
    issueWarning(
      'cmi5.moveon-unknown',
      `У единицы "${identifier}" moveOn="${raw}" — такого значения в спецификации нет`,
      `${context.descriptorPath}#${identifier}`,
      `Допустимо одно из: ${MOVE_ON.join(', ')}`,
    ),
  );
  return null;
}

/**
 * `<contextTemplate>` — заготовка контекста xAPI на курсе или на единице.
 *
 * Элемента с таким именем в схеме cmi5 нет: это расширение, которое кладут сборщики, чтобы LMS
 * слила объявленное с тем, что сама подставляет в `LMS.LaunchData`. Разбираем структурно — внутри
 * обычный объект контекста xAPI, и он описан спецификацией.
 *
 * Значением расширения берётся текст: расширение с вложенной разметкой внутри — это уже чужой
 * формат внутри нашего, и придумывать ему отображение в модель мы не беремся.
 */
function parseContextTemplate(node: XmlNode | null): Cmi5ContextTemplate | null {
  const template = child(node, 'contextTemplate');
  if (!template) return null;

  const activities = child(template, 'contextActivities');
  const contextActivities: Record<string, string[]> = {};
  for (const kind of CONTEXT_ACTIVITY_KINDS) {
    const ids = array(child(activities, kind), 'activity')
      .map(activity => attr(activity, 'id'))
      .filter((id): id is string => id !== null);
    if (ids.length) contextActivities[kind] = ids;
  }

  const extensions: Record<string, string> = {};
  for (const extension of array(child(template, 'extensions'), 'extension')) {
    const id = attr(extension, 'id');
    const text = asText(extension);
    // Первое объявление выигрывает — как и в расширениях tincan.xml: повтор ключа это склейка.
    if (id && text !== null && !(id in extensions)) extensions[id] = text;
  }

  return { contextActivities, extensions };
}

/** `<objectives><objective idref="…"/></objectives>` на единице или блоке — ссылки на цели курса. */
function objectiveRefsOf(node: XmlNode): string[] {
  const refs = array(child(node, 'objectives'), 'objective')
    .map(objective => attr(objective, 'idref'))
    .filter((ref): ref is string => ref !== null);
  return [...new Set(refs)];
}

/** Цели курса: `<objectives>` верхнего уровня, по которым единицы отчитываются в LRS. */
function parseObjectives(root: XmlNode): Cmi5Objective[] {
  return array(child(root, 'objectives'), 'objective')
    .map(objective => ({
      id: attr(objective, 'id') ?? '',
      title: labelOf(objective, 'title'),
      description: labelOf(objective, 'description'),
    }))
    .filter(objective => objective.id !== '');
}

/** У AU без `<url>` запускать нечего — она остаётся в дереве узлом, но не точкой входа. */
function launchOf(au: XmlNode, context: BuildContext, identifier: string): Activity['launch'] {
  const where = `${context.descriptorPath}#${identifier}`;
  const url = textOf(au, 'url');
  if (!url) {
    context.issues.push(issueWarning('cmi5.launch-url-missing', `У единицы "${identifier}" нет <url>`, where));
    return null;
  }
  return tryResolveLaunch(url, 'URL единицы cmi5', context.issues, where);
}
