import { issueError, type ValidationIssue } from '../../issue.js';
import { type Activity, withoutSequencing } from '../../model/activity.js';
import { tryResolveLaunch } from '../../model/launch.js';
import { langText } from '../../model/lom.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { array, asText, attr, child, repeatedLabelsOf, value, type XmlNode } from '../../xml/nodes.js';
import { createXmlReader } from '../../xml/parser.js';
import { TINCAN_FILENAME } from '../descriptors.js';

/**
 * xAPI / Tin Can — `tincan.xml`.
 *
 * Файл описывает активности; запускаемая — та, у которой есть `<launch>`. Всё остальное (что
 * считать пройденным, какой балл проходной) в xAPI решается уже на уровне statement'ов в LRS,
 * поэтому в самом пакете этого просто нет — в отличие от cmi5, где хотя бы `moveOn` объявлен.
 *
 * Проигрывать без LRS нечего; здесь разбирается ровно то, что нужно для опознания и внятного отказа.
 */

/** `<name>` и `<description>` в tincan повторяются по одному на язык, а не оборачивают langstring. */
const reader = createXmlReader(['activity', 'name', 'description', 'extension']);

export function parseTincan(xml: string, descriptorPath = TINCAN_FILENAME, issues: ValidationIssue[] = []): PackageMetadata {
  const root = reader.root(xml, 'tincan', TINCAN_FILENAME, issues);
  const nodes = array(child(root, 'activities'), 'activity');
  if (!nodes.length) {
    issues.push(issueError('xapi.activities-missing', 'В tincan.xml нет ни одной активности', descriptorPath));
  }

  // Дерево у xAPI плоское — вложенности в формате нет. Активность без `<launch>` всё равно попадает
  // в оглавление: она описана автором и на неё ссылаются statement'ы, просто открывать её нечем.
  const activities = nodes.map((node, index) => toActivity(node, index, issues, descriptorPath));

  const entry = activities.find(activity => activity.launch !== null) ?? null;

  return {
    format: 'xapi',
    descriptorPath,
    // id активности по спецификации — IRI. Ровно поэтому важно не давать парсеру приводить
    // значения к числам: часть таких id выглядит как версия и поехала бы на разборе.
    identifier: entry?.identifier ?? null,
    schemaVersion: null,
    title: entry?.title ?? null,
    // Описание берётся с той же активности, что и название: отдельного описания у пакета в
    // tincan.xml нет — курс это и есть запускаемая активность.
    description: langText(entry?.descriptions),
    entryPoint: entry?.launch?.entryPoint ?? null,
    entryUrl: entry?.launch?.entryUrl ?? null,
    entryParameters: entry?.launch?.entryParameters ?? '',
    activities,
    // Пакетной специфики у xAPI нет вовсе: всё, что есть в tincan.xml, объявлено на активности —
    // тип, расширения, точка запуска. Заводить под это пустой `details` значило бы обещать
    // содержание, которого в формате не бывает.
    details: null,
    // LOM в xAPI-семействе не объявляется — описание живёт в самих активностях.
    lom: null,
    typicalLearningTimeSeconds: null,
    externalMetadata: [],
    // Вложенных описателей в xAPI не бывает: tincan.xml описывает плоский список активностей.
    subManifests: [],
    // Заполняет parsePackage по источнику — описатель этого не знает.
    fileCount: null,
    totalBytes: null,
    alsoDetected: [],
    // xAPI описывает активности, а не состав пакета: перечня файлов в формате нет.
    declaredFiles: [],
    // Проходного балла в tincan.xml нет по устройству формата — он определяется правилами в LRS.
    masteryScore: null,
  };
}

function toActivity(node: XmlNode, index: number, issues: ValidationIssue[], descriptorPath: string): Activity {
  const identifier = attr(node, 'id') ?? `#${index}`;
  const launch = launchOf(node);
  const titles = repeatedLabelsOf(node, 'name');
  return {
    identifier,
    // Язык учащегося на разборе неизвестен, поэтому наверх идёт первый объявленный, а все переводы
    // остаются в `titles` — как в LOM, где мы отказались терять их ещё в фазе `06`.
    title: langText(titles),
    titles,
    descriptions: repeatedLabelsOf(node, 'description'),
    launch: launch === null ? null : tryResolveLaunch(launch, 'Точка запуска tincan.xml', issues, `${descriptorPath}#${identifier}`),
    resourceId: null,
    visible: true,
    masteryScore: null,
    maxTimeSeconds: null,
    timeLimitAction: null,
    launchData: null,
    // В tincan.xml активности лежат плоским списком, и объявить зависимость между ними негде.
    prerequisites: null,
    ...withoutSequencing(),
    // Всё, чем cmi5 описывает зачёт единицы, в xAPI решается правилами на стороне LRS.
    moveOn: null,
    launchMethod: null,
    entitlementKey: null,
    // `<contextTemplate>` — расширение course structure cmi5; в tincan.xml его не бывает.
    contextTemplate: null,
    // Тип активности — IRI: по нему LRS понимает, что за объект пришёл в statement'е.
    activityType: attr(node, 'type'),
    objectiveRefs: [],
    extensions: extensionsOf(node),
    children: [],
  };
}

/** `<extensions><extension key="…">значение</extension></extensions>` — произвольные пары автора. */
function extensionsOf(node: XmlNode): Record<string, string> {
  const extensions: Record<string, string> = {};
  for (const extension of array(child(node, 'extensions'), 'extension')) {
    const key = attr(extension, 'key');
    const text = asText(extension);
    // Первое объявление выигрывает: повтор ключа в одном наборе — это склейка, а не два значения.
    if (key && text !== null && !(key in extensions)) extensions[key] = text;
  }
  return extensions;
}

function launchOf(activity: XmlNode): string | null {
  return asText(value(activity, 'launch'));
}
