/**
 * LOM — метаданные учебного объекта, общий стандарт IEEE 1484.12.1. Объявляется и в SCORM 1.2
 * (профиль IMS Metadata 1.2), и в SCORM 2004 (LOM 1.0), разметка у них разная, содержание одно.
 *
 * Лежит в `model/`, а не в `formats/scorm/`, по той же причине, что и sequencing: на LOM ссылается
 * `PackageMetadata`, и не может же общий результат зависеть от каталога формата. Разбор при этом
 * форматный — он и живёт в `formats/scorm/lom.ts`.
 */

/**
 * Многоязычная строка: код языка → текст. Ключ `""` — язык не объявлен.
 *
 * Здесь наконец хранятся **все** языки, а не первый. `labelOf` берёт первый потому, что язык
 * учащегося на разборе неизвестен, а деть переводы некуда; в LOM перевод названия — это и есть
 * содержание поля, и терять его значит терять смысл всей категории.
 */
export type LangString = Record<string, string>;

/**
 * Текст на предпочитаемом языке.
 *
 * Порядок поиска: точное совпадение, затем региональный вариант (`ru` подходит к `ru-RU`), затем
 * первый объявленный — пустая карточка курса хуже карточки на чужом языке.
 */
export function langText(value: LangString | null | undefined, ...preferred: readonly string[]): string | null {
  if (!value) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;

  for (const want of preferred.map(language => language.toLowerCase())) {
    const match =
      entries.find(([language]) => language.toLowerCase() === want) ??
      entries.find(([language]) => language.toLowerCase().startsWith(`${want}-`));
    if (match) return match[1];
  }

  return entries[0][1];
}

/**
 * Ожидаемое время прохождения курса — то самое «курс на 40 минут».
 *
 * Категория `educational` повторяемая (один курс описывают и для учащегося, и для преподавателя),
 * поэтому берётся первое объявленное значение: выбирать было бы не по чему, а роль описания
 * в LOM необязательна.
 */
export function typicalLearningTimeOf(lom: Lom | null | undefined): number | null {
  for (const educational of lom?.educational ?? []) {
    if (educational.typicalLearningTimeSeconds !== null) return educational.typicalLearningTimeSeconds;
  }
  return null;
}

/** Идентификатор в каталоге: `<catalog>ISBN</catalog><entry>978-…</entry>`. */
export interface LomIdentifier {
  catalog: string | null;
  entry: string | null;
}

export interface LomGeneral {
  identifiers: LomIdentifier[];
  title: LangString | null;
  /** Языки самого курса, а не метаданных. */
  languages: string[];
  descriptions: LangString[];
  keywords: LangString[];
  coverages: LangString[];
  structure: string | null;
  aggregationLevel: string | null;
}

/**
 * Вклад в жизненный цикл: кто и когда.
 *
 * `entities` — vCard'ы как записаны, без разбора: внутри полноценный формат RFC 2426, и вытаскивать
 * из него `FN:` регулярным выражением значило бы врать про полноту.
 */
export interface LomContribution {
  role: string | null;
  entities: string[];
  date: string | null;
}

export interface LomLifeCycle {
  version: LangString | null;
  status: string | null;
  contributions: LomContribution[];
}

export interface LomMetaMetadata {
  identifiers: LomIdentifier[];
  contributions: LomContribution[];
  schemas: string[];
  language: string | null;
}

/** Требование к среде: `<type>browser</type><name>ms-internet explorer</name>` плюс диапазон версий. */
export interface LomRequirement {
  type: string | null;
  name: string | null;
  minimumVersion: string | null;
  maximumVersion: string | null;
}

export interface LomTechnical {
  /** MIME-типы. */
  formats: string[];
  /** Размер в байтах, как объявлено автором. */
  size: number | null;
  locations: string[];
  /**
   * Требования складываются по И, альтернативы внутри одного требования — по ИЛИ (`orComposite`).
   * Отсюда список списков: «(IE ≥ 5 или Firefox ≥ 3) и Flash ≥ 9».
   */
  requirements: LomRequirement[][];
  installationRemarks: LangString | null;
  otherPlatformRequirements: LangString | null;
  /** Длительность воспроизведения в секундах — не путать с ожидаемым временем обучения. */
  durationSeconds: number | null;
}

export interface LomEducational {
  interactivityType: string | null;
  learningResourceTypes: string[];
  interactivityLevel: string | null;
  semanticDensity: string | null;
  intendedEndUserRoles: string[];
  contexts: string[];
  typicalAgeRanges: LangString[];
  difficulty: string | null;
  /** «Курс на 40 минут» — самое частое ожидание учащегося, и единственное место, где оно записано. */
  typicalLearningTimeSeconds: number | null;
  descriptions: LangString[];
  languages: string[];
}

export interface LomRights {
  cost: string | null;
  copyrightAndOtherRestrictions: string | null;
  description: LangString | null;
}

/** Связь с другим учебным объектом: `kind` — `ispartof`, `requires`, `isbasedon` и прочее. */
export interface LomRelation {
  kind: string | null;
  resourceIdentifiers: LomIdentifier[];
  resourceDescriptions: LangString[];
}

export interface LomAnnotation {
  entity: string | null;
  date: string | null;
  description: LangString | null;
}

export interface LomTaxon {
  id: string | null;
  entry: LangString | null;
}

export interface LomTaxonPath {
  source: LangString | null;
  taxons: LomTaxon[];
}

export interface LomClassification {
  purpose: string | null;
  taxonPaths: LomTaxonPath[];
  description: LangString | null;
  keywords: LangString[];
}

/**
 * Девять категорий LOM. Все необязательные — в живых пакетах чаще всего заполнена одна `general`,
 * а то и одно название в ней.
 *
 * `educational` списком, потому что категория повторяемая по спецификации: один курс бывает описан
 * и для учащегося, и для преподавателя.
 */
export interface Lom {
  general: LomGeneral | null;
  lifeCycle: LomLifeCycle | null;
  metaMetadata: LomMetaMetadata | null;
  technical: LomTechnical | null;
  educational: LomEducational[];
  rights: LomRights | null;
  relations: LomRelation[];
  annotations: LomAnnotation[];
  classifications: LomClassification[];
}

/**
 * Ссылка на метаданные в отдельном файле: `<metadata><adlcp:location>metadata.xml</adlcp:location>`.
 *
 * Прочитать такой файл разборщик формата не может — у него на входе строка, а не пакет, — поэтому он
 * только сообщает, куда смотреть, а дочитывает `parsePackage` вторым проходом. Ломать ради
 * необязательного поля чистоту разборщиков (а с ней и все тесты без S3) несоразмерно.
 */
export interface ExternalMetadata {
  path: string;
  /** Чьи метаданные: пакета целиком, отдельного ресурса или пункта оглавления. */
  scope: 'package' | 'resource' | 'item';
  /** Идентификатор владельца; у пакета — `null`. */
  owner: string | null;
}
