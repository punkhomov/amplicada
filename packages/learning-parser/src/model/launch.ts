import { resolveRelativePath, stripQueryAndFragment } from '../archive/paths.js';
import { PackageParseError } from '../errors.js';
import { issueWarning, type ValidationIssue } from '../issue.js';

/**
 * Куда пакет просит нас перейти при запуске.
 *
 * Разделение на путь и URL не формальность: SCORM-курс лежит внутри пакета и раздаётся нашим
 * прокси, а у xAPI/cmi5/AICC контент сплошь и рядом живёт на чужом сервере, и пакет — это только
 * описание. Смешать одно с другим значит либо искать в инвентаре то, чего там нет, либо открыть
 * учащемуся произвольный внешний адрес, считая его своим файлом.
 */
export interface LaunchTarget {
  /** Путь внутри пакета — если контент наш. Нормализован, без query и фрагмента. */
  entryPoint: string | null;
  /** Абсолютный URL — если контент внешний. */
  entryUrl: string | null;
  /** Хвост запуска (`?foo=1`, `#chapter2`). Для внешнего URL всегда пуст: он уже внутри `entryUrl`. */
  entryParameters: string;
}

/** `http://`, `https://`, протокол-относительный `//host/...` и всё прочее со схемой. */
const ABSOLUTE_URL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//;

/**
 * @param what — как назвать эту ссылку в тексте ошибки (`Точка входа`, `URL блока`).
 */
export function resolveLaunch(raw: string, what: string): LaunchTarget {
  const href = raw.trim();
  if (!href) throw new PackageParseError(`${what}: пустая ссылка`);

  if (ABSOLUTE_URL.test(href)) {
    return { entryPoint: null, entryUrl: href, entryParameters: '' };
  }

  // Схлопывающий резолв, а не строгая нормализация записи архива: `../` относительно `xml:base` в
  // манифесте законен и встречается у курсов с общим проигрывателем на несколько модулей.
  const entryPoint = resolveRelativePath(stripQueryAndFragment(href));
  if (!entryPoint) {
    // Не «не нашли», а «нашли и оно ведёт наружу»: `../../etc/passwd` — признак вредоносного
    // пакета, и молчаливо пропускать его нельзя.
    throw new PackageParseError(`${what} "${href}" выходит за пределы пакета`);
  }

  return { entryPoint, entryUrl: null, entryParameters: suffixOf(href) };
}

/**
 * Резолв, который не роняет разбор на одном кривом пункте.
 *
 * Дерево оглавления резолвит **каждый** пункт, а не только точку входа, и падать из-за изъяна в
 * глубине манифеста нельзя: запускать такой пункт мы всё равно не станем, а курс исправен. Но и
 * молча терять причину нельзя — поэтому каждая неудача становится отдельной находкой с местом.
 */
export function tryResolveLaunch(raw: string, what: string, issues: ValidationIssue[], location: string): LaunchTarget | null {
  try {
    return resolveLaunch(raw, what);
  } catch (error) {
    if (!(error instanceof PackageParseError)) throw error;
    issues.push(issueWarning('common.launch-unresolvable', error.message, location));
    return null;
  }
}

export function suffixOf(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? '' : href.slice(cut);
}

/**
 * Склейка хвостов запуска. `item/@parameters` в SCORM по спецификации уже содержит `?` или `#`;
 * если query есть и в `href`, второй знак вопроса делает URL нерабочим.
 */
export function joinParameters(fromHref: string, extra: string): string {
  if (!extra) return fromHref;
  if (!fromHref) return extra;
  if (fromHref.includes('?') && extra.startsWith('?')) return `${fromHref}&${extra.slice(1)}`;
  return `${fromHref}${extra}`;
}
