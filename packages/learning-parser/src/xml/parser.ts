import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { PackageParseError } from '../errors.js';
import { issueWarning, type ValidationIssue } from '../issue.js';
import { value, type XmlNode } from './nodes.js';

/**
 * Настройка `fast-xml-parser` под пакеты курсов. Грабли у всех форматов одни: произвольные
 * неймспейсы, значения, которые нельзя превращать в числа, и элементы, приходящие то поодиночке,
 * то списком.
 *
 * Список «всегда массив» задаёт **формат**, а не этот модуль. Один общий список на всех означал бы,
 * что `<description>` в SCORM становится массивом только потому, что так нужно xAPI, — а когда
 * сюда приедет sequencing SCORM 2004 с его десятками повторяемых элементов, соседние форматы стали
 * бы разбираться иначе без единой правки в своём коде.
 */
export interface XmlReader {
  /**
   * @param root — имя корневого элемента; его отсутствие означает, что файл не того формата.
   * @param issues — куда сообщить о нарушенной разметке. Без него нарушение молча игнорируется.
   */
  root(xml: string, root: string, what: string, issues?: ValidationIssue[]): XmlNode;
}

export function createXmlReader(arrayTags: readonly string[]): XmlReader {
  const repeatable = new Set(arrayTags);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    /**
     * Снимает главную головную боль: один и тот же элемент бывает `<item>`, `<imscp:item>` и
     * `<ims:item>` в зависимости от того, чем собирали пакет. С удалением префиксов правило поиска
     * одно на все варианты. Побочно `adlcp:scormtype` → `scormtype`, `xml:base` → `base`.
     */
    removeNSPrefix: true,
    /**
     * Значения остаются строками. Иначе `<schemaversion>1.2</schemaversion>` стал бы числом 1.2,
     * `identifier="007"` — семёркой, а id активности xAPI (это URI) поехал бы на разборе.
     */
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    /** Ограничения против «billion laughs»: файл приходит извне и разворачивать его бесконечно нельзя. */
    processEntities: { enabled: true, maxEntityCount: 50, maxExpandedLength: 50_000 },
    isArray: tagName => repeatable.has(tagName),
  });

  return {
    root(xml, root, what, issues) {
      // `XMLParser` незакрытые теги молча проглатывает — вместе с содержимым, которое в них было.
      // Останавливать из-за этого разбор нельзя (пакет с одним кривым тегом обычно работает), но и
      // молчать нельзя: пропавший `<resources>` выглядит как курс без ресурсов, а не как сломанный
      // файл, и автор пакета будет искать причину не там.
      const check = XMLValidator.validate(xml);
      if (check !== true && issues) {
        issues.push(issueWarning('common.xml-malformed', `Разметка ${what} нарушена: ${check.err.msg} (строка ${check.err.line})`, what));
      }

      let document: unknown;
      try {
        document = parser.parse(xml);
      } catch (error) {
        throw new PackageParseError(`${what} не разбирается как XML: ${(error as Error).message}`);
      }

      const raw = value(document as XmlNode, root);
      if (raw === undefined) throw new PackageParseError(`В файле ${what} нет корневого элемента <${root}>`);

      // Пустой корень (`<tincan/>`) парсер отдаёт строкой, а не объектом. Это по-прежнему файл
      // нужного формата — просто пустой, и сказать об этом должно правило, а не исключение
      // «здесь нет корневого элемента», которого на самом деле нет только у содержимого.
      return typeof raw === 'object' && raw !== null ? (raw as XmlNode) : {};
    },
  };
}
