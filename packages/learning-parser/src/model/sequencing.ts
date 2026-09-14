/**
 * Sequencing SCORM 2004 — правила, по которым LMS решает, куда учащемуся можно пойти дальше и как
 * статус детей складывается в статус родителя.
 *
 * Разбирается целиком, хотя мы его не проигрываем: разобрать правила и **исполнить** их — разные
 * задачи, и вторая это автомат состояний над деревом активностей, которому место в рантайме.
 * Рантайма у библиотеки нет и не будет, но потребителю, который однажды его напишет, нужны все
 * элементы, а не те, до которых дошли наши нужды.
 *
 * Значения по умолчанию проставлены при разборе, а не оставлены на потребителя: они заданы
 * спецификацией IMS SS однозначно, и повторять их в каждом читателе — способ разойтись.
 * Отсутствие элемента целиком при этом отличимо: тогда поле `null`.
 */

/**
 * Управление переходами: чем учащемуся разрешено пользоваться внутри этого пункта.
 *
 * Умолчания IMS SS: `choice`, `choiceExit`, `useCurrentAttempt*` — включены, `flow` и
 * `forwardOnly` — выключены. То есть по умолчанию курс — свободное оглавление без кнопки «дальше».
 */
export interface ControlMode {
  /** Свободный выбор пункта в оглавлении. */
  choice: boolean;
  /** Можно ли выйти из текущего пункта, выбрав другой. */
  choiceExit: boolean;
  /** Последовательный проход «дальше»/«назад». */
  flow: boolean;
  /** Только вперёд: «назад» запрещено. */
  forwardOnly: boolean;
  /** Учитывать ли цели текущей попытки при переходах (иначе — только завершённых). */
  useCurrentAttemptObjectiveInfo: boolean;
  useCurrentAttemptProgressInfo: boolean;
}

/**
 * Условие правила. Словарь закрыт спецификацией; значение вне словаря при разборе отбрасывается с
 * находкой, потому что положить его в тип некуда, а придумать за автора смысл нельзя.
 */
export type SequencingConditionName =
  | 'satisfied'
  | 'objectiveStatusKnown'
  | 'objectiveMeasureKnown'
  | 'objectiveMeasureGreaterThan'
  | 'objectiveMeasureLessThan'
  | 'completed'
  | 'activityProgressKnown'
  | 'attempted'
  | 'attemptLimitExceeded'
  | 'timeLimitExceeded'
  | 'outsideAvailableTimeRange'
  | 'always';

/**
 * Что делать, когда условие выполнилось. Набор зависит от того, когда правило проверяется:
 * `skip`/`disabled`/`hiddenFromChoice`/`stopForwardTraversal` — до доставки, `exit` — при выходе,
 * остальные — после.
 */
export type SequencingRuleAction =
  | 'skip'
  | 'disabled'
  | 'hiddenFromChoice'
  | 'stopForwardTraversal'
  | 'exit'
  | 'exitParent'
  | 'exitAll'
  | 'retry'
  | 'retryAll'
  | 'continue'
  | 'previous';

export interface SequencingCondition {
  condition: SequencingConditionName;
  /** `not` инвертирует условие. */
  operator: 'noOp' | 'not';
  /** Цель, о которой условие; `null` — первичная цель самого пункта. */
  referencedObjective: string | null;
  /** Порог для `objectiveMeasureGreaterThan`/`LessThan`: доля от −1 до 1. */
  measureThreshold: number | null;
}

export interface SequencingRule {
  /** Когда проверяется: перед доставкой пункта, при выходе из него, после выхода. */
  timing: 'pre' | 'exit' | 'post';
  /** Как складываются условия: все сразу или любое из. */
  conditionCombination: 'all' | 'any';
  conditions: SequencingCondition[];
  action: SequencingRuleAction;
}

/** У rollup словарь условий свой — уже, чем у правил перехода: порогов измерения здесь нет. */
export type RollupConditionName = Exclude<SequencingConditionName, 'objectiveMeasureGreaterThan' | 'objectiveMeasureLessThan'>;

export type RollupAction = 'satisfied' | 'notSatisfied' | 'completed' | 'incomplete';

export interface RollupCondition {
  condition: RollupConditionName;
  operator: 'noOp' | 'not';
}

export interface RollupRule {
  /** Какие дети засчитываются: все, любой, ни одного, не менее скольких-то. */
  childActivitySet: 'all' | 'any' | 'none' | 'atLeastCount' | 'atLeastPercent';
  /** Порог для `atLeastCount`. */
  minimumCount: number | null;
  /** Порог для `atLeastPercent`, доля 0..1. */
  minimumPercent: number | null;
  conditionCombination: 'all' | 'any';
  conditions: RollupCondition[];
  action: RollupAction;
}

/**
 * Как статус пункта попадает в статус родителя. Три атрибута на контейнере — про сам пункт
 * (участвует ли он в подсчёте у родителя), список правил — про то, как пункт считает своих детей.
 */
export interface RollupRules {
  /** Учитывается ли «пройдено» этого пункта при подсчёте у родителя. */
  rollupObjectiveSatisfied: boolean;
  /** То же для «завершено». */
  rollupProgressCompletion: boolean;
  /** Вес пункта при усреднении измерения по детям, 0..1. Ноль означает «не влияет». */
  objectiveMeasureWeight: number;
  rules: RollupRule[];
}

/**
 * Обмен результатом с глобальной целью — единственный механизм, которым два SCO узнают что-то друг
 * о друге. Без него курс с общей целью «пройден» ведёт себя необъяснимо: пункт закрывается, потому
 * что закрыли соседний.
 *
 * Умолчания: читать — да, писать — нет. `readCompletionStatus`/`writeCompletionStatus` и пара про
 * прогресс добавлены 4-й редакцией.
 */
export interface ObjectiveMap {
  /** Идентификатор глобальной цели — общей на весь курс, а не на пункт. */
  targetId: string;
  readSatisfiedStatus: boolean;
  readNormalizedMeasure: boolean;
  writeSatisfiedStatus: boolean;
  writeNormalizedMeasure: boolean;
  readCompletionStatus: boolean;
  readProgressMeasure: boolean;
  writeCompletionStatus: boolean;
  writeProgressMeasure: boolean;
}

export interface Objective {
  /** Идентификатор цели внутри пункта. У первичной бывает не объявлен. */
  id: string | null;
  /** Считать ли цель достигнутой по измерению, а не по тому, что сказал сам курс. */
  satisfiedByMeasure: boolean;
  /** Порог измерения, доля 0..1. Для первичной цели это и есть проходной балл SCORM 2004. */
  minNormalizedMeasure: number | null;
  maps: ObjectiveMap[];
}

/**
 * Первичная цель определяет, пройден ли пункт; вторичные — способ хранить дополнительные
 * результаты и обмениваться ими через глобальные цели.
 */
export interface Objectives {
  primary: Objective | null;
  secondary: Objective[];
}

/**
 * Лимиты попытки. SCORM 2004 обязывает LMS поддерживать только `attemptLimit` и
 * `attemptAbsoluteDurationLimit`, остальные объявлены в схеме IMS SS и встречаются в пакетах —
 * поэтому читаются все, а решать, что из этого соблюдать, потребителю.
 */
export interface LimitConditions {
  attemptLimit: number | null;
  /** Секунды: в описателе это ISO 8601, `PT1H30M`. */
  attemptAbsoluteDurationSeconds: number | null;
  attemptExperiencedDurationSeconds: number | null;
  activityAbsoluteDurationSeconds: number | null;
  activityExperiencedDurationSeconds: number | null;
  /** Момент, раньше которого пункт недоступен; как записан в описателе, без разбора в дату. */
  beginTimeLimit: string | null;
  endTimeLimit: string | null;
}

/** Перемешивание и отбор детей: тесты так делают разные варианты из общего банка вопросов. */
export interface RandomizationControls {
  /** Когда перемешивать: `never`, `once`, `onEachNewAttempt`. */
  randomizationTiming: 'never' | 'once' | 'onEachNewAttempt';
  reorderChildren: boolean;
  /** Когда отбирать подмножество детей. */
  selectionTiming: 'never' | 'once' | 'onEachNewAttempt';
  /** Сколько детей отобрать. */
  selectCount: number | null;
}

/** Кто решает, пройден ли пункт: сам курс через API или LMS по правилам rollup. */
export interface DeliveryControls {
  /** Отслеживается ли пункт вообще. `false` — прохождение не записывается. */
  tracked: boolean;
  completionSetByContent: boolean;
  objectiveSetByContent: boolean;
}

/** Вспомогательный материал: глоссарий, справка, калькулятор. Ресурс — по идентификатору. */
export interface AuxiliaryResource {
  resourceId: string | null;
  purpose: string | null;
}

/** Только 4-я редакция: насколько жёстко ограничивать выбор пункта в оглавлении. */
export interface ConstrainedChoiceConsiderations {
  preventActivation: boolean;
  constrainChoice: boolean;
}

/** Условие участия в rollup: всегда либо только если пункт был начат / не пропущен / не отложен. */
export type RollupConsideration = 'always' | 'ifAttempted' | 'ifNotSkipped' | 'ifNotSuspended';

/** Только 4-я редакция: уточнение, при каких условиях пункт вообще учитывается в rollup. */
export interface RollupConsiderations {
  requiredForSatisfied: RollupConsideration;
  requiredForNotSatisfied: RollupConsideration;
  requiredForCompleted: RollupConsideration;
  requiredForIncomplete: RollupConsideration;
  measureSatisfactionIfActive: boolean;
}

/**
 * Sequencing одного пункта дерева.
 *
 * `IDRef` на блок из `<imsss:sequencingCollection>` разрешается при разборе: иначе потребитель
 * получил бы наполовину пустой узел и полез читать манифест сам — то есть делать за библиотеку её
 * работу. Объявленное по месту перекрывает общее поэлементно, как и требует спецификация.
 */
export interface Sequencing {
  /** `ID` блока, если пункт объявляет sequencing для переиспользования другими. */
  id: string | null;
  controlMode: ControlMode | null;
  sequencingRules: SequencingRule[];
  rollupRules: RollupRules | null;
  objectives: Objectives | null;
  limitConditions: LimitConditions | null;
  randomizationControls: RandomizationControls | null;
  deliveryControls: DeliveryControls | null;
  auxiliaryResources: AuxiliaryResource[];
  constrainedChoiceConsiderations: ConstrainedChoiceConsiderations | null;
  rollupConsiderations: RollupConsiderations | null;
}

/**
 * Пользуется ли курс sequencing на самом деле.
 *
 * Сборщики ставят пустой `<imsss:sequencing/>` на каждый пункт «на всякий случай», и по одному
 * факту его наличия судить нельзя. Курс 2004 без настоящего sequencing отличается от 1.2
 * переименованными элементами модели данных и больше ничем — то есть проигрывается почти тем же
 * рантаймом, и это стоит знать заранее.
 *
 * Не решение о приёме, а факт: что делать с ним, решает потребитель.
 */
export interface SequencingUsage {
  used: boolean;
  /**
   * Что именно найдено: `controlMode.flow`, `sequencingRules.pre`, `objectives.mapInfo`. Без
   * перечня `used: false` невозможно перепроверить, а `true` — объяснить.
   */
  indicators: string[];
}

/** Порог завершённости — не то же, что проходной балл: он про «сколько пройдено», а не «на сколько». */
export interface CompletionThreshold {
  /** Доля 0..1, при которой пункт считается завершённым. */
  minProgressMeasure: number | null;
  /** Вес пункта при подсчёте прогресса родителя. */
  progressWeight: number | null;
  /** Завершать по измерению прогресса, а не по слову курса. */
  completedByMeasure: boolean;
}

/**
 * Общая «корзина» данных (`adl.data`): способ передать что-то между SCO, не заводя глобальную цель.
 * Хранит произвольную строку, поэтому курсы держат в ней всё — от выбранного языка до состояния.
 */
export interface SharedDataMap {
  targetId: string;
  readable: boolean;
  writable: boolean;
}
