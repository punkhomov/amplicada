import type { ValidationIssue } from '../../issue.js';
import { parseDurationSeconds } from '../../model/duration.js';
import type {
  ExternalMetadata,
  LangString,
  Lom,
  LomAnnotation,
  LomClassification,
  LomContribution,
  LomEducational,
  LomGeneral,
  LomIdentifier,
  LomLifeCycle,
  LomMetaMetadata,
  LomRelation,
  LomRequirement,
  LomRights,
  LomTaxon,
  LomTaxonPath,
  LomTechnical,
} from '../../model/lom.js';
import { langText } from '../../model/lom.js';
import { array, asText, attr, child, textOf, type XmlNode } from '../../xml/nodes.js';
import { createXmlReader } from '../../xml/parser.js';

/**
 * Разбор LOM из манифеста и из отдельного файла.
 *
 * Две разметки под одно содержание: SCORM 1.2 несёт профиль IMS Metadata 1.2
 * (`<langstring xml:lang="ru">`, словарные значения обёрнуты в `<langstring>`), SCORM 2004 — LOM 1.0
 * (`<string language="ru">`, словарные значения простым текстом). Разводить их по двум разборщикам
 * незачем: элементы называются одинаково, различается только обёртка текста, и обе формы
 * встречаются вперемешку — конвертеры собирают манифест 2004 из шаблонов 1.2.
 */

/**
 * Повторяемые элементы LOM. Список отдаётся наружу, потому что настройка парсера — дело формата:
 * `<description>` становится массивом ради LOM, и знать об этом должен манифест SCORM, а не xAPI.
 */
export const LOM_ARRAY_TAGS = [
  'string',
  'langstring',
  'identifier',
  'description',
  'keyword',
  'coverage',
  'language',
  'contribute',
  'entity',
  'metadataSchema',
  'metadatascheme',
  'format',
  'requirement',
  'orComposite',
  'educational',
  'learningResourceType',
  'intendedEndUserRole',
  'context',
  'typicalAgeRange',
  'relation',
  'annotation',
  'classification',
  'taxonPath',
  'taxon',
] as const;

const reader = createXmlReader(LOM_ARRAY_TAGS);

/** LOM внутри `<metadata>` описателя. `null` — метаданных нет вовсе либо они во внешнем файле. */
export function parseLomIn(metadata: XmlNode | null): Lom | null {
  return parseLom(nodeAt(metadata, 'lom'));
}

/**
 * LOM отдельным файлом. Бросает, только если это не XML вовсе; чужой корень — `null`, потому что
 * ссылаться `adlcp:location` может на что угодно, и валить из-за этого разбор пакета несоразмерно.
 */
export function parseLomDocument(xml: string, what: string, issues: ValidationIssue[] = []): Lom | null {
  try {
    return parseLom(reader.root(xml, 'lom', what, issues));
  } catch {
    return null;
  }
}

export function parseLom(node: XmlNode | null): Lom | null {
  if (!node) return null;

  return {
    general: parseGeneral(nodeAt(node, 'general')),
    lifeCycle: parseLifeCycle(nodeAt(node, 'lifeCycle')),
    metaMetadata: parseMetaMetadata(nodeAt(node, 'metaMetadata')),
    technical: parseTechnical(nodeAt(node, 'technical')),
    educational: nodesAt(node, 'educational').map(parseEducational),
    rights: parseRights(nodeAt(node, 'rights')),
    relations: nodesAt(node, 'relation').map(parseRelation),
    annotations: nodesAt(node, 'annotation').map(parseAnnotation),
    classifications: nodesAt(node, 'classification').map(parseClassification),
  };
}

/**
 * Ссылки на внешние метаданные по всему манифесту.
 *
 * Собираются и с ресурсов, и с пунктов, а не только с манифеста: проверять существование файла надо
 * у всех, иначе правило пропустит ровно те ссылки, которые чаще всего и ломаются при пересборке
 * курса. Метаданными **пакета** при этом считаются только объявленные на манифесте — LOM ресурса
 * описывает ресурс, и подставлять его название курсу нельзя.
 */
export function collectExternalMetadata(root: XmlNode): ExternalMetadata[] {
  const found: ExternalMetadata[] = [];

  const packageLocation = locationOf(root);
  if (packageLocation) found.push({ path: packageLocation, scope: 'package', owner: null });

  for (const resource of array(child(root, 'resources'), 'resource')) {
    const path = locationOf(resource);
    if (path) found.push({ path, scope: 'resource', owner: attr(resource, 'identifier') });
  }

  const walkItems = (node: XmlNode): void => {
    for (const item of array(node, 'item')) {
      const path = locationOf(item);
      if (path) found.push({ path, scope: 'item', owner: attr(item, 'identifier') });
      walkItems(item);
    }
  };
  for (const organization of array(child(root, 'organizations'), 'organization')) walkItems(organization);

  return found;
}

function locationOf(node: XmlNode | null): string | null {
  return textOf(child(node, 'metadata'), 'location');
}

function parseGeneral(node: XmlNode | null): LomGeneral | null {
  if (!node) return null;
  return {
    identifiers: identifiersOf(node),
    title: lang(node, 'title'),
    languages: texts(node, 'language'),
    descriptions: langAll(node, 'description'),
    keywords: langAll(node, 'keyword'),
    coverages: langAll(node, 'coverage'),
    structure: vocabulary(node, 'structure'),
    aggregationLevel: vocabulary(node, 'aggregationLevel'),
  };
}

function parseLifeCycle(node: XmlNode | null): LomLifeCycle | null {
  if (!node) return null;
  return {
    version: lang(node, 'version'),
    status: vocabulary(node, 'status'),
    contributions: nodesAt(node, 'contribute').map(parseContribution),
  };
}

function parseMetaMetadata(node: XmlNode | null): LomMetaMetadata | null {
  if (!node) return null;
  return {
    identifiers: identifiersOf(node),
    contributions: nodesAt(node, 'contribute').map(parseContribution),
    // LOM 1.0 пишет `metadataSchema`, профиль IMS 1.2 — `metadatascheme`; после снятия префиксов
    // различаются только регистром, а он в XML значим.
    schemas: [...texts(node, 'metadataSchema'), ...texts(node, 'metadatascheme')],
    language: text(node, 'language'),
  };
}

/**
 * Дата вклада: `<date><dateTime>2026-08-09</dateTime><description>…</description></date>`. В профиле
 * IMS 1.2 то же поле называется `datetime`, а бывает и просто текстом внутри `<date>`.
 */
function parseContribution(node: XmlNode): LomContribution {
  const date = nodeAt(node, 'date');
  return {
    role: vocabulary(node, 'role'),
    entities: texts(node, 'entity'),
    date: text(date, 'dateTime') ?? text(date, 'datetime') ?? asText(first(node, 'date')),
  };
}

function parseTechnical(node: XmlNode | null): LomTechnical | null {
  if (!node) return null;
  return {
    formats: texts(node, 'format'),
    size: numberOf(text(node, 'size')),
    locations: texts(node, 'location'),
    requirements: nodesAt(node, 'requirement').map(alternativesOf),
    installationRemarks: lang(node, 'installationRemarks'),
    otherPlatformRequirements: lang(node, 'otherPlatformRequirements'),
    durationSeconds: durationOf(node, 'duration'),
  };
}

/**
 * `<requirement><orComposite>…</orComposite><orComposite>…</orComposite></requirement>` — LOM 1.0.
 * В профиле IMS 1.2 обёртки `orComposite` нет, требование лежит прямо в `<requirement>`.
 */
function alternativesOf(requirement: XmlNode): LomRequirement[] {
  const alternatives = nodesAt(requirement, 'orComposite');
  return (alternatives.length ? alternatives : [requirement]).map(node => ({
    type: vocabulary(node, 'type'),
    name: vocabulary(node, 'name'),
    minimumVersion: text(node, 'minimumVersion'),
    maximumVersion: text(node, 'maximumVersion'),
  }));
}

function parseEducational(node: XmlNode): LomEducational {
  return {
    interactivityType: vocabulary(node, 'interactivityType'),
    learningResourceTypes: vocabularies(node, 'learningResourceType'),
    interactivityLevel: vocabulary(node, 'interactivityLevel'),
    semanticDensity: vocabulary(node, 'semanticDensity'),
    intendedEndUserRoles: vocabularies(node, 'intendedEndUserRole'),
    contexts: vocabularies(node, 'context'),
    typicalAgeRanges: langAll(node, 'typicalAgeRange'),
    difficulty: vocabulary(node, 'difficulty'),
    typicalLearningTimeSeconds: durationOf(node, 'typicalLearningTime'),
    descriptions: langAll(node, 'description'),
    languages: texts(node, 'language'),
  };
}

function parseRights(node: XmlNode | null): LomRights | null {
  if (!node) return null;
  return {
    cost: vocabulary(node, 'cost'),
    copyrightAndOtherRestrictions: vocabulary(node, 'copyrightAndOtherRestrictions'),
    description: lang(node, 'description'),
  };
}

function parseRelation(node: XmlNode): LomRelation {
  const resource = nodeAt(node, 'resource');
  return {
    kind: vocabulary(node, 'kind'),
    resourceIdentifiers: identifiersOf(resource),
    resourceDescriptions: langAll(resource, 'description'),
  };
}

function parseAnnotation(node: XmlNode): LomAnnotation {
  return {
    entity: text(node, 'entity'),
    date: text(nodeAt(node, 'date'), 'dateTime') ?? asText(first(node, 'date')),
    description: lang(node, 'description'),
  };
}

function parseClassification(node: XmlNode): LomClassification {
  return {
    purpose: vocabulary(node, 'purpose'),
    taxonPaths: nodesAt(node, 'taxonPath').map(parseTaxonPath),
    description: lang(node, 'description'),
    keywords: langAll(node, 'keyword'),
  };
}

function parseTaxonPath(node: XmlNode): LomTaxonPath {
  return { source: lang(node, 'source'), taxons: nodesAt(node, 'taxon').map(parseTaxon) };
}

function parseTaxon(node: XmlNode): LomTaxon {
  return { id: text(node, 'id'), entry: lang(node, 'entry') };
}

/**
 * Идентификатор объявляется тремя способами: парой каталог/запись в `<identifier>` (LOM 1.0), тем
 * же в `<catalogentry>` (профиль IMS 1.2) и просто строкой в `<identifier>` (он же, попроще).
 * Строку кладём в `entry`: каталога у неё нет, а выбросить её значило бы потерять единственный
 * идентификатор курса.
 */
function identifiersOf(node: XmlNode | null): LomIdentifier[] {
  return [...rawEntries(node, 'identifier'), ...rawEntries(node, 'catalogentry')].map(raw =>
    typeof raw === 'object' && raw !== null
      ? {
          catalog: langText(toLangString(first(raw as XmlNode, 'catalog'))),
          entry: langText(toLangString(first(raw as XmlNode, 'entry'))),
        }
      : { catalog: null, entry: asText(raw) },
  );
}

/** Одно многоязычное значение — берётся первое, если элемент объявлен несколько раз. */
function lang(node: XmlNode | null | undefined, name: string): LangString | null {
  return toLangString(first(node, name));
}

function langAll(node: XmlNode | null | undefined, name: string): LangString[] {
  return rawEntries(node, name)
    .map(toLangString)
    .filter((entry): entry is LangString => entry !== null);
}

/**
 * Текст с языками: `<title><langstring xml:lang="ru">Курс</langstring></title>` (IMS 1.2) либо
 * `<title><string language="ru">Курс</string></title>` (LOM 1.0). Голая строка тоже встречается —
 * тогда язык неизвестен, и ключом становится пустая строка.
 */
function toLangString(raw: unknown): LangString | null {
  const plain = asText(raw);
  if (typeof raw !== 'object' || raw === null) return plain === null ? null : { '': plain };

  const node = raw as XmlNode;
  const result: LangString = {};
  for (const wrapper of ['langstring', 'string']) {
    for (const entry of rawEntries(node, wrapper)) {
      const text = asText(entry);
      if (text === null) continue;
      const language = typeof entry === 'object' && entry !== null ? languageOf(entry as XmlNode) : '';
      // Первый выигрывает: повтор одного языка в одном поле — это склейка шаблонов, а не перевод.
      if (!(language in result)) result[language] = text;
    }
  }

  if (Object.keys(result).length) return result;
  return plain === null ? null : { '': plain };
}

/** `xml:lang` профиля IMS 1.2 после снятия префикса и `language` из LOM 1.0. */
function languageOf(node: XmlNode): string {
  return attr(node, 'lang') ?? attr(node, 'language') ?? '';
}

/** Словарное значение: `<difficulty><source/><value>easy</value></difficulty>` либо просто текст. */
function vocabulary(node: XmlNode | null | undefined, name: string): string | null {
  const raw = first(node, name);
  if (raw === undefined) return null;
  const holder = typeof raw === 'object' && raw !== null && 'value' in raw ? first(raw as XmlNode, 'value') : raw;
  return langText(toLangString(holder));
}

function vocabularies(node: XmlNode | null | undefined, name: string): string[] {
  return rawEntries(node, name)
    .map(raw => {
      const holder = typeof raw === 'object' && raw !== null && 'value' in raw ? first(raw as XmlNode, 'value') : raw;
      return langText(toLangString(holder));
    })
    .filter((entry): entry is string => entry !== null);
}

/** Простые текстовые значения повторяемого элемента. */
function texts(node: XmlNode | null | undefined, name: string): string[] {
  return rawEntries(node, name)
    .map(asText)
    .filter((entry): entry is string => entry !== null);
}

/**
 * Значения элемента как есть, списком. `nodesAt()` здесь не годится: она отбрасывает строки, а в LOM
 * ровно они и приходят — `<keyword>охрана труда</keyword>` без всякой обёртки.
 */

function rawEntries(node: XmlNode | null | undefined, name: string): unknown[] {
  const key = node ? keyOf(node, name) : undefined;
  if (!node || key === undefined) return [];
  const raw = node[key];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Имя элемента без учёта регистра.
 *
 * LOM 1.0 пишет `typicalLearningTime` и `lifeCycle`, профиль IMS 1.2 — `typicallearningtime` и
 * `lifecycle`: одни и те же поля разным регистром, а XML регистр различает. Перечислять оба
 * написания у каждого поля значило бы удвоить разборщик и всё равно что-нибудь пропустить.
 */
function keyOf(node: XmlNode, name: string): string | undefined {
  if (name in node) return name;
  const wanted = name.toLowerCase();
  return Object.keys(node).find(key => key.toLowerCase() === wanted);
}

/** Первое значение элемента, каким бы оно ни было. */
function first(node: XmlNode | null | undefined, name: string): unknown {
  return rawEntries(node, name)[0];
}

function nodeAt(node: XmlNode | null | undefined, name: string): XmlNode | null {
  const raw = first(node, name);
  return typeof raw === 'object' && raw !== null ? (raw as XmlNode) : null;
}

function nodesAt(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return rawEntries(node, name).filter((entry): entry is XmlNode => typeof entry === 'object' && entry !== null);
}

function text(node: XmlNode | null | undefined, name: string): string | null {
  return asText(first(node, name));
}

/**
 * Длительность: `<duration><duration>PT1H30M</duration></duration>` в LOM 1.0, `<datetime>` в
 * профиле IMS 1.2, и просто текст у тех, кто обёртку не написал.
 */
function durationOf(node: XmlNode | null, name: string): number | null {
  const raw = first(node, name);
  if (typeof raw === 'string') return parseDurationSeconds(raw);
  if (typeof raw !== 'object' || raw === null) return null;

  const inner = raw as XmlNode;
  return parseDurationSeconds(text(inner, 'duration') ?? text(inner, 'datetime') ?? asText(inner));
}

function numberOf(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
