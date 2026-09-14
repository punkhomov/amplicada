import type { Cmi5ContextTemplate, MoveOn } from './details.js';
import type { LaunchTarget } from './launch.js';
import type { LangString } from './lom.js';
import type { Prerequisite } from './prerequisite.js';
import type { CompletionThreshold, Sequencing, SharedDataMap } from './sequencing.js';

/**
 * Пункт оглавления курса.
 *
 * Структура — то, на что вешается всё остальное: sequencing SCORM 2004 объявляется на пункте,
 * пререквизиты ссылаются на пункты по идентификатору, попытка прохождения относится к пункту, а не
 * к пакету. Курс из пяти SCO — это пять отдельных попыток со своими `lesson_status` и баллом.
 *
 * Форма одна на все форматы. Дерево бывает вырожденным: в xAPI вложенности нет по устройству
 * формата, в AICC без `.cst` — тоже.
 */
export interface Activity {
  /**
   * Идентификатор из пакета. Уникален внутри пакета: на него ссылаются пререквизиты, и к нему
   * привязывается попытка. Если автор его не указал, подставляется позиционный (`#0.1`) — символ
   * `#` в `xs:ID` недопустим, поэтому с настоящим он не столкнётся.
   */
  identifier: string;
  title: string | null;
  /**
   * Название на всех объявленных языках; ключ `""` — язык не объявлен. `title` — то же самое,
   * выбранное для показа, и остаётся тем, чем было: оглавление рисуется по нему.
   *
   * Отдельным полем, потому что в cmi5 и xAPI название повторяется по одному на язык, и брать
   * первый значило бы терять переводы — ровно то, чего мы не стали делать в LOM.
   */
  titles: LangString;
  /**
   * Описание пункта на всех объявленных языках. Скалярной пары у него нет намеренно: описание
   * пункта — не подпись в оглавлении, и выбирать язык за потребителя не за чем (`langText`).
   *
   * Пусто у SCORM: `<item>` описания не несёт, оно объявляется метаданными ресурса.
   */
  descriptions: LangString;
  /** Куда переходить. `null` у контейнеров — глав и модулей, которые сами не запускаются. */
  launch: LaunchTarget | null;
  /** Ресурс, из которого взята точка входа. Нужен правилам валидации (фаза 02). */
  resourceId: string | null;
  /**
   * Скрытый пункт остаётся в дереве, но не показывается в оглавлении: на него можно попасть
   * переходом, и sequencing на него ссылается.
   */
  visible: boolean;
  /** Доля 0..1. Объявляется на пункте, а не на пакете: у каждого SCO порог свой. */
  masteryScore: number | null;
  /** `cmi.student_data.max_time_allowed` — сколько всего отведено на попытку. */
  maxTimeSeconds: number | null;
  /** `cmi.student_data.time_limit_action` — что делать по исчерпании времени. */
  timeLimitAction: string | null;
  /** `cmi.launch_data` — строка, которую курс передаёт сам себе через манифест. */
  launchData: string | null;
  /**
   * Условие открытия: разобранное `adlcp:prerequisites` SCORM 1.2 или пререквизиты AICC. У cmi5 и
   * xAPI таких условий нет вовсе, у SCORM 2004 их роль играет sequencing.
   *
   * Проверять условие библиотека не берётся — для этого нужен ход попытки, которого у неё нет.
   * Дерево отдаётся вместе с `evaluatePrerequisites`, а звать его — дело рантайма.
   */
  prerequisites: Prerequisite | null;
  /**
   * Правила переходов и rollup. Только SCORM 2004: у остальных форматов и у пунктов без
   * `<imsss:sequencing>` — `null`.
   *
   * На пункте, а не на пакете, потому что так объявлено в формате: у каждой активности свой
   * `controlMode`, свои цели и свои лимиты попыток.
   */
  sequencing: Sequencing | null;
  /** `adlcp:completionThreshold` SCORM 2004 — доля пройденного, а не набранный балл. */
  completionThreshold: CompletionThreshold | null;
  /**
   * Кнопки навигации LMS, которые пункт просит спрятать (`continue`, `previous`, `exit`,
   * `abandon`, `suspendAll` и их `*All`-формы). Прямо влияет на то, что рисует плеер.
   */
  hiddenControls: string[];
  /** Общие «корзины» данных `adl.data`, к которым пункт обращается. */
  sharedData: SharedDataMap[];
  /**
   * Условие зачёта единицы cmi5. У остальных форматов `null`: SCORM решает это порогом и
   * sequencing, AICC — `lesson_status`, xAPI — правилами на стороне LRS.
   */
  moveOn: MoveOn | null;
  /** cmi5: `OwnWindow` / `AnyWindow` — открывать единицу в своём окне или можно в рамке. */
  launchMethod: string | null;
  /** cmi5: ключ доступа, который LMS обязана передать единице при запуске. */
  entitlementKey: string | null;
  /**
   * cmi5: заготовка контекста xAPI, объявленная на самой единице. Курсовая лежит в
   * `details.contextTemplate` — по спецификации это разные области, и сливать их должен тот, кто
   * собирает `LMS.LaunchData`, а не разборщик.
   */
  contextTemplate: Cmi5ContextTemplate | null;
  /** IRI типа активности: cmi5 и xAPI. По нему LRS понимает, что за объект пришёл в statement'е. */
  activityType: string | null;
  /**
   * Цели, с которыми связан пункт: `<objectives><objective idref>` в cmi5 и связи из `.ort` в AICC.
   * Сами цели описаны в `details` пакета — здесь только ссылки, потому что цель общая, а пунктов у
   * неё несколько.
   *
   * Не путать с `sequencing.objectives`: те принадлежат пункту и живут внутри его правил.
   */
  objectiveRefs: string[];
  /** Произвольные пары от автора: `<extensions><extension key>` в tincan.xml. */
  extensions: Record<string, string>;
  children: Activity[];
}

/**
 * Объявления, которых нет ни у одного формата, кроме SCORM 2004.
 *
 * Отдельной функцией, а не четырьмя `null` в каждом разборщике: формат, ничего не знающий про
 * sequencing, не должен перечислять его поля — а когда таких полей прибавится, он не должен об этом
 * узнать. Функцией, а не константой, потому что пустые списки нельзя раздавать по ссылке.
 */
export function withoutSequencing(): Pick<Activity, 'completionThreshold' | 'hiddenControls' | 'sequencing' | 'sharedData'> {
  return { sequencing: null, completionThreshold: null, hiddenControls: [], sharedData: [] };
}

/**
 * Объявления xAPI-семейства (cmi5 и Tin Can), которых нет ни у SCORM, ни у AICC.
 *
 * Отдельно от `withoutSequencing()`, а не одной свалкой «чего у меня нет»: наборы разные и по
 * составу, и по тому, кто их не заполняет. Общий помощник пришлось бы звать и тем, у кого половина
 * полей как раз есть.
 */
export function withoutXapiTraits(): Pick<
  Activity,
  'activityType' | 'contextTemplate' | 'entitlementKey' | 'extensions' | 'launchMethod' | 'moveOn'
> {
  return { moveOn: null, launchMethod: null, entitlementKey: null, contextTemplate: null, activityType: null, extensions: {} };
}

/** Обход в глубину, pre-order: порядок совпадает с тем, в каком пункты видны в оглавлении. */
export function* walkActivities(activities: readonly Activity[]): Generator<Activity> {
  for (const activity of activities) {
    yield activity;
    yield* walkActivities(activity.children);
  }
}

/** Пункты, которые действительно запускаются. Контейнеры сюда не попадают. */
export function launchableActivities(activities: readonly Activity[]): Activity[] {
  return [...walkActivities(activities)].filter(activity => activity.launch !== null);
}

/** Первый запускаемый пункт обхода — то, с чего курс открывается без выбора учащегося. */
export function firstLaunchable(activities: readonly Activity[]): Activity | null {
  for (const activity of walkActivities(activities)) {
    if (activity.launch) return activity;
  }
  return null;
}
