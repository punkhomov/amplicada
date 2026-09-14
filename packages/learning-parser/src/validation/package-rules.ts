import { resolveRelativePath } from '../archive/paths.js';
import { issueError, issueWarning, type ValidationIssue } from '../issue.js';
import { walkActivities } from '../model/activity.js';
import type { PackageMetadata } from '../model/metadata.js';
import { checkPrerequisites } from './prerequisite-rules.js';

/**
 * Правила, одинаковые для всех форматов: они смотрят на разобранные метаданные и на список файлов
 * архива, а в устройство описателя не лезут.
 *
 * Правила, которым нужен сам манифест (осиротевшие ресурсы, ссылки в никуда), живут в разборе
 * формата — вынести их сюда значило бы отдать наружу разобранный XML раньше, чем у этого появится
 * потребитель.
 */
export function checkPackage(metadata: PackageMetadata, paths: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const where = metadata.descriptorPath;

  if (!metadata.entryPoint && !metadata.entryUrl) {
    issues.push(
      issueError(
        'common.no-launchable',
        'В пакете нет ни одного запускаемого блока',
        where,
        'Проверьте, что описатель ссылается на файл запуска',
      ),
    );
  }

  // Внешний запуск — не изъян пакета, а его устройство: у cmi5 и xAPI контент на чужом сервере это
  // норма. Отказывать или нет, решает потребитель, наше дело — сказать.
  if (metadata.entryUrl) {
    issues.push(issueWarning('common.external-launch', `Курс запускается с внешнего адреса: ${metadata.entryUrl}`, where));
  }

  if (!metadata.title) {
    issues.push(issueWarning('common.title-missing', 'У пакета нет названия — в каталоге он будет безымянным', where));
  }

  issues.push(...checkFiles(metadata, paths, where));
  issues.push(...checkExternalMetadata(metadata, paths, where));
  issues.push(...checkIdentifiers(metadata, where));
  issues.push(...checkPrerequisites(metadata.activities, where));
  return issues;
}

/**
 * Сверка объявленного с тем, что лежит в архиве.
 *
 * Регистр не учитывается намеренно: архив и описатель пишут разные инструменты, и `Content/Index.html`
 * против `content/index.html` — расхождение сборщика, а не отсутствие файла. Ругаться на это значило
 * бы забраковать исправные пакеты.
 */
function checkFiles(metadata: PackageMetadata, paths: readonly string[], where: string): ValidationIssue[] {
  const present = new Set(paths.map(path => path.toLowerCase()));
  const issues: ValidationIssue[] = [];

  if (metadata.entryPoint && !present.has(metadata.entryPoint.toLowerCase())) {
    issues.push(issueError('common.entry-missing', `Точка входа "${metadata.entryPoint}" отсутствует в архиве`, where));
  }

  const reported = new Set<string>();
  for (const declared of metadata.declaredFiles) {
    const normalized = resolveRelativePath(declared);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (present.has(key) || reported.has(key)) continue;
    reported.add(key);
    // Не error по недосмотру: курс с отсутствующим ассетом открывается и выдаёт 404 в середине —
    // а это хуже отказа на приёме, потому что учащийся уже начал.
    issues.push(issueError('common.file-missing', `Файл "${declared}" объявлен в описании курса, но отсутствует в архиве`, where));
  }

  return issues;
}

/**
 * Ссылка на метаданные, которых в архиве нет.
 *
 * Не ошибка: метаданные необязательны, и курс без них проигрывается ровно так же. Но ссылку автор
 * написал сам, а значит рассчитывал, что файл доедет, — чаще всего он и теряется при пересборке
 * пакета, когда каталог с метаданными остаётся снаружи.
 */
function checkExternalMetadata(metadata: PackageMetadata, paths: readonly string[], where: string): ValidationIssue[] {
  const present = new Set(paths.map(path => path.toLowerCase()));

  return metadata.externalMetadata
    .filter(entry => !present.has(entry.path.toLowerCase()))
    .map(entry =>
      issueWarning(
        'common.external-metadata-missing',
        `Метаданные объявлены в файле "${entry.path}", которого в архиве нет`,
        entry.owner ? `${where}#${entry.owner}` : where,
      ),
    );
}

/**
 * Дубль идентификатора ломает привязку попытки к пункту: две разные главы становятся неотличимы, и
 * прогресс по одной перезаписывает прогресс по другой.
 */
function checkIdentifiers(metadata: PackageMetadata, where: string): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const activity of walkActivities(metadata.activities)) {
    if (seen.has(activity.identifier)) duplicated.add(activity.identifier);
    else seen.add(activity.identifier);
  }

  return [...duplicated].map(identifier =>
    issueWarning('common.duplicate-identifier', `Идентификатор "${identifier}" встречается у нескольких блоков`, `${where}#${identifier}`),
  );
}
