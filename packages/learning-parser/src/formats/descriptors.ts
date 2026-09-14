/**
 * Имена файлов-описателей — по ним пакет опознаётся.
 *
 * Модуль намеренно без единого импорта. Знать, что `imsmanifest.xml` означает SCORM, нужно на этапе
 * планирования распаковки: каталог описателя считается корнем пакета, а разбирать там ещё нечего.
 * Если бы это знание жило вместе с разбором, приём пакета тянул бы за собой все парсеры всех
 * форматов ради одной проверки имени.
 */

/** SCORM 1.2 и 2004. В архивах встречается в любом регистре — сравнивать в нижнем. */
export const MANIFEST_FILENAME = 'imsmanifest.xml';
export const CMI5_FILENAME = 'cmi5.xml';
export const TINCAN_FILENAME = 'tincan.xml';
/** AICC: `.crs` — только догадка, подтверждает её секция `[Course]` внутри файла. */
export const AICC_COURSE_EXTENSION = '.crs';

/**
 * Опознание по одному имени файла, без содержимого.
 *
 * Для `.crs` намеренно оптимистично: лучше принять чужой файл за описатель и отвергнуть пакет
 * позже с внятной причиной, чем не найти корень и распаковать курс вместе с обёрткой.
 */
export function isDescriptorName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name === MANIFEST_FILENAME || name === CMI5_FILENAME || name === TINCAN_FILENAME || name.endsWith(AICC_COURSE_EXTENSION);
}
