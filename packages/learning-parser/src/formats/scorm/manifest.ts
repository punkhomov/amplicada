import { findDescriptor } from '../../archive/layout.js';
import { issueWarning, type ValidationIssue } from '../../issue.js';
import { type Activity, firstLaunchable, withoutXapiTraits } from '../../model/activity.js';
import type { Scorm2004Details } from '../../model/details.js';
import { parseDurationSeconds } from '../../model/duration.js';
import { joinParameters, type LaunchTarget, tryResolveLaunch } from '../../model/launch.js';
import { langText, typicalLearningTimeOf } from '../../model/lom.js';
import type { PackageFormat, PackageMetadata, SubManifest } from '../../model/metadata.js';
import { normalizeMastery } from '../../model/score.js';
import type { Sequencing } from '../../model/sequencing.js';
import { array, attr, child, labelsOf, textOf, type XmlNode } from '../../xml/nodes.js';
import { createXmlReader } from '../../xml/parser.js';
import { MANIFEST_FILENAME } from '../descriptors.js';
import { detectEdition } from './edition.js';
import { collectExternalMetadata, LOM_ARRAY_TAGS, parseLomIn } from './lom.js';
import { parseItemPrerequisites } from './prerequisites.js';
import {
  collectGlobalObjectives,
  collectSharedDataTargets,
  describeSequencingUsage,
  indexSequencingCollection,
  parseCompletionThreshold,
  parseHiddenControls,
  parseSequencing,
  parseSharedData,
  SEQUENCING_ARRAY_TAGS,
} from './sequencing.js';

/**
 * SCORM 1.2 и 2004 — `imsmanifest.xml`.
 *
 * Манифесты в природе кривые: неймспейсы то есть, то нет; точка входа лежит то в организации, то
 * только в ресурсах; пути собираются из `xml:base` на трёх уровнях. Всё это здесь и разгребается.
 *
 * Исключение бросается только когда непонятно, **что это за файл** (не XML, чужой корень). Всё
 * остальное — находки в `issues`: решение «принимать или нет» принимает потребитель.
 */

/**
 * Повторяемые элементы content packaging. `<manifest>` в списке потому, что манифест умеет
 * содержать вложенные субманифесты. Sequencing добавляет к списку свои — их десяток, и держать их
 * здесь же значило бы смешать содержание пакета с правилами его прохождения.
 */
const reader = createXmlReader([
  'organization',
  'item',
  'resource',
  'file',
  'dependency',
  'manifest',
  ...LOM_ARRAY_TAGS,
  ...SEQUENCING_ARRAY_TAGS,
]);

export function findManifestPath(paths: readonly string[]): string | null {
  return findDescriptor(paths, filename => filename === MANIFEST_FILENAME);
}

export function parseManifest(xml: string, descriptorPath = MANIFEST_FILENAME, issues: ValidationIssue[] = []): PackageMetadata {
  const root = reader.root(xml, 'manifest', MANIFEST_FILENAME, issues);
  const format = detectVersion(root, xml);

  const identifier = attr(root, 'identifier');
  if (!identifier) {
    issues.push(issueWarning('scorm.manifest-identifier-missing', 'У манифеста нет атрибута identifier', descriptorPath));
  }

  const resourcesNode = child(root, 'resources');
  const resources = indexResources(resourcesNode);
  // `xml:base` объявляется на `<manifest>`, `<resources>` и `<resource>` и складывается по цепочке.
  // Первые два уровня общие для всех пунктов, третий свой у каждого ресурса — поэтому база
  // досчитывается внутри обхода, а не один раз для точки входа.
  const manifestBase = attr(root, 'base') ?? '';
  const base = joinBase(manifestBase, attr(resourcesNode, 'base'));

  const organization = defaultOrganization(root, descriptorPath, issues);
  const context: BuildContext = {
    resources,
    base,
    format,
    issues,
    descriptorPath,
    referenced: new Set(),
    sequencingCollection: indexSequencingCollection(root),
  };
  const activities = buildActivities(organization, context, '');

  const entry = firstLaunchable(activities) ?? fallbackActivity(context);
  checkResources(context);
  const metadataNode = child(root, 'metadata');
  const schemaVersion = textOf(metadataNode, 'schemaversion');
  const lom = parseLomIn(metadataNode);

  const common = {
    descriptorPath,
    identifier,
    schemaVersion,
    // Название организации важнее LOM: оглавление — это то, что учащийся увидит в плеере, а LOM
    // заполняют каталогизаторы, и там курс бывает назван по-своему.
    title: textOf(organization, 'title') ?? langText(lom?.general?.title),
    description: langText(lom?.general?.descriptions[0]),
    lom,
    typicalLearningTimeSeconds: typicalLearningTimeOf(lom),
    externalMetadata: collectExternalMetadata(root),
    subManifests: array(root, 'manifest').map(nested => subManifestOf(nested, manifestBase, context)),
    // Заполняет parsePackage по источнику — описатель этого не знает.
    fileCount: null,
    totalBytes: null,
    alsoDetected: [],
    entryPoint: entry?.launch?.entryPoint ?? null,
    entryUrl: entry?.launch?.entryUrl ?? null,
    entryParameters: entry?.launch?.entryParameters ?? '',
    // Если оглавление объявлено, но ни один его пункт не запускается, точка входа взята из ресурсов
    // и в дереве её нет. Дописывать её туда значило бы придумать за автора структуру, которой он не
    // объявлял; отдаём оглавление как есть, а запускаем то, что нашли.
    activities: activities.length ? activities : entry ? [entry] : [],
    declaredFiles: declaredFiles(resources, base),
    masteryScore: entry?.masteryScore ?? null,
  };

  // Специфика уезжает в `details`, размеченное форматом: `sequencingUsage` у 1.2 не значит ничего,
  // а держать поле пустым ради одинаковой формы — способ заставить потребителя проверять и то и это.
  return format === 'scorm2004'
    ? { ...common, format, details: scorm2004Details(schemaVersion, activities) }
    : { ...common, format, details: null };
}

/**
 * Вложенный пакет: `<manifest>` внутри `<manifest>`.
 *
 * Разбирается тем же кодом, что и корневой, — оглавление, ресурсы, состав, LOM, — но без трёх
 * вещей. Точки входа: подманифест не запускается сам, запускается организация вмещающего пакета.
 * Предупреждения об отсутствии организаций: библиотека ресурсов без оглавления — нормальный
 * подманифест, а не поломка. И `checkResources`: «осиротевший» ресурс здесь тоже норма — ссылается
 * на него как раз вмещающий пакет, а не собственное оглавление.
 */
function subManifestOf(nested: XmlNode, parentBase: string, context: BuildContext): SubManifest {
  const resourcesNode = child(nested, 'resources');
  // `xml:base` наследуется по вложенности документа, а не по границе пакета.
  const manifestBase = joinBase(parentBase, attr(nested, 'base'));
  const base = joinBase(manifestBase, attr(resourcesNode, 'base'));
  const resources = indexResources(resourcesNode);

  const nestedContext: BuildContext = {
    ...context,
    resources,
    base,
    referenced: new Set(),
    // Переиспользуемые блоки sequencing свои у каждого манифеста: `IDRef` из подманифеста ищется в
    // его собственной коллекции, иначе один и тот же идентификатор в двух пакетах привёл бы к чужим
    // правилам.
    sequencingCollection: indexSequencingCollection(nested),
  };

  const organizations = child(nested, 'organizations');
  const list = array(organizations, 'organization');
  const defaultId = attr(organizations, 'default');
  const organization = (defaultId ? list.find(org => attr(org, 'identifier') === defaultId) : null) ?? list[0] ?? null;

  const metadataNode = child(nested, 'metadata');
  return {
    identifier: attr(nested, 'identifier'),
    title: textOf(organization, 'title'),
    schemaVersion: textOf(metadataNode, 'schemaversion'),
    activities: buildActivities(organization, nestedContext, ''),
    declaredFiles: declaredFiles(resources, base),
    lom: parseLomIn(metadataNode),
    subManifests: array(nested, 'manifest').map(deeper => subManifestOf(deeper, manifestBase, nestedContext)),
  };
}

/**
 * Пакетное — то, что относится к курсу целиком, а не к пункту. Глобальные цели и общие «корзины»
 * данных именно таковы: по отдельному пункту не видно, обменивается он с кем-то или разговаривает
 * сам с собой.
 */
function scorm2004Details(schemaVersion: string | null, activities: readonly Activity[]): Scorm2004Details {
  return {
    edition: detectEdition(schemaVersion),
    sequencingUsage: describeSequencingUsage(activities),
    globalObjectives: collectGlobalObjectives(activities),
    sharedDataTargets: collectSharedDataTargets(activities),
  };
}

/**
 * Обход `<item>` в глубину. Пункт без `identifierref` — контейнер (глава, модуль): он остаётся
 * узлом дерева, а не выбрасывается, потому что на него ссылается sequencing и он виден в оглавлении.
 *
 * @param path — позиционный путь для пунктов без `identifier`; такие в живых пакетах встречаются.
 */
interface BuildContext {
  resources: Map<string, XmlNode>;
  /** `xml:base` манифеста и `<resources>`, сложенные. База самого ресурса добавляется на месте. */
  base: string;
  format: ScormFormat;
  issues: ValidationIssue[];
  descriptorPath: string;
  /** Идентификаторы ресурсов, на которые сослался хоть один пункт, — для поиска осиротевших. */
  referenced: Set<string>;
  /** Переиспользуемые блоки sequencing из `<imsss:sequencingCollection>`, по `ID`. */
  sequencingCollection: Map<string, XmlNode>;
}

type ScormFormat = Extract<PackageFormat, 'scorm12' | 'scorm2004'>;

function buildActivities(node: XmlNode | null, context: BuildContext, path: string): Activity[] {
  return array(node, 'item').map((item, index) => {
    const position = path ? `${path}.${index}` : String(index);
    const identifier = attr(item, 'identifier') ?? `#${position}`;
    const ref = attr(item, 'identifierref');
    const resource = ref ? context.resources.get(ref) : undefined;

    if (ref) {
      context.referenced.add(ref);
      if (!resource) {
        context.issues.push(
          issueWarning(
            'scorm.resource-ref-dangling',
            `Пункт "${identifier}" ссылается на ресурс "${ref}", которого в манифесте нет`,
            `${context.descriptorPath}#${identifier}`,
          ),
        );
      }
    }

    const where = `${context.descriptorPath}#${identifier}`;
    // Sequencing разбирается и у 1.2: `<imsss:sequencing>` в манифесте 1.2 — уже нарушение, но
    // прочитать его дешевле, чем промолчать, а версию курса потребитель и так знает.
    const sequencing = parseSequencing(item, context.sequencingCollection, context.issues, where);

    return {
      identifier,
      title: textOf(item, 'title'),
      titles: labelsOf(item, 'title'),
      // `<item>` описания не несёт: в content packaging оно объявляется метаданными ресурса.
      descriptions: {},
      launch: launchOf(item, resource, context, identifier),
      resourceId: ref,
      // Отсутствие атрибута означает «видимый»: скрытие надо объявлять явно.
      visible: (attr(item, 'isvisible') ?? 'true').toLowerCase() !== 'false',
      masteryScore: masteryOf(item, sequencing, context.format),
      maxTimeSeconds: parseDurationSeconds(textOf(item, 'maxtimeallowed')),
      timeLimitAction: textOf(item, 'timelimitaction'),
      launchData: textOf(item, 'datafromlms'),
      prerequisites: parseItemPrerequisites(item, context.issues, where),
      sequencing,
      completionThreshold: parseCompletionThreshold(item),
      hiddenControls: parseHiddenControls(item),
      sharedData: parseSharedData(item),
      // Цели пункта в SCORM объявляются внутри sequencing, а не ссылками на общий список.
      objectiveRefs: [],
      ...withoutXapiTraits(),
      children: buildActivities(item, context, position),
    };
  });
}

/**
 * Ссылка пункта на несуществующий ресурс, ресурс без `href` и href, уводящий за пределы пакета, —
 * всё это делает пункт не запускаемым, но не роняет разбор целиком.
 *
 * Резолвится каждый пункт дерева, и падать на одном кривом из полусотни было бы явным ухудшением:
 * запускать его мы всё равно не станем, а курс исправен.
 */
function launchOf(item: XmlNode, resource: XmlNode | undefined, context: BuildContext, identifier: string): LaunchTarget | null {
  const href = resource ? attr(resource, 'href') : null;
  if (!href) return null;

  const full = joinBase(joinBase(context.base, attr(resource, 'base')), href);
  const target = tryResolveLaunch(full, 'Точка входа', context.issues, `${context.descriptorPath}#${identifier}`);
  if (!target) return null;

  // `item/@parameters` по спецификации уже содержит `?` или `#`; если query есть и в href,
  // второй знак вопроса делает URL нерабочим.
  return { ...target, entryParameters: joinParameters(target.entryParameters, attr(item, 'parameters') ?? '') };
}

/**
 * Пакеты, собранные вручную или конвертерами, сплошь и рядом приходят с пустым `<organizations/>`.
 * Тогда оглавления нет вовсе, и курс — это один ресурс: первый `scormtype="sco"`, иначе любой с href.
 */
function fallbackActivity(context: BuildContext): Activity | null {
  let anyWithHref: { id: string; resource: XmlNode } | null = null;

  for (const [id, resource] of context.resources) {
    if (!attr(resource, 'href')) continue;
    if (isSco(resource)) return resourceActivity(id, resource, context);
    anyWithHref ??= { id, resource };
  }

  return anyWithHref ? resourceActivity(anyWithHref.id, anyWithHref.resource, context) : null;
}

function resourceActivity(id: string, resource: XmlNode, context: BuildContext): Activity | null {
  const launch = launchOf({}, resource, context, id);
  if (!launch) return null;
  context.referenced.add(id);

  return {
    identifier: id,
    title: null,
    titles: {},
    descriptions: {},
    launch,
    resourceId: id,
    visible: true,
    masteryScore: null,
    maxTimeSeconds: null,
    timeLimitAction: null,
    launchData: null,
    // Всё это объявляется на пункте оглавления, а оглавления здесь как раз и нет.
    prerequisites: null,
    sequencing: null,
    completionThreshold: null,
    hiddenControls: [],
    sharedData: [],
    objectiveRefs: [],
    ...withoutXapiTraits(),
    children: [],
  };
}

/**
 * Проверки по самим ресурсам. Осиротевший ресурс — не всегда ошибка (общие библиотеки объявляют
 * так), но чаще это пункт оглавления, забытый при экспорте, поэтому предупреждаем.
 */
function checkResources(context: BuildContext): void {
  for (const [id, resource] of context.resources) {
    const where = `${context.descriptorPath}#${id}`;

    if (isSco(resource) && !attr(resource, 'href')) {
      context.issues.push(issueWarning('scorm.resource-href-missing', `У ресурса "${id}" тип sco, но нет href — запускать нечего`, where));
    }
    if (!context.referenced.has(id)) {
      context.issues.push(issueWarning('scorm.orphaned-resource', `На ресурс "${id}" не ссылается ни один пункт оглавления`, where));
    }
  }
}

/** SCORM 1.2 пишет `scormtype`, SCORM 2004 — `scormType`; после removeNSPrefix оба без префикса. */
function isSco(resource: XmlNode): boolean {
  return (attr(resource, 'scormtype') ?? attr(resource, 'scormType') ?? '').toLowerCase() === 'sco';
}

/** `<file href>` внутри ресурсов — состав пакета по мнению автора. Проверяется по архиву в правилах. */
function declaredFiles(resources: Map<string, XmlNode>, base: string): string[] {
  const files = new Set<string>();

  for (const resource of resources.values()) {
    const resourceBase = joinBase(base, attr(resource, 'base'));
    for (const file of array(resource, 'file')) {
      const href = attr(file, 'href');
      if (href) files.add(joinBase(resourceBase, href));
    }
  }

  return [...files];
}

function defaultOrganization(root: XmlNode, descriptorPath: string, issues: ValidationIssue[]): XmlNode | null {
  const organizations = child(root, 'organizations');
  const list = array(organizations, 'organization');
  if (!list.length) {
    issues.push(issueWarning('scorm.organizations-missing', 'В манифесте нет организаций — оглавления у курса не будет', descriptorPath));
    return null;
  }

  const defaultId = attr(organizations, 'default');
  if (defaultId) {
    const match = list.find(org => attr(org, 'identifier') === defaultId);
    if (match) return match;
    issues.push(
      issueWarning(
        'scorm.default-organization-invalid',
        `organizations/@default указывает на "${defaultId}", такой организации нет — взята первая`,
        descriptorPath,
      ),
    );
  }
  return list[0];
}

function indexResources(resourcesNode: XmlNode | null): Map<string, XmlNode> {
  const index = new Map<string, XmlNode>();
  for (const resource of array(resourcesNode, 'resource')) {
    const id = attr(resource, 'identifier');
    // Первый выигрывает: дубли идентификаторов встречаются в склеенных пакетах.
    if (id && !index.has(id)) index.set(id, resource);
  }
  return index;
}

/**
 * SCORM 1.2 объявляет проходной балл процентами в `adlcp:masteryscore`, SCORM 2004 — долей в
 * `imsss:minNormalizedMeasure` первичной цели. Оба живут на пункте оглавления, а не на ресурсе.
 *
 * У 2004 берётся из уже разобранного sequencing, а не вычитывается из XML заново: там порог мог
 * приехать из общего блока по `IDRef`, и второе чтение его бы не увидело.
 */
function masteryOf(item: XmlNode | null, sequencing: Sequencing | null, format: ScormFormat): number | null {
  if (!item) return null;
  if (format === 'scorm12') return normalizeMastery(textOf(item, 'masteryscore'), 'percent');
  return sequencing?.objectives?.primary?.minNormalizedMeasure ?? null;
}

/**
 * Версия определяется по `<schema>`/`<schemaversion>`, а при их отсутствии — по неймспейсу ADL
 * в исходном тексте. Смотреть неймспейс в разобранном дереве нельзя: `removeNSPrefix` объявления
 * `xmlns:*` уже выбросил.
 *
 * Неизвестное считаем SCORM 1.2 — это и распространённее, и рантайм у нас пока только для него.
 */
function detectVersion(root: XmlNode, xml: string): ScormFormat {
  const schemaVersion = textOf(child(root, 'metadata'), 'schemaversion');
  if (schemaVersion) {
    if (schemaVersion.startsWith('2004')) return 'scorm2004';
    if (schemaVersion.startsWith('1.2')) return 'scorm12';
  }
  return /adlcp_v1p3|imscp_v1p1/.test(xml) ? 'scorm2004' : 'scorm12';
}

function joinBase(base: string | null, path: string | null): string {
  if (!path) return base ?? '';
  if (!base) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
