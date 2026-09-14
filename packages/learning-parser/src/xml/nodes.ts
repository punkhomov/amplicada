/**
 * Доступ к разобранному XML.
 *
 * Дерево от `fast-xml-parser` — это `unknown` любой формы: один и тот же элемент бывает строкой,
 * объектом или массивом в зависимости от того, что написал автор пакета. Хелперы ниже сводят все
 * варианты к одному и никогда не бросают: отсутствующий элемент — это `null`, а не исключение.
 */

export type XmlNode = Record<string, unknown>;

/** Первое значение элемента `name`, каким бы оно ни было: строкой, объектом или элементом массива. */
export function value(node: XmlNode | null | undefined, name: string): unknown {
  if (!node) return undefined;
  const raw = node[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  const single = value(node, name);
  return typeof single === 'object' && single !== null ? (single as XmlNode) : null;
}

export function array(node: XmlNode | null | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const raw = node[name];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is XmlNode => typeof entry === 'object' && entry !== null);
}

export function attr(node: XmlNode | null | undefined, name: string): string | null {
  if (!node) return null;
  const raw = node[`@_${name}`];
  if (typeof raw !== 'string') return null;
  return raw.trim() || null;
}

/**
 * Текст дочернего элемента. Без атрибутов парсер отдаёт строку (`<title>Курс</title>`), с
 * атрибутами — объект с `#text` (`<title xml:lang="ru">Курс</title>`); обрабатываются оба.
 */
export function textOf(node: XmlNode | null | undefined, name: string): string | null {
  return asText(value(node, name));
}

export function asText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'object' || raw === null) return null;
  const inner = (raw as XmlNode)['#text'];
  return typeof inner === 'string' ? inner.trim() || null : null;
}

/**
 * Подпись, которая бывает и простым текстом, и обёрткой с языками:
 * `<title>Курс</title>` либо `<title><langstring lang="ru">Курс</langstring></title>`.
 *
 * Язык не выбираем — берём первый. Выбирать было бы не по чему: язык учащегося на этапе разбора
 * пакета неизвестен, а хранить все переводы названия нам негде.
 */
export function labelOf(node: XmlNode | null | undefined, name: string): string | null {
  const direct = textOf(node, name);
  if (direct) return direct;
  return textOf(child(node, name), 'langstring');
}

/**
 * Все языки подписи, объявленной обёрткой: `<title><langstring lang="ru">Курс</langstring></title>`.
 * Голая строка тоже встречается — тогда язык неизвестен, и ключом становится пустая строка.
 *
 * Возвращается `LangString` из `model/lom.ts`, записанный структурно: `xml/` лежит слоем ниже
 * `model/` и импортировать оттуда не может, а заводить второе имя одному и тому же словарю незачем.
 */
export function labelsOf(node: XmlNode | null | undefined, name: string): Record<string, string> {
  const holder = value(node, name);
  const wrapped = collectLabels(typeof holder === 'object' && holder !== null ? (holder as XmlNode).langstring : undefined);
  if (Object.keys(wrapped).length) return wrapped;

  const plain = asText(holder);
  return plain === null ? {} : { '': plain };
}

/**
 * Все языки подписи, объявленной повторяющимися элементами: `<name lang="ru">Курс</name>` рядом с
 * `<name lang="en">Course</name>`. Так пишет `tincan.xml` — обёртки в этом формате нет.
 */
export function repeatedLabelsOf(node: XmlNode | null | undefined, name: string): Record<string, string> {
  return collectLabels(node ? node[name] : undefined);
}

/** Первый выигрывает: повтор одного языка в одном поле — это склейка шаблонов, а не перевод. */
function collectLabels(raw: unknown): Record<string, string> {
  const entries = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  const labels: Record<string, string> = {};

  for (const entry of entries) {
    const text = asText(entry);
    if (text === null) continue;
    const language = typeof entry === 'object' && entry !== null ? (attr(entry as XmlNode, 'lang') ?? '') : '';
    if (!(language in labels)) labels[language] = text;
  }

  return labels;
}
