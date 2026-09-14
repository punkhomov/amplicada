import { issueWarning, type ValidationIssue } from '../../issue.js';
import { type Activity, walkActivities } from '../../model/activity.js';
import { parseDurationSeconds } from '../../model/duration.js';
import type {
  AuxiliaryResource,
  CompletionThreshold,
  ConstrainedChoiceConsiderations,
  ControlMode,
  DeliveryControls,
  LimitConditions,
  Objective,
  ObjectiveMap,
  Objectives,
  RandomizationControls,
  RollupAction,
  RollupConditionName,
  RollupConsideration,
  RollupConsiderations,
  RollupRule,
  RollupRules,
  Sequencing,
  SequencingCondition,
  SequencingConditionName,
  SequencingRule,
  SequencingRuleAction,
  SequencingUsage,
  SharedDataMap,
} from '../../model/sequencing.js';
import { array, asText, attr, child, textOf, value, type XmlNode } from '../../xml/nodes.js';

/**
 * Объявления SCORM 2004 на пункте оглавления: `<imsss:sequencing>` и его соседи из `adlcp`/`adlnav`.
 *
 * Всё это разбирается целиком, хотя рантайма 2004 у нас нет: полнота разбора — свойство библиотеки
 * формата, а не следствие того, что понадобилось нашему модулю обучения. Исполнять правила мы не
 * беремся — это автомат состояний, и ему место в плеере.
 *
 * Значения по умолчанию проставляются здесь, а не оставляются потребителю: они заданы
 * спецификацией IMS SS однозначно, и повторять их в каждом читателе — способ разойтись. Отсутствие
 * элемента целиком при этом остаётся отличимым: тогда поле `null`.
 *
 * Повторяемые элементы перечислены в `manifest.ts` — списком «всегда массив» для читателя XML.
 */

/**
 * Теги sequencing, которые бывают в единственном числе и во множественном. Без этого списка
 * одиночное правило приезжает объектом, а не массивом, и теряется в обходе.
 */
export const SEQUENCING_ARRAY_TAGS = [
  'sequencing',
  'preConditionRule',
  'exitConditionRule',
  'postConditionRule',
  'ruleCondition',
  'rollupRule',
  'rollupCondition',
  'objective',
  'mapInfo',
  'auxiliaryResource',
  'hideLMSUI',
  'map',
] as const;

interface Context {
  issues: ValidationIssue[];
  /** Куда указывать в находках: `imsmanifest.xml#item_1`. */
  where: string;
}

/**
 * `<imsss:sequencingCollection>` — переиспользуемые блоки на уровне манифеста, на которые пункты
 * ссылаются через `IDRef`.
 */
export function indexSequencingCollection(root: XmlNode): Map<string, XmlNode> {
  const index = new Map<string, XmlNode>();
  for (const node of array(child(root, 'sequencingCollection'), 'sequencing')) {
    const id = attrOf(node, 'ID', 'id');
    // Первый выигрывает, как и с ресурсами: дубли встречаются в склеенных пакетах.
    if (id && !index.has(id)) index.set(id, node);
  }
  return index;
}

export function parseSequencing(
  item: XmlNode,
  collection: Map<string, XmlNode>,
  issues: ValidationIssue[],
  where: string,
): Sequencing | null {
  // Пустой `<imsss:sequencing/>` парсер отдаёт строкой, а не узлом. Это по-прежнему объявление —
  // просто пустое, и `null` на его месте означал бы «автор ничего не писал», что неправда:
  // формально объявленный sequencing отличается от отсутствующего, и детектор судит как раз по этому.
  const raw = value(item, 'sequencing');
  if (raw === undefined) return null;
  const local = typeof raw === 'object' && raw !== null ? (raw as XmlNode) : {};

  const context: Context = { issues, where };
  const node = resolveShared(local, collection, context);
  const controlModeNode = child(node, 'controlMode');
  const controlMode = parseControlMode(controlModeNode);

  // `choiceExit` включён по умолчанию, поэтому сам по себе он ни о чём не говорит; смысл имеет
  // только явная пара «выбор запрещён, а выход по выбору разрешён» — она внутренне противоречива.
  if (controlMode && !controlMode.choice && flag(controlModeNode, 'choiceExit', false)) {
    issues.push(
      issueWarning(
        'scorm.choice-exit-without-choice',
        'choiceExit объявлен при выключенном choice — выходить по выбору некуда, выбора нет',
        where,
      ),
    );
  }

  return {
    id: attrOf(node, 'ID', 'id'),
    controlMode,
    sequencingRules: parseSequencingRules(child(node, 'sequencingRules'), context),
    rollupRules: parseRollupRules(child(node, 'rollupRules'), context),
    objectives: parseObjectives(child(node, 'objectives')),
    limitConditions: parseLimitConditions(child(node, 'limitConditions')),
    randomizationControls: parseRandomization(child(node, 'randomizationControls'), context),
    deliveryControls: parseDeliveryControls(child(node, 'deliveryControls')),
    auxiliaryResources: array(child(node, 'auxiliaryResources'), 'auxiliaryResource').map(parseAuxiliary),
    constrainedChoiceConsiderations: parseConstrainedChoice(child(node, 'constrainedChoiceConsiderations')),
    rollupConsiderations: parseRollupConsiderations(child(node, 'rollupConsiderations'), context),
  };
}

/**
 * Ссылка на общий блок разрешается здесь, а не отдаётся наружу: иначе потребитель получил бы
 * наполовину пустой узел и полез читать манифест сам — то есть делать за библиотеку её работу.
 *
 * Перекрытие поэлементное, объявленное по месту важнее общего: так требует спецификация, и так же
 * ведёт себя обычное наследование. Слияние поверхностное — этого достаточно, потому что ключи здесь
 * это имена элементов первого уровня.
 */
function resolveShared(local: XmlNode, collection: Map<string, XmlNode>, context: Context): XmlNode {
  const ref = attrOf(local, 'IDRef', 'IDref', 'idref');
  if (!ref) return local;

  const shared = collection.get(ref);
  if (!shared) {
    context.issues.push(
      issueWarning(
        'scorm.sequencing-ref-dangling',
        `Ссылка на общий блок sequencing "${ref}", которого нет в sequencingCollection`,
        context.where,
        'Проверьте, что блок объявлен в <imsss:sequencingCollection> с таким же ID',
      ),
    );
    return local;
  }

  return { ...shared, ...local };
}

function parseControlMode(node: XmlNode | null): ControlMode | null {
  if (!node) return null;
  return {
    choice: flag(node, 'choice', true),
    choiceExit: flag(node, 'choiceExit', true),
    flow: flag(node, 'flow', false),
    forwardOnly: flag(node, 'forwardOnly', false),
    useCurrentAttemptObjectiveInfo: flag(node, 'useCurrentAttemptObjectiveInfo', true),
    useCurrentAttemptProgressInfo: flag(node, 'useCurrentAttemptProgressInfo', true),
  };
}

const CONDITION_NAMES: readonly SequencingConditionName[] = [
  'satisfied',
  'objectiveStatusKnown',
  'objectiveMeasureKnown',
  'objectiveMeasureGreaterThan',
  'objectiveMeasureLessThan',
  'completed',
  'activityProgressKnown',
  'attempted',
  'attemptLimitExceeded',
  'timeLimitExceeded',
  'outsideAvailableTimeRange',
  'always',
];

const RULE_ACTIONS: readonly SequencingRuleAction[] = [
  'skip',
  'disabled',
  'hiddenFromChoice',
  'stopForwardTraversal',
  'exit',
  'exitParent',
  'exitAll',
  'retry',
  'retryAll',
  'continue',
  'previous',
];

/** Три вида правил различаются только моментом проверки, поэтому разбираются одним кодом. */
const RULE_KINDS: readonly (readonly [string, SequencingRule['timing']])[] = [
  ['preConditionRule', 'pre'],
  ['exitConditionRule', 'exit'],
  ['postConditionRule', 'post'],
];

function parseSequencingRules(node: XmlNode | null, context: Context): SequencingRule[] {
  if (!node) return [];

  return RULE_KINDS.flatMap(([element, timing]) =>
    array(node, element).flatMap(rule => {
      const action = pick(child(rule, 'ruleAction'), 'action', RULE_ACTIONS, context);
      // Правило без внятного действия не делает ничего — держать его в результате значило бы
      // показать потребителю правило, которого нет. О причине уже сказано находкой в `pick`.
      if (!action) return [];

      const conditions = child(rule, 'ruleConditions');
      return [
        {
          timing,
          conditionCombination: pick(conditions, 'conditionCombination', COMBINATIONS, context) ?? 'all',
          conditions: array(conditions, 'ruleCondition').flatMap(one => parseCondition(one, context)),
          action,
        },
      ];
    }),
  );
}

const COMBINATIONS = ['all', 'any'] as const;
const OPERATORS = ['noOp', 'not'] as const;

function parseCondition(node: XmlNode, context: Context): SequencingCondition[] {
  const condition = pick(node, 'condition', CONDITION_NAMES, context);
  if (!condition) return [];

  return [
    {
      condition,
      operator: pick(node, 'operator', OPERATORS, context) ?? 'noOp',
      referencedObjective: attr(node, 'referencedObjective'),
      // Диапазон здесь −1..1, а не 0..1: измерение бывает отрицательным.
      measureThreshold: decimal(node, 'measureThreshold', -1, 1),
    },
  ];
}

const ROLLUP_CONDITION_NAMES: readonly RollupConditionName[] = CONDITION_NAMES.filter(
  (name): name is RollupConditionName => name !== 'objectiveMeasureGreaterThan' && name !== 'objectiveMeasureLessThan',
);

const ROLLUP_ACTIONS: readonly RollupAction[] = ['satisfied', 'notSatisfied', 'completed', 'incomplete'];
const CHILD_SETS = ['all', 'any', 'none', 'atLeastCount', 'atLeastPercent'] as const;

function parseRollupRules(node: XmlNode | null, context: Context): RollupRules | null {
  if (!node) return null;

  return {
    rollupObjectiveSatisfied: flag(node, 'rollupObjectiveSatisfied', true),
    rollupProgressCompletion: flag(node, 'rollupProgressCompletion', true),
    objectiveMeasureWeight: decimal(node, 'objectiveMeasureWeight', 0, 1) ?? 1,
    rules: array(node, 'rollupRule').flatMap(rule => parseRollupRule(rule, context)),
  };
}

function parseRollupRule(node: XmlNode, context: Context): RollupRule[] {
  const action = pick(child(node, 'rollupAction'), 'action', ROLLUP_ACTIONS, context);
  if (!action) return [];

  const conditions = child(node, 'rollupConditions');
  return [
    {
      childActivitySet: pick(node, 'childActivitySet', CHILD_SETS, context) ?? 'all',
      minimumCount: count(node, 'minimumCount'),
      minimumPercent: decimal(node, 'minimumPercent', 0, 1),
      conditionCombination: pick(conditions, 'conditionCombination', COMBINATIONS, context) ?? 'any',
      conditions: array(conditions, 'rollupCondition').flatMap(one => {
        const condition = pick(one, 'condition', ROLLUP_CONDITION_NAMES, context);
        return condition ? [{ condition, operator: pick(one, 'operator', OPERATORS, context) ?? 'noOp' }] : [];
      }),
      action,
    },
  ];
}

function parseObjectives(node: XmlNode | null): Objectives | null {
  if (!node) return null;
  const primary = child(node, 'primaryObjective');
  return {
    primary: primary ? parseObjective(primary) : null,
    secondary: array(node, 'objective').map(parseObjective),
  };
}

function parseObjective(node: XmlNode): Objective {
  return {
    id: attr(node, 'objectiveID'),
    satisfiedByMeasure: flag(node, 'satisfiedByMeasure', false),
    minNormalizedMeasure: fraction(textOf(node, 'minNormalizedMeasure')),
    maps: array(node, 'mapInfo').flatMap(parseObjectiveMap),
  };
}

/** Карта без цели-получателя не связывает ничего: без `targetObjectiveID` класть в модель нечего. */
function parseObjectiveMap(node: XmlNode): ObjectiveMap[] {
  const targetId = attr(node, 'targetObjectiveID');
  if (!targetId) return [];

  return [
    {
      targetId,
      readSatisfiedStatus: flag(node, 'readSatisfiedStatus', true),
      readNormalizedMeasure: flag(node, 'readNormalizedMeasure', true),
      writeSatisfiedStatus: flag(node, 'writeSatisfiedStatus', false),
      writeNormalizedMeasure: flag(node, 'writeNormalizedMeasure', false),
      readCompletionStatus: flag(node, 'readCompletionStatus', true),
      readProgressMeasure: flag(node, 'readProgressMeasure', true),
      writeCompletionStatus: flag(node, 'writeCompletionStatus', false),
      writeProgressMeasure: flag(node, 'writeProgressMeasure', false),
    },
  ];
}

function parseLimitConditions(node: XmlNode | null): LimitConditions | null {
  if (!node) return null;
  return {
    attemptLimit: count(node, 'attemptLimit'),
    attemptAbsoluteDurationSeconds: parseDurationSeconds(attr(node, 'attemptAbsoluteDurationLimit')),
    attemptExperiencedDurationSeconds: parseDurationSeconds(attr(node, 'attemptExperiencedDurationLimit')),
    activityAbsoluteDurationSeconds: parseDurationSeconds(attr(node, 'activityAbsoluteDurationLimit')),
    activityExperiencedDurationSeconds: parseDurationSeconds(attr(node, 'activityExperiencedDurationLimit')),
    beginTimeLimit: attr(node, 'beginTimeLimit'),
    endTimeLimit: attr(node, 'endTimeLimit'),
  };
}

const TIMINGS = ['never', 'once', 'onEachNewAttempt'] as const;

function parseRandomization(node: XmlNode | null, context: Context): RandomizationControls | null {
  if (!node) return null;
  return {
    randomizationTiming: pick(node, 'randomizationTiming', TIMINGS, context) ?? 'never',
    reorderChildren: flag(node, 'reorderChildren', false),
    selectionTiming: pick(node, 'selectionTiming', TIMINGS, context) ?? 'never',
    selectCount: count(node, 'selectCount'),
  };
}

function parseDeliveryControls(node: XmlNode | null): DeliveryControls | null {
  if (!node) return null;
  return {
    tracked: flag(node, 'tracked', true),
    completionSetByContent: flag(node, 'completionSetByContent', false),
    objectiveSetByContent: flag(node, 'objectiveSetByContent', false),
  };
}

function parseAuxiliary(node: XmlNode): AuxiliaryResource {
  return { resourceId: attr(node, 'auxiliaryResourceID'), purpose: attr(node, 'purpose') };
}

function parseConstrainedChoice(node: XmlNode | null): ConstrainedChoiceConsiderations | null {
  if (!node) return null;
  return { preventActivation: flag(node, 'preventActivation', false), constrainChoice: flag(node, 'constrainChoice', false) };
}

const CONSIDERATIONS: readonly RollupConsideration[] = ['always', 'ifAttempted', 'ifNotSkipped', 'ifNotSuspended'];

function parseRollupConsiderations(node: XmlNode | null, context: Context): RollupConsiderations | null {
  if (!node) return null;
  return {
    requiredForSatisfied: pick(node, 'requiredForSatisfied', CONSIDERATIONS, context) ?? 'always',
    requiredForNotSatisfied: pick(node, 'requiredForNotSatisfied', CONSIDERATIONS, context) ?? 'always',
    requiredForCompleted: pick(node, 'requiredForCompleted', CONSIDERATIONS, context) ?? 'always',
    requiredForIncomplete: pick(node, 'requiredForIncomplete', CONSIDERATIONS, context) ?? 'always',
    measureSatisfactionIfActive: flag(node, 'measureSatisfactionIfActive', true),
  };
}

/**
 * `adlcp:completionThreshold`.
 *
 * Во 2-й редакции это было просто число в тексте элемента, с 3-й — набор атрибутов. Встречаются оба
 * написания, поэтому читаются оба: текстовая форма означала ровно «завершать по измерению», и
 * `completedByMeasure` для неё выводится, а не додумывается.
 */
export function parseCompletionThreshold(item: XmlNode): CompletionThreshold | null {
  const node = child(item, 'completionThreshold');
  const legacy = fraction(textOf(item, 'completionThreshold'));
  if (!node && legacy === null) return null;
  if (!node) return { minProgressMeasure: legacy, progressWeight: null, completedByMeasure: true };

  const inline = fraction(textOf(node, '#text'));
  return {
    minProgressMeasure: fraction(attr(node, 'minProgressMeasure')) ?? inline,
    progressWeight: decimal(node, 'progressWeight', 0, 1),
    completedByMeasure: flag(node, 'completedByMeasure', inline !== null),
  };
}

/**
 * `<adlnav:presentation><adlnav:navigationInterface><adlnav:hideLMSUI>continue</adlnav:hideLMSUI>`.
 *
 * Значения не сверяются со словарём: список кнопок пополнялся от редакции к редакции, а спрятать
 * незнакомую нам кнопку плеер всё равно не сможет — вреда от неизвестного значения нет.
 */
export function parseHiddenControls(item: XmlNode): string[] {
  const node = child(child(item, 'presentation'), 'navigationInterface');
  // Элемент без атрибутов парсер отдаёт строкой, а не узлом, поэтому `array` здесь не годится:
  // список кнопок в живых пакетах как раз без атрибутов и написан.
  const raw = node?.hideLMSUI;
  const entries = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return [...new Set(entries.map(asText).filter((name): name is string => name !== null))];
}

/** `<adlcp:data><adlcp:map targetID="bucket" readSharedData="true" writeSharedData="true"/>`. */
export function parseSharedData(item: XmlNode): SharedDataMap[] {
  return array(child(item, 'data'), 'map').flatMap(node => {
    const targetId = attr(node, 'targetID');
    if (!targetId) return [];
    return [{ targetId, readable: flag(node, 'readSharedData', true), writable: flag(node, 'writeSharedData', true) }];
  });
}

/**
 * Пользуется ли курс sequencing на самом деле.
 *
 * Считается по разобранному дереву, а не по сырым узлам манифеста: иначе перечень признаков пришлось
 * бы писать дважды — сначала по XML, потом по модели, — и они разъехались бы на первом же дополнении.
 *
 * Признаком считается только то, что меняет поведение. Объявленный `controlMode` с умолчаниями,
 * пустой `<imsss:objectives/>` и `<imsss:limitConditions/>` без единого лимита ничего не меняют:
 * сборщики ставят их «на всякий случай», и засчитывать их значило бы отвечать `true` всегда.
 */
export function describeSequencingUsage(activities: readonly Activity[]): SequencingUsage {
  const indicators = new Set<string>();

  for (const activity of walkActivities(activities)) {
    for (const indicator of indicatorsOf(activity.sequencing)) indicators.add(indicator);
  }

  return { used: indicators.size > 0, indicators: [...indicators] };
}

function indicatorsOf(sequencing: Sequencing | null): string[] {
  if (!sequencing) return [];
  const found: string[] = [];

  const mode = sequencing.controlMode;
  if (mode?.flow) found.push('controlMode.flow');
  if (mode?.forwardOnly) found.push('controlMode.forwardOnly');
  if (mode && !mode.choice) found.push('controlMode.choice-off');

  for (const rule of sequencing.sequencingRules) found.push(`sequencingRules.${rule.timing}`);

  const rollup = sequencing.rollupRules;
  if (rollup?.rules.length) found.push('rollupRules');
  if (rollup && !(rollup.rollupObjectiveSatisfied && rollup.rollupProgressCompletion)) found.push('rollupRules.excluded');
  if (rollup && rollup.objectiveMeasureWeight !== 1) found.push('rollupRules.measureWeight');

  const objectives = sequencing.objectives;
  const all = objectives ? [objectives.primary, ...objectives.secondary].filter(objective => objective !== null) : [];
  if (all.some(objective => objective.maps.length)) found.push('objectives.mapInfo');
  if (all.some(objective => objective.minNormalizedMeasure !== null)) found.push('objectives.minNormalizedMeasure');
  if (objectives?.secondary.length) found.push('objectives.secondary');

  const limits = sequencing.limitConditions;
  if (limits && Object.values(limits).some(value => value !== null)) found.push('limitConditions');

  const random = sequencing.randomizationControls;
  if (random && (random.randomizationTiming !== 'never' || random.selectionTiming !== 'never')) found.push('randomizationControls');

  const delivery = sequencing.deliveryControls;
  if (delivery && (delivery.completionSetByContent || delivery.objectiveSetByContent || !delivery.tracked)) {
    found.push('deliveryControls');
  }

  if (sequencing.auxiliaryResources.length) found.push('auxiliaryResources');
  if (sequencing.constrainedChoiceConsiderations) found.push('constrainedChoiceConsiderations');
  if (sequencing.rollupConsiderations) found.push('rollupConsiderations');

  return found;
}

/** Глобальные цели видны только в сумме: по отдельному пункту не понять, обменивается он с кем-то или нет. */
export function collectGlobalObjectives(activities: readonly Activity[]): string[] {
  const targets = new Set<string>();

  for (const activity of walkActivities(activities)) {
    const objectives = activity.sequencing?.objectives;
    if (!objectives) continue;
    for (const objective of [objectives.primary, ...objectives.secondary]) {
      for (const map of objective?.maps ?? []) targets.add(map.targetId);
    }
  }

  return [...targets];
}

export function collectSharedDataTargets(activities: readonly Activity[]): string[] {
  const targets = new Set<string>();
  for (const activity of walkActivities(activities)) {
    for (const map of activity.sharedData) targets.add(map.targetId);
  }
  return [...targets];
}

function attrOf(node: XmlNode | null, ...names: readonly string[]): string | null {
  for (const name of names) {
    const found = attr(node, name);
    if (found) return found;
  }
  return null;
}

function flag(node: XmlNode | null, name: string, fallback: boolean): boolean {
  const raw = attr(node, name)?.toLowerCase();
  // `1`/`0` — законная запись xs:boolean, и сборщики ей пользуются.
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

function decimal(node: XmlNode | null, name: string, min: number, max: number): number | null {
  const raw = attr(node, name);
  return raw === null ? null : fractionWithin(raw, min, max);
}

function count(node: XmlNode | null, name: string): number | null {
  const raw = attr(node, name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function fraction(raw: string | null): number | null {
  return raw === null ? null : fractionWithin(raw, 0, 1);
}

/**
 * Значение вне шкалы — ошибка автора пакета, и придумывать за него «наверное, проценты» нельзя:
 * `0.8` и `80` в поле доли отличаются в сто раз, и угадав неверно, мы закроем курс тому, кто его сдал.
 */
function fractionWithin(raw: string, min: number, max: number): number | null {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed >= min && parsed <= max ? parsed : null;
}

/**
 * Значение вне словаря отбрасывается с находкой: положить его в тип некуда, а придумать за автора
 * смысл нельзя. Молча подставить умолчание было бы хуже — курс вёл бы себя не так, как написано в
 * его же манифесте, и объяснить это было бы нечем.
 */
function pick<T extends string>(node: XmlNode | null, name: string, allowed: readonly T[], context: Context): T | null {
  const raw = attr(node, name);
  if (raw === null) return null;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;

  context.issues.push(issueWarning('scorm.sequencing-value-unknown', `Недопустимое значение ${name}="${raw}" в sequencing`, context.where));
  return null;
}
