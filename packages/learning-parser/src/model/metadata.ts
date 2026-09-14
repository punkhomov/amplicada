import type { Activity } from './activity.js';
import type { PackageDetails } from './details.js';
import type { LaunchTarget } from './launch.js';
import type { ExternalMetadata, Lom } from './lom.js';

/**
 * Формат пакета. Распознаём все пять — но распознать и уметь проиграть это разные вещи:
 * рантайм у нас пока только для SCORM 1.2. Остальные форматы честно опознаются и честно
 * отклоняются на приёме, вместо того чтобы дойти до «Готов» и сломаться у учащегося.
 *
 * - `scorm12`, `scorm2004` — `imsmanifest.xml`, вызовы через `window.API` в том же окне.
 * - `cmi5`, `xapi` — statement'ы в LRS по HTTP; без LRS проигрывать нечего.
 * - `aicc` — HACP: form-encoded POST'ы с session-ключом, третий протокол, ни на что не похожий.
 */
export type PackageFormat = 'scorm12' | 'scorm2004' | 'cmi5' | 'xapi' | 'aicc';

/**
 * Разобранный пакет.
 *
 * Объединение, а не один тип: `format` размечает `details`, поэтому `metadata.format === 'scorm2004'`
 * сужает `metadata.details` до `Scorm2004Details` без приведения типов. Общая часть от этого не
 * меняется — читать `title` или `entryPoint`, не разбираясь в формате, по-прежнему можно.
 */
export type PackageMetadata = { [F in PackageFormat]: PackageMetadataOf<F> }[PackageFormat];

type PackageMetadataOf<F extends PackageFormat> = CommonMetadata & {
  format: F;
  /** Специфика формата; `null` у тех, чью специфику мы пока не разбираем. */
  details: PackageDetails[F];
};

interface CommonMetadata extends LaunchTarget {
  /** Файл, по которому формат опознан: `imsmanifest.xml`, `cmi5.xml`, `tincan.xml`, `*.crs`. */
  descriptorPath: string;
  /** Идентификатор курса от автора: строка в SCORM/AICC, URI в cmi5/xAPI. Справочно. */
  identifier: string | null;
  title: string | null;
  description: string | null;
  /** Версия схемы как в файле: `1.2`, `2004 4th Edition`, `1.0` — без приведения к числу. */
  schemaVersion: string | null;
  /**
   * Оглавление курса — корни дерева. У xAPI и у AICC без `.cst` дерево плоское: вложенности в этих
   * форматах нет.
   *
   * Числа «сколько запускаемых» здесь нет намеренно: оно считается обходом (`launchableActivities`),
   * а отдельное поле рядом с деревом рано или поздно с ним разошлось бы.
   */
  activities: Activity[];
  /**
   * Файлы, которые описатель объявляет своими (`<file href>` в SCORM). По ним проверяется, что в
   * архиве есть всё объявленное: битая картинка на третьем слайде иначе доходит до учащегося.
   *
   * Пусто у форматов, которые файлов не перечисляют, — cmi5, xAPI и AICC описывают запуск, а не
   * состав.
   */
  declaredFiles: string[];
  /** Проходной балл долей 0..1, если формат его объявляет. Приведение — в `normalizeMastery`. */
  masteryScore: number | null;
  /**
   * Метаданные учебного объекта. Общее поле, а не часть `details`: LOM объявляется и в SCORM 1.2, и
   * в 2004 одинаково, и это метаданные пакета, а не особенность формата. У cmi5, xAPI и AICC —
   * `null`: LOM в этих форматах не бывает.
   */
  lom: Lom | null;
  /**
   * Ожидаемое время прохождения в секундах — «курс на 40 минут», самое частое поле карточки курса.
   *
   * Поднято из `lom.educational[].typicalLearningTimeSeconds`, где оно лежит на третьем уровне
   * вложенности да ещё и в повторяемой категории. Дублирование намеренное: наверх поднимается то,
   * что спрашивают у каталога, а не всё подряд.
   */
  typicalLearningTimeSeconds: number | null;
  /**
   * Ссылки на метаданные в отдельных файлах. Разбор формата их только находит — читает
   * `parsePackage` вторым проходом, потому что у разборщика на входе строка, а не пакет.
   */
  externalMetadata: ExternalMetadata[];
  /**
   * Вложенные пакеты: `<manifest>` внутри `<manifest>`. Так собирают агрегаты — курс из курсов,
   * каждый со своим оглавлением и своими ресурсами.
   *
   * Пусто у всех форматов, кроме SCORM: вложенность описателей — устройство IMS Content Packaging,
   * у cmi5, xAPI и AICC её нет.
   */
  subManifests: SubManifest[];
  /**
   * Сколько файлов в пакете и сколько они весят распакованными.
   *
   * Заполняет `parsePackage` по источнику: описатель этого не знает, а `parseManifest` и прочие
   * разборщики формата вызываются и напрямую, на одной строке. Отсюда `null` — «источника не было»,
   * а не «пакет пуст». `totalBytes` знает только `zipSource`: у него размеры лежат в оглавлении
   * архива, а обходу каталога пришлось бы делать `stat` на каждый файл.
   */
  fileCount: number | null;
  totalBytes: number | null;
  /**
   * Форматы, чьи описатели тоже лежат в пакете. Articulate и подобные сборщики публикуют курс сразу
   * в двух формах, складывая рядом `imsmanifest.xml` и `tincan.xml`.
   *
   * Победитель сюда не входит — он в `format`. Потребителю это нужно затем же, зачем нам: понять,
   * что пакет можно было бы принять иначе, если бы платформа умела больше.
   */
  alsoDetected: PackageFormat[];
}

/**
 * Вложенный пакет — содержимое `<manifest>`, объявленного внутри другого манифеста.
 *
 * Отдельным типом, а не `PackageMetadata`: у подманифеста нет ни своего файла-описателя, ни
 * формата, ни объёма — это свойства пакета, а он лежит внутри чужого. Точки входа у него тоже нет:
 * запускается организация корневого манифеста, а подманифест — материал, из которого её собрали.
 *
 * В `activities` корня его пункты не вливаются. Спецификация разрешает ссылаться на них по
 * `identifierref`, но вписать чужое оглавление в своё значило бы придумать за автора структуру,
 * которой он не объявлял.
 */
export interface SubManifest {
  identifier: string | null;
  title: string | null;
  schemaVersion: string | null;
  activities: Activity[];
  declaredFiles: string[];
  lom: Lom | null;
  /** Глубина вложенности не ограничена: подманифест сам содержит подманифесты. */
  subManifests: SubManifest[];
}
