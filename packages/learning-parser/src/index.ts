/**
 * Работа с пакетом учебного курса: чтение архива, опознание формата, разбор описания, правила приёма.
 *
 * Пакет намеренно не знает ни про Fastify, ни про Drizzle, ни про S3 — только про формат.
 * Всё, что связывает его с платформой, живёт в `module-hr-learning`.
 *
 * Распознаются все пять ходовых форматов (SCORM 1.2/2004, cmi5, xAPI, AICC). Проигрывать их —
 * задача другого слоя, и он умеет пока только SCORM 1.2; остальные опознаются, чтобы отказ был
 * внятным, а не «пакет готов» с пустым экраном у учащегося.
 *
 * ## Раскладка
 *
 * Слои перечислены в порядке зависимости — каждый следующий опирается на предыдущие, обратных
 * стрелок нет:
 *
 * - `archive/` — пакет как набор файлов: пути внутри него, чтение ZIP по диапазонам, поиск
 *   описателя и корня, декодирование в текст. Про форматы не знает ничего.
 * - `xml/` — настройка разбора XML и навигация по дереву. Про конкретный формат тоже не знает:
 *   список повторяемых элементов ему передаёт формат.
 * - `model/` — что получается на выходе: метаданные, дерево оглавления, цель запуска, шкала
 *   проходного балла, находки валидации.
 * - `validation/` — правила поверх модели: что считать изъяном пакета. Про устройство описателей не
 *   знает, поэтому лежит ниже форматов, а не над ними.
 * - `formats/` — по каталогу на формат плюс `descriptors.ts` (имена описателей, без зависимостей)
 *   и `detect.ts` (выбор разборщика и сборка отчёта).
 * - `intake/` — **заготовка политики приёма**: лимиты архива, whitelist расширений, план
 *   распаковки. Единственный слой, который не про спецификации. Значения `DEFAULT_*` — пример,
 *   а не требование формата: политику задаёт тот, кто принимает пакет.
 * - `testing/` — сборка ZIP в памяти и загрузчик корпуса настоящих пакетов (`fixtures/`,
 *   происхождение — в `fixtures/PROVENANCE.md`). В публичный API не входит.
 */

export { type ClosableSource, fileSource } from './archive/file-source.js';
export { findDescriptor, packageRootOf } from './archive/layout.js';
export { extensionOf, isDirectoryEntry, normalizePackagePath, resolveRelativePath, stripQueryAndFragment } from './archive/paths.js';
export { type DetectedEncoding, decodeText, detectEncoding, type EncodingSource, stripBom } from './archive/text.js';
export { bufferSource, type RandomAccessSource, ZipArchive, type ZipEntry, ZipError } from './archive/zip.js';
export { PackageParseError } from './errors.js';
export { type AiccFiles, isAiccCourseFile, parseAicc } from './formats/aicc/course.js';
export { AICC_OBJECTIVES_EXTENSION, type AiccObjectiveRelations, parseAiccObjectives } from './formats/aicc/objectives.js';
export { AICC_PREREQUISITES_EXTENSION, parseAiccPrerequisiteFile } from './formats/aicc/prerequisites.js';
export { AICC_STRUCTURE_EXTENSION, type AiccStructure, parseAiccStructure } from './formats/aicc/structure.js';
export { parseCmi5 } from './formats/cmi5/manifest.js';
export { AICC_COURSE_EXTENSION, CMI5_FILENAME, isDescriptorName, MANIFEST_FILENAME, TINCAN_FILENAME } from './formats/descriptors.js';
export { type PackageSource, type ParsedPackage, parsePackage } from './formats/detect.js';
export { detectEdition } from './formats/scorm/edition.js';
export { collectExternalMetadata, parseLom, parseLomDocument } from './formats/scorm/lom.js';
export { findManifestPath, parseManifest } from './formats/scorm/manifest.js';
export { parseItemPrerequisites } from './formats/scorm/prerequisites.js';
export {
  type DirectorySourceOptions,
  directorySource,
  type ZipSourceOptions,
  zipSource,
} from './formats/source.js';
export { parseTincan } from './formats/xapi/tincan.js';
export { contentTypeFor, FALLBACK_CONTENT_TYPE, isAllowedPackageFile } from './intake/content-types.js';
export {
  type ArchiveLimits,
  type ArchivePlan,
  ArchiveRejected,
  DEFAULT_ARCHIVE_LIMITS,
  type PlannedFile,
  planExtraction,
} from './intake/inspect.js';
export {
  buildReport,
  ISSUE_CODES,
  type IssueCode,
  issueError,
  issueWarning,
  type Severity,
  type ValidationIssue,
  type ValidationReport,
} from './issue.js';
export {
  type Activity,
  firstLaunchable,
  launchableActivities,
  walkActivities,
  withoutSequencing,
  withoutXapiTraits,
} from './model/activity.js';
export type {
  AiccDetails,
  AiccObjective,
  AiccObjectiveMember,
  Cmi5ContextTemplate,
  Cmi5Details,
  Cmi5Objective,
  MoveOn,
  PackageDetails,
  Scorm2004Details,
  ScormEdition,
} from './model/details.js';
export { parseDurationSeconds } from './model/duration.js';
export type { LaunchTarget } from './model/launch.js';
export {
  type ExternalMetadata,
  type LangString,
  type Lom,
  type LomAnnotation,
  type LomClassification,
  type LomContribution,
  type LomEducational,
  type LomGeneral,
  type LomIdentifier,
  type LomLifeCycle,
  type LomMetaMetadata,
  type LomRelation,
  type LomRequirement,
  type LomRights,
  type LomTaxon,
  type LomTaxonPath,
  type LomTechnical,
  langText,
  typicalLearningTimeOf,
} from './model/lom.js';
export type { PackageFormat, PackageMetadata, SubManifest } from './model/metadata.js';
export { evaluatePrerequisites, type Prerequisite, parsePrerequisites, prerequisiteIdentifiers } from './model/prerequisite.js';
export type {
  AuxiliaryResource,
  CompletionThreshold,
  ConstrainedChoiceConsiderations,
  ControlMode,
  DeliveryControls,
  LimitConditions,
  Objective,
  ObjectiveMap,
  Objectives,
  RandomizationControls,
  RollupAction,
  RollupCondition,
  RollupConditionName,
  RollupConsideration,
  RollupConsiderations,
  RollupRule,
  RollupRules,
  Sequencing,
  SequencingCondition,
  SequencingConditionName,
  SequencingRule,
  SequencingRuleAction,
  SequencingUsage,
  SharedDataMap,
} from './model/sequencing.js';
export { applyPolicy, type ParseOptions, type Strictness } from './options.js';
export { checkPackage } from './validation/package-rules.js';
export { checkPrerequisites } from './validation/prerequisite-rules.js';
