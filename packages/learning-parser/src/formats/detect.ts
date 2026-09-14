import { findDescriptor } from '../archive/layout.js';
import { decodeText, detectEncoding } from '../archive/text.js';
import { PackageParseError } from '../errors.js';
import { buildReport, issueWarning, type ValidationIssue, type ValidationReport } from '../issue.js';
import { langText, typicalLearningTimeOf } from '../model/lom.js';
import type { PackageFormat, PackageMetadata } from '../model/metadata.js';
import { applyPolicy, type ParseOptions } from '../options.js';
import { checkPackage } from '../validation/package-rules.js';
import { type AiccFiles, isAiccCourseFile, parseAicc } from './aicc/course.js';
import { AICC_OBJECTIVES_EXTENSION } from './aicc/objectives.js';
import { AICC_PREREQUISITES_EXTENSION } from './aicc/prerequisites.js';
import { AICC_STRUCTURE_EXTENSION } from './aicc/structure.js';
import { parseCmi5 } from './cmi5/manifest.js';
import { AICC_COURSE_EXTENSION, CMI5_FILENAME, MANIFEST_FILENAME, TINCAN_FILENAME } from './descriptors.js';
import { parseLomDocument } from './scorm/lom.js';
import { parseManifest } from './scorm/manifest.js';
import { parseTincan } from './xapi/tincan.js';

/**
 * Опознание формата пакета и разбор его описания.
 *
 * Пакет опознаётся по файлу-описателю, как это делает любой LMS: `imsmanifest.xml` → SCORM,
 * `cmi5.xml` → cmi5, `tincan.xml` → xAPI, `*.crs` с секцией `[Course]` → AICC.
 */

export interface PackageSource {
  /**
   * Пути всех файлов пакета, **уже нормализованные** (`normalizePackagePath`) и с отрезанным
   * корнем — то есть в том же виде, в каком они лягут в инвентарь. Иначе путь, по которому мы
   * нашли описатель, не совпал бы с тем, который принимает `readText`.
   */
  paths: readonly string[];
  /**
   * Содержимое файла как байты. Путь — ровно из `paths`.
   *
   * Байты, а не текст: кодировка описателя выводится из BOM и XML-декларации, то есть из его же
   * содержимого. Отдавать это наружу значило бы требовать от каждого потребителя знать про
   * windows-1251 — и молча ломаться у того, кто не знал.
   */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * Суммарный распакованный размер пакета, если источник его знает. Необязателен: `zipSource` берёт
   * его из оглавления архива бесплатно, а обходу каталога пришлось бы делать `stat` на каждый файл.
   */
  totalBytes?: number;
}

/**
 * Разобранный пакет: что в нём есть и что с ним не так.
 *
 * Отчёт отдаётся рядом с метаданными, а не вместо них: решение «принимать или нет» принимает
 * потребитель, и для этого ему нужно и то и другое.
 */
export interface ParsedPackage {
  metadata: PackageMetadata;
  report: ValidationReport;
}

/**
 * Порядок проверки — не алфавитный и не случайный: он определяет, чем окажется пакет, в котором
 * описателей несколько. Так бывает чаще, чем кажется: Articulate и подобные сборщики умеют
 * публиковать курс сразу в двух форматах, складывая рядом `imsmanifest.xml` и `tincan.xml`.
 * Первым идёт то, что мы умеем проигрывать.
 *
 * Бросает только когда непонятно, **что это за пакет**: описателя нет, он не разбирается как XML,
 * корень не тот. Всё остальное — находки в отчёте.
 */
export async function parsePackage(source: PackageSource, options?: ParseOptions): Promise<ParsedPackage> {
  const issues: ValidationIssue[] = [];
  const metadata = await parseDescriptor(source, issues);
  await attachExternalLom(source, metadata, issues);
  describeContents(source, metadata);
  issues.push(...checkPackage(metadata, source.paths));
  // Политика применяется в самом конце, к собранному списку: правила заводят находки, не зная, что
  // с ними сделает потребитель, — и это ровно то разделение, ради которого отчёт вообще появился.
  return { metadata, report: buildReport(applyPolicy(issues, options)) };
}

/**
 * Второй проход: метаданные, вынесенные в отдельный файл.
 *
 * Разборщик формата их только находит — он чистая функция от текста, и делать его асинхронным ради
 * необязательного поля значило бы переписать сигнатуры всех пяти форматов и все тесты, которые на
 * этой чистоте и держатся.
 *
 * Берётся только объявленное на манифесте: LOM ресурса описывает ресурс, и подставлять его курсу
 * нельзя. Встроенный LOM важнее внешнего — если автор написал оба, ближе к делу тот, что в манифесте.
 */
async function attachExternalLom(source: PackageSource, metadata: PackageMetadata, issues: ValidationIssue[]): Promise<void> {
  if (metadata.lom) return;

  const declared = metadata.externalMetadata.find(entry => entry.scope === 'package');
  if (!declared) return;

  const path = source.paths.find(candidate => candidate.toLowerCase() === declared.path.toLowerCase());
  // Об отсутствующем файле скажет правило: оно проверяет все ссылки разом, а не только эту.
  if (!path) return;

  const lom = parseLomDocument(await readDescriptorText(source, path, issues), path, issues);
  if (!lom) return;

  metadata.lom = lom;
  // Название и описание — то же, что взял бы разборщик, будь метаданные внутри манифеста. Не взять
  // их значило бы наказать курс за то, что автор вынес метаданные в отдельный файл: в каталоге он
  // остался бы безымянным, хотя название объявлено.
  metadata.title ??= langText(lom.general?.title);
  metadata.description ??= langText(lom.general?.descriptions[0]);
  metadata.typicalLearningTimeSeconds ??= typicalLearningTimeOf(lom);
}

/**
 * То, что видно по источнику, а не по описателю: объём пакета и его вторые формы.
 *
 * Считается здесь, а не в разборщике формата: у того на входе строка. Разборщики оставляют эти поля
 * пустыми, и `null` в них означает «источника не было» — так и есть, если звать `parseManifest`
 * напрямую.
 */
function describeContents(source: PackageSource, metadata: PackageMetadata): void {
  metadata.fileCount = source.paths.length;
  metadata.totalBytes = source.totalBytes ?? null;
  metadata.alsoDetected = otherFormats(source.paths).filter(format => format !== metadata.format);
}

/** Форматы, чьи описатели лежат в пакете. Только по именам файлов — читать ради этого нечего. */
function otherFormats(paths: readonly string[]): PackageFormat[] {
  const found: PackageFormat[] = [];
  const has = (matches: (name: string) => boolean): boolean => findDescriptor(paths, matches) !== null;

  // SCORM 1.2 и 2004 различаются только содержимым манифеста, поэтому здесь их не разделить — и не
  // надо: `format` уже сказал, какой именно, а вторым форматом SCORM рядом с собой не бывает.
  if (has(name => name === CMI5_FILENAME)) found.push('cmi5');
  if (has(name => name === TINCAN_FILENAME)) found.push('xapi');
  if (has(name => name.endsWith(AICC_COURSE_EXTENSION))) found.push('aicc');

  return found;
}

async function parseDescriptor(source: PackageSource, issues: ValidationIssue[]): Promise<PackageMetadata> {
  const manifest = findDescriptor(source.paths, name => name === MANIFEST_FILENAME);
  if (manifest) return parseManifest(await readDescriptorText(source, manifest, issues), manifest, issues);

  const cmi5 = findDescriptor(source.paths, name => name === CMI5_FILENAME);
  if (cmi5) return parseCmi5(await readDescriptorText(source, cmi5, issues), cmi5, issues);

  const tincan = findDescriptor(source.paths, name => name === TINCAN_FILENAME);
  if (tincan) return parseTincan(await readDescriptorText(source, tincan, issues), tincan, issues);

  const aicc = await findAicc(source, issues);
  if (aicc) return parseAicc(aicc.files, aicc.path, issues);

  throw new PackageParseError(
    'Формат пакета не распознан: нет ни imsmanifest.xml (SCORM), ни cmi5.xml, ни tincan.xml (xAPI), ни .crs (AICC)',
  );
}

/**
 * AICC собран из нескольких файлов с общим именем и разными расширениями. Расширения `.crs` мало:
 * так называют и посторонние файлы, поэтому содержимое проверяется на секцию `[Course]`.
 */
async function findAicc(source: PackageSource, issues: ValidationIssue[]): Promise<{ files: AiccFiles; path: string } | null> {
  const path = findDescriptor(source.paths, name => name.endsWith(AICC_COURSE_EXTENSION));
  if (!path) return null;

  const course = await readDescriptorText(source, path, issues);
  if (!isAiccCourseFile(course)) return null;

  const stem = path.slice(0, -AICC_COURSE_EXTENSION.length);
  return {
    path,
    files: {
      course,
      assignableUnits: await readSibling(source, stem, '.au', issues),
      descriptors: await readSibling(source, stem, '.des', issues),
      structure: await readSibling(source, stem, AICC_STRUCTURE_EXTENSION, issues),
      prerequisites: await readSibling(source, stem, AICC_PREREQUISITES_EXTENSION, issues),
      objectives: await readSibling(source, stem, AICC_OBJECTIVES_EXTENSION, issues),
    },
  };
}

/** Расширение спутника пишут в любом регистре, как и всё в AICC. */
async function readSibling(source: PackageSource, stem: string, extension: string, issues: ValidationIssue[]): Promise<string | null> {
  const wanted = `${stem}${extension}`.toLowerCase();
  const match = source.paths.find(path => path.toLowerCase() === wanted);
  return match ? readDescriptorText(source, match, issues) : null;
}

/**
 * Чтение описателя вместе с определением кодировки.
 *
 * Догадка отмечается находкой намеренно: `Buffer.toString('utf8')` не бросает, а подставляет
 * замену, поэтому исковерканное название доедет до карточки курса и будет выглядеть не ошибкой
 * разбора, а ошибкой автора пакета. Если название потом окажется бессмыслицей — по этой находке
 * будет понятно, где искать.
 */
async function readDescriptorText(source: PackageSource, path: string, issues: ValidationIssue[]): Promise<string> {
  const bytes = await source.readBytes(path);
  const encoding = detectEncoding(bytes);
  if (encoding.source === 'fallback') {
    issues.push(
      issueWarning(
        'common.encoding-guessed',
        `Кодировка файла не объявлена и не выводится однозначно; прочитан как ${encoding.encoding}`,
        path,
        'Сохраните описатель в UTF-8 либо объявите кодировку в XML-декларации',
      ),
    );
  }
  return decodeText(bytes, encoding);
}
