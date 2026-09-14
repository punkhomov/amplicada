import { issueWarning, type ValidationIssue } from '../../issue.js';
import { type Prerequisite, parsePrerequisites } from '../../model/prerequisite.js';
import { attr, child, textOf, type XmlNode } from '../../xml/nodes.js';

/**
 * `<adlcp:prerequisites type="aicc_script">CHAPTER1</adlcp:prerequisites>` на пункте оглавления.
 *
 * Здесь только добыча строки: язык у SCORM 1.2 и AICC один, и разбор общий — `model/prerequisite.ts`.
 *
 * Читается и у SCORM 2004, хотя там этого элемента нет: его роль играет sequencing, а `prerequisites`
 * в манифесте 2004 — след конвертации из 1.2. Прочитать дешевле, чем промолчать; версию курса
 * потребитель и так знает.
 */

/** Единственный язык, объявленный спецификацией. Регистр в живых пакетах пляшет. */
const AICC_SCRIPT = 'aicc_script';

export function parseItemPrerequisites(item: XmlNode, issues: ValidationIssue[], where: string): Prerequisite | null {
  const source = textOf(item, 'prerequisites');
  if (!source) return null;

  // Атрибут виден только когда парсер отдал элемент узлом; без атрибутов он приходит строкой, и
  // тогда `type` не объявлен вовсе — по спецификации это и есть `aicc_script`.
  const type = attr(child(item, 'prerequisites'), 'type');
  if (type && type.toLowerCase() !== AICC_SCRIPT) {
    // Разбирать чужой язык по правилам AICC-скрипта нельзя: совпадут разве что односложные условия,
    // а на составном получится дерево, которого автор не писал.
    issues.push(
      issueWarning(
        'scorm.prerequisites-type-unknown',
        `Условие открытия объявлено на языке "${type}" — библиотека знает только ${AICC_SCRIPT}`,
        where,
      ),
    );
    return null;
  }

  return parsePrerequisites(source, issues, where);
}
