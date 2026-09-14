import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../../issue.js';
import { type Activity, walkActivities } from '../../model/activity.js';
import type { Scorm2004Details } from '../../model/details.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { parseManifest } from './manifest.js';

/**
 * Форма пакета ADL Golf из Sequencing and Navigation: sequencing здесь объявлен по-настоящему, а не
 * пустым элементом «на всякий случай».
 */
const GOLF_2004 = `<?xml version="1.0"?>
<manifest identifier="golf.2004" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Гольф</title>
      <item identifier="chapter">
        <title>Глава</title>
        <imsss:sequencing>
          <imsss:rollupRules rollupObjectiveSatisfied="true" rollupProgressCompletion="false" objectiveMeasureWeight="0.5">
            <imsss:rollupRule childActivitySet="atLeastCount" minimumCount="2">
              <imsss:rollupConditions conditionCombination="all">
                <imsss:rollupCondition condition="completed"/>
                <imsss:rollupCondition condition="satisfied" operator="not"/>
              </imsss:rollupConditions>
              <imsss:rollupAction action="notSatisfied"/>
            </imsss:rollupRule>
          </imsss:rollupRules>
        </imsss:sequencing>
        <item identifier="lesson1" identifierref="r1">
          <title>Урок 1</title>
          <adlcp:completionThreshold minProgressMeasure="0.8" progressWeight="0.5" completedByMeasure="true"/>
          <adlnav:presentation>
            <adlnav:navigationInterface>
              <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
              <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
            </adlnav:navigationInterface>
          </adlnav:presentation>
          <adlcp:data>
            <adlcp:map targetID="shared_state" readSharedData="true" writeSharedData="false"/>
          </adlcp:data>
          <imsss:sequencing>
            <imsss:controlMode choice="false" flow="true" forwardOnly="true"/>
            <imsss:sequencingRules>
              <imsss:preConditionRule>
                <imsss:ruleConditions conditionCombination="any">
                  <imsss:ruleCondition condition="satisfied" operator="not" referencedObjective="obj_intro"/>
                </imsss:ruleConditions>
                <imsss:ruleAction action="skip"/>
              </imsss:preConditionRule>
              <imsss:postConditionRule>
                <imsss:ruleConditions>
                  <imsss:ruleCondition condition="objectiveMeasureLessThan" measureThreshold="0.5"/>
                </imsss:ruleConditions>
                <imsss:ruleAction action="retry"/>
              </imsss:postConditionRule>
            </imsss:sequencingRules>
            <imsss:limitConditions attemptLimit="3" attemptAbsoluteDurationLimit="PT1H30M"/>
            <imsss:objectives>
              <imsss:primaryObjective objectiveID="obj_lesson1" satisfiedByMeasure="true">
                <imsss:minNormalizedMeasure>0.75</imsss:minNormalizedMeasure>
                <imsss:mapInfo targetObjectiveID="course_passed" readSatisfiedStatus="false" writeSatisfiedStatus="true"/>
              </imsss:primaryObjective>
              <imsss:objective objectiveID="obj_extra"/>
            </imsss:objectives>
            <imsss:randomizationControls randomizationTiming="onEachNewAttempt" reorderChildren="true" selectCount="3" selectionTiming="once"/>
            <imsss:deliveryControls tracked="true" completionSetByContent="true" objectiveSetByContent="false"/>
            <imsss:auxiliaryResources>
              <imsss:auxiliaryResource auxiliaryResourceID="glossary" purpose="glossary"/>
            </imsss:auxiliaryResources>
            <adlseq:constrainedChoiceConsiderations preventActivation="true" constrainChoice="true"/>
            <adlseq:rollupConsiderations requiredForSatisfied="ifAttempted" measureSatisfactionIfActive="false"/>
          </imsss:sequencing>
        </item>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" adlcp:scormType="sco" href="lesson1.html"/>
  </resources>
</manifest>`;

/**
 * Тот же пакет, но вторичная цель урока читает цель, в которую никто не пишет. Карта без атрибутов
 * читает по умолчанию — специально включать чтение не нужно.
 */
const GOLF_WITH_DANGLING_MAP = GOLF_2004.replace(
  '<imsss:objective objectiveID="obj_extra"/>',
  '<imsss:objective objectiveID="obj_extra"><imsss:mapInfo targetObjectiveID="never_written"/></imsss:objective>',
);

test('редакция и признаки sequencing попадают в details', () => {
  const parsed = parseManifest(GOLF_2004);
  const details = detailsOf(parsed);

  assert.equal(details.edition, '4th');
  assert.equal(details.sequencingUsage.used, true);
  assert.deepEqual(details.globalObjectives, ['course_passed']);
  assert.deepEqual(details.sharedDataTargets, ['shared_state']);
});

test('перечень признаков объясняет, чем именно курс пользуется', () => {
  const indicators = detailsOf(parseManifest(GOLF_2004)).sequencingUsage.indicators;

  // Не флаг, а список: иначе `used: true` нечем перепроверить, а `false` нечем объяснить.
  assert.ok(indicators.includes('controlMode.flow'));
  assert.ok(indicators.includes('sequencingRules.pre'));
  assert.ok(indicators.includes('sequencingRules.post'));
  assert.ok(indicators.includes('rollupRules'));
  assert.ok(indicators.includes('objectives.mapInfo'));
  assert.ok(indicators.includes('limitConditions'));
  assert.ok(indicators.includes('randomizationControls'));
  assert.ok(indicators.includes('constrainedChoiceConsiderations'));
});

test('правила перехода разбираются вместе с условиями', () => {
  const lesson = find(parseManifest(GOLF_2004), 'lesson1');
  const rules = lesson.sequencing?.sequencingRules ?? [];

  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    timing: 'pre',
    conditionCombination: 'any',
    conditions: [{ condition: 'satisfied', operator: 'not', referencedObjective: 'obj_intro', measureThreshold: null }],
    action: 'skip',
  });
  assert.equal(rules[1]?.timing, 'post');
  assert.equal(rules[1]?.action, 'retry');
  // Умолчание `conditionCombination` — «все сразу», и оно проставляется, а не оставляется пустым.
  assert.equal(rules[1]?.conditionCombination, 'all');
  assert.equal(rules[1]?.conditions[0]?.measureThreshold, 0.5);
});

test('rollup разбирается вместе с атрибутами контейнера', () => {
  const chapter = find(parseManifest(GOLF_2004), 'chapter');
  const rollup = chapter.sequencing?.rollupRules;

  assert.equal(rollup?.rollupObjectiveSatisfied, true);
  assert.equal(rollup?.rollupProgressCompletion, false);
  assert.equal(rollup?.objectiveMeasureWeight, 0.5);
  assert.equal(rollup?.rules.length, 1);
  assert.equal(rollup?.rules[0]?.childActivitySet, 'atLeastCount');
  assert.equal(rollup?.rules[0]?.minimumCount, 2);
  assert.equal(rollup?.rules[0]?.action, 'notSatisfied');
  assert.deepEqual(rollup?.rules[0]?.conditions, [
    { condition: 'completed', operator: 'noOp' },
    { condition: 'satisfied', operator: 'not' },
  ]);
});

test('цели, лимиты и остальные блоки читаются целиком', () => {
  const sequencing = find(parseManifest(GOLF_2004), 'lesson1').sequencing;

  assert.equal(sequencing?.objectives?.primary?.id, 'obj_lesson1');
  assert.equal(sequencing?.objectives?.primary?.satisfiedByMeasure, true);
  assert.equal(sequencing?.objectives?.primary?.minNormalizedMeasure, 0.75);
  assert.deepEqual(
    sequencing?.objectives?.secondary.map(objective => objective.id),
    ['obj_extra'],
  );

  assert.equal(sequencing?.limitConditions?.attemptLimit, 3);
  // ISO 8601 приводится к секундам здесь же, а не оставляется строкой потребителю.
  assert.equal(sequencing?.limitConditions?.attemptAbsoluteDurationSeconds, 5400);

  assert.equal(sequencing?.randomizationControls?.selectCount, 3);
  assert.equal(sequencing?.randomizationControls?.reorderChildren, true);
  assert.equal(sequencing?.deliveryControls?.completionSetByContent, true);
  assert.deepEqual(sequencing?.auxiliaryResources, [{ resourceId: 'glossary', purpose: 'glossary' }]);
  assert.equal(sequencing?.rollupConsiderations?.requiredForSatisfied, 'ifAttempted');
  // Умолчание там, где 4-я редакция его задаёт, а автор не написал.
  assert.equal(sequencing?.rollupConsiderations?.requiredForCompleted, 'always');
});

test('проходной балл 2004 берётся из первичной цели', () => {
  // Он же `imsss:minNormalizedMeasure` — доля, а не проценты SCORM 1.2.
  assert.equal(find(parseManifest(GOLF_2004), 'lesson1').masteryScore, 0.75);
});

test('adlnav и adlcp:data разбираются на пункте', () => {
  const lesson = find(parseManifest(GOLF_2004), 'lesson1');

  assert.deepEqual(lesson.hiddenControls, ['continue', 'previous']);
  assert.deepEqual(lesson.sharedData, [{ targetId: 'shared_state', readable: true, writable: false }]);
  assert.deepEqual(lesson.completionThreshold, { minProgressMeasure: 0.8, progressWeight: 0.5, completedByMeasure: true });
});

test('completionThreshold 2-й редакции — число в тексте, а не атрибуты', () => {
  const lesson = find(parseManifest(withItem('<adlcp:completionThreshold>0.6</adlcp:completionThreshold>')), 'lesson');

  // Текстовая форма означала ровно «завершать по измерению», поэтому флаг выводится, а не додумывается.
  assert.deepEqual(lesson.completionThreshold, { minProgressMeasure: 0.6, progressWeight: null, completedByMeasure: true });
});

test('умолчания controlMode проставляются, а отсутствие элемента остаётся отличимым', () => {
  const declared = find(parseManifest(withItem('<imsss:sequencing><imsss:controlMode flow="true"/></imsss:sequencing>')), 'lesson');
  assert.deepEqual(declared.sequencing?.controlMode, {
    choice: true,
    choiceExit: true,
    flow: true,
    forwardOnly: false,
    useCurrentAttemptObjectiveInfo: true,
    useCurrentAttemptProgressInfo: true,
  });

  const bare = find(parseManifest(withItem('<imsss:sequencing/>')), 'lesson');
  assert.equal(bare.sequencing?.controlMode, null);
});

test('пустой sequencing не считается использованием', () => {
  // Сборщики ставят его на каждый пункт «на всякий случай»: засчитывать это значило бы отвечать
  // `true` всегда, и детектор стал бы бесполезен.
  const details = detailsOf(parseManifest(withItem('<imsss:sequencing><imsss:controlMode/></imsss:sequencing>')));

  assert.equal(details.sequencingUsage.used, false);
  assert.deepEqual(details.sequencingUsage.indicators, []);
});

test('2004 без sequencing разбирается так же, как 1.2', () => {
  const parsed = parseManifest(withItem(''));

  assert.equal(parsed.entryPoint, 'lesson.html');
  assert.equal(find(parsed, 'lesson').sequencing, null);
  assert.equal(detailsOf(parsed).sequencingUsage.used, false);
});

test('ссылка на общий блок разрешается, а объявленное по месту перекрывает общее', () => {
  const shared = `<imsss:sequencingCollection>
    <imsss:sequencing ID="common">
      <imsss:controlMode flow="true" forwardOnly="true"/>
      <imsss:limitConditions attemptLimit="2"/>
    </imsss:sequencing>
  </imsss:sequencingCollection>`;
  const parsed = parseManifest(
    withItem('<imsss:sequencing IDRef="common"><imsss:limitConditions attemptLimit="5"/></imsss:sequencing>', shared),
  );
  const sequencing = find(parsed, 'lesson').sequencing;

  assert.equal(sequencing?.controlMode?.flow, true);
  assert.equal(sequencing?.controlMode?.forwardOnly, true);
  // Перекрытие поэлементное: свой `limitConditions` вытесняет общий целиком, а не смешивается с ним.
  assert.equal(sequencing?.limitConditions?.attemptLimit, 5);
});

test('разрешённая ссылка неотличима от объявления по месту', () => {
  const declared = `<imsss:sequencing><imsss:controlMode flow="true"/><imsss:limitConditions attemptLimit="2"/></imsss:sequencing>`;
  const referenced = `<imsss:sequencingCollection>
    <imsss:sequencing ID="common"><imsss:controlMode flow="true"/><imsss:limitConditions attemptLimit="2"/></imsss:sequencing>
  </imsss:sequencingCollection>`;

  const byValue = find(parseManifest(withItem(declared)), 'lesson').sequencing;
  const byReference = find(parseManifest(withItem('<imsss:sequencing IDRef="common"/>', referenced)), 'lesson').sequencing;

  assert.deepEqual({ ...byReference, id: null }, { ...byValue, id: null });
});

test('ссылка в никуда — предупреждение, а не потеря разбора', () => {
  const issues: ValidationIssue[] = [];
  const parsed = parseManifest(
    withItem('<imsss:sequencing IDRef="missing"><imsss:controlMode flow="true"/></imsss:sequencing>'),
    'imsmanifest.xml',
    issues,
  );

  assert.equal(codes(issues).filter(code => code === 'scorm.sequencing-ref-dangling').length, 1);
  // То, что объявлено по месту, при этом сохраняется: иначе одна опечатка стирала бы весь блок.
  assert.equal(find(parsed, 'lesson').sequencing?.controlMode?.flow, true);
});

test('значение вне словаря отбрасывается с находкой, а не подменяется умолчанием', () => {
  const issues: ValidationIssue[] = [];
  const rules = `<imsss:sequencing><imsss:sequencingRules>
    <imsss:preConditionRule>
      <imsss:ruleConditions><imsss:ruleCondition condition="satisfied"/><imsss:ruleCondition condition="усвоено"/></imsss:ruleConditions>
      <imsss:ruleAction action="skip"/>
    </imsss:preConditionRule>
    <imsss:postConditionRule>
      <imsss:ruleConditions><imsss:ruleCondition condition="always"/></imsss:ruleConditions>
      <imsss:ruleAction action="перейти"/>
    </imsss:postConditionRule>
  </imsss:sequencingRules></imsss:sequencing>`;
  const parsed = parseManifest(withItem(rules), 'imsmanifest.xml', issues);
  const sequencing = find(parsed, 'lesson').sequencing;

  assert.equal(codes(issues).filter(code => code === 'scorm.sequencing-value-unknown').length, 2);
  // Условие выпало, правило осталось; правило без действия не делает ничего и не остаётся вовсе.
  assert.equal(sequencing?.sequencingRules.length, 1);
  assert.deepEqual(
    sequencing?.sequencingRules[0]?.conditions.map(one => one.condition),
    ['satisfied'],
  );
});

test('choiceExit при выключенном choice — предупреждение', () => {
  const issues: ValidationIssue[] = [];
  parseManifest(
    withItem('<imsss:sequencing><imsss:controlMode choice="false" choiceExit="true"/></imsss:sequencing>'),
    'imsmanifest.xml',
    issues,
  );

  assert.ok(codes(issues).includes('scorm.choice-exit-without-choice'));
});

test('choiceExit по умолчанию ни о чём не говорит', () => {
  // Он включён спецификацией, поэтому `choice="false"` сам по себе не противоречие — иначе находка
  // сыпалась бы на каждом курсе с запрещённым выбором, то есть на каждом линейном курсе.
  const issues: ValidationIssue[] = [];
  parseManifest(
    withItem('<imsss:sequencing><imsss:controlMode choice="false" flow="true"/></imsss:sequencing>'),
    'imsmanifest.xml',
    issues,
  );

  assert.equal(codes(issues).includes('scorm.choice-exit-without-choice'), false);
});

test('правила rollup на листе разбираются и находкой не считаются', () => {
  // Раньше здесь была находка `scorm.rollup-without-children`. Убрана: правила rollup на листе
  // просто инертны, спецификация их не запрещает, и в корпусе ADL CTS они встречаются в конформных
  // пакетах (CO-11, OB-15). Предупреждение на каноническом контенте — это шум.
  const rollup = `<imsss:sequencing><imsss:rollupRules>
    <imsss:rollupRule><imsss:rollupConditions><imsss:rollupCondition condition="completed"/></imsss:rollupConditions>
    <imsss:rollupAction action="completed"/></imsss:rollupRule>
  </imsss:rollupRules></imsss:sequencing>`;
  const parsed = parseManifest(withItem(rollup));

  const leaf = parsed.activities[0];
  assert.equal(leaf?.children.length, 0);
  assert.equal(leaf?.sequencing?.rollupRules?.rules.length, 1);
});

test('глобальная цель только на чтение разбирается и находкой не считается', () => {
  // Раньше здесь была находка `scorm.objective-map-dangling`. Убрана: глобальные цели по назначению
  // общие **между курсами** — статус живёт в области учащегося, и писать в цель может другой курс
  // программы обучения или сам SCO во время прохождения. Прежнее правило считало областью пакет и
  // потому ругалось на конформные пакеты CTS (CM-13, OB-02b, OB-03b, OB-03c).
  const parsed = parseManifest(GOLF_WITH_DANGLING_MAP);

  const maps = [...walkActivities(parsed.activities)].flatMap(
    activity => activity.sequencing?.objectives?.secondary.flatMap(objective => objective.maps) ?? [],
  );
  const dangling = maps.find(map => map.targetId === 'never_written');

  assert.ok(dangling, 'карта прочитана');
  // Атрибутов у карты нет: по умолчанию читает и не пишет.
  assert.equal(dangling.readSatisfiedStatus, true);
  assert.equal(dangling.writeSatisfiedStatus, false);
});

/** Пункт с произвольным содержимым внутри манифеста 2004 — короче, чем повторять весь пакет. */
function withItem(inner: string, collection = ''): string {
  return `<manifest identifier="probe"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schemaversion>2004 3rd Edition</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Проба</title>
      <item identifier="lesson" identifierref="r1"><title>Урок</title>${inner}</item>
    </organization>
  </organizations>
  <resources><resource identifier="r1" href="lesson.html"/></resources>
  ${collection}
</manifest>`;
}

function detailsOf(metadata: PackageMetadata): Scorm2004Details {
  // Сужение по `format` — то, ради чего результат перестал быть плоским: приведения типов здесь нет.
  if (metadata.format !== 'scorm2004') throw new Error(`ожидался SCORM 2004, а не ${metadata.format}`);
  return metadata.details;
}

function find(metadata: PackageMetadata, identifier: string): Activity {
  const found = [...walkActivities(metadata.activities)].find(activity => activity.identifier === identifier);
  assert.ok(found, `в дереве нет пункта "${identifier}"`);
  return found;
}

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map(issue => issue.code);
}
