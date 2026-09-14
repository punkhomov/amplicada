import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../../issue.js';
import { type Activity, walkActivities } from '../../model/activity.js';
import { checkPrerequisites } from '../../validation/prerequisite-rules.js';
import { parseManifest } from './manifest.js';

/** Манифест SCORM 1.2 из трёх пунктов; условия подставляются в `<item>` по месту. */
function manifest(items: string): string {
  return `<?xml version="1.0"?>
<manifest identifier="course" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Курс</title>
      ${items}
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" adlcp:scormtype="sco" href="one.html"/>
    <resource identifier="r2" adlcp:scormtype="sco" href="two.html"/>
    <resource identifier="r3" adlcp:scormtype="sco" href="three.html"/>
  </resources>
</manifest>`;
}

const CHAPTERS = manifest(`
      <item identifier="intro" identifierref="r1"><title>Введение</title></item>
      <item identifier="practice" identifierref="r2">
        <title>Практика</title>
        <adlcp:prerequisites type="aicc_script">intro</adlcp:prerequisites>
      </item>
      <item identifier="exam" identifierref="r3">
        <title>Экзамен</title>
        <adlcp:prerequisites type="aicc_script">intro&amp;practice</adlcp:prerequisites>
      </item>`);

function byId(activities: readonly Activity[]): Map<string, Activity> {
  return new Map([...walkActivities(activities)].map(activity => [activity.identifier, activity]));
}

test('условия открытия читаются с пунктов оглавления', () => {
  const issues: ValidationIssue[] = [];
  const activities = byId(parseManifest(CHAPTERS, 'imsmanifest.xml', issues).activities);

  assert.equal(activities.get('intro')?.prerequisites, null);
  assert.deepEqual(activities.get('practice')?.prerequisites, { kind: 'item', identifier: 'intro' });
  assert.deepEqual(activities.get('exam')?.prerequisites, {
    kind: 'and',
    operands: [
      { kind: 'item', identifier: 'intro' },
      { kind: 'item', identifier: 'practice' },
    ],
  });
  assert.deepEqual(
    issues.filter(issue => issue.code.includes('prerequisite')),
    [],
  );
});

test('исправный курс не даёт находок по условиям', () => {
  const metadata = parseManifest(CHAPTERS, 'imsmanifest.xml');
  assert.deepEqual(checkPrerequisites(metadata.activities, 'imsmanifest.xml'), []);
});

test('ссылка на несуществующий пункт — находка', () => {
  const xml = manifest(`
      <item identifier="intro" identifierref="r1"><title>Введение</title></item>
      <item identifier="exam" identifierref="r2">
        <title>Экзамен</title>
        <adlcp:prerequisites type="aicc_script">intro&amp;pretest</adlcp:prerequisites>
      </item>`);
  const issues = checkPrerequisites(parseManifest(xml, 'imsmanifest.xml').activities, 'imsmanifest.xml');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'common.prerequisite-unknown-item');
  assert.match(issues[0].message, /pretest/);
  assert.equal(issues[0].location, 'imsmanifest.xml#exam');
});

test('кольцо ссылок ловится и сообщается один раз', () => {
  const xml = manifest(`
      <item identifier="a" identifierref="r1">
        <title>A</title>
        <adlcp:prerequisites type="aicc_script">c</adlcp:prerequisites>
      </item>
      <item identifier="b" identifierref="r2">
        <title>B</title>
        <adlcp:prerequisites type="aicc_script">a</adlcp:prerequisites>
      </item>
      <item identifier="c" identifierref="r3">
        <title>C</title>
        <adlcp:prerequisites type="aicc_script">b</adlcp:prerequisites>
      </item>`);
  const issues = checkPrerequisites(parseManifest(xml, 'imsmanifest.xml').activities, 'imsmanifest.xml');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'common.prerequisite-cycle');
  assert.match(issues[0].message, /a → c → b → a/);
});

test('пункт, требующий сам себя, — тоже кольцо', () => {
  const xml = manifest(`
      <item identifier="a" identifierref="r1">
        <title>A</title>
        <adlcp:prerequisites type="aicc_script">a</adlcp:prerequisites>
      </item>`);
  const issues = checkPrerequisites(parseManifest(xml, 'imsmanifest.xml').activities, 'imsmanifest.xml');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'common.prerequisite-cycle');
});

test('ромб не считается кольцом', () => {
  // d ← b ← a и d ← c ← a: общий предок виден дважды, но пути не замыкаются.
  const xml = manifest(`
      <item identifier="a" identifierref="r1"><title>A</title></item>
      <item identifier="b" identifierref="r2">
        <title>B</title>
        <adlcp:prerequisites type="aicc_script">a</adlcp:prerequisites>
      </item>
      <item identifier="c" identifierref="r3">
        <title>C</title>
        <adlcp:prerequisites type="aicc_script">a</adlcp:prerequisites>
      </item>
      <item identifier="d">
        <title>D</title>
        <adlcp:prerequisites type="aicc_script">b&amp;c</adlcp:prerequisites>
      </item>`);
  assert.deepEqual(checkPrerequisites(parseManifest(xml, 'imsmanifest.xml').activities, 'imsmanifest.xml'), []);
});

test('чужой язык условия не разбирается по правилам AICC-скрипта', () => {
  const xml = manifest(`
      <item identifier="exam" identifierref="r1">
        <title>Экзамен</title>
        <adlcp:prerequisites type="custom_script">intro</adlcp:prerequisites>
      </item>`);
  const issues: ValidationIssue[] = [];
  const activities = byId(parseManifest(xml, 'imsmanifest.xml', issues).activities);

  assert.equal(activities.get('exam')?.prerequisites, null);
  assert.equal(issues.filter(issue => issue.code === 'scorm.prerequisites-type-unknown').length, 1);
});

test('условие без атрибута type читается как AICC-скрипт', () => {
  const xml = manifest(`
      <item identifier="intro" identifierref="r1"><title>Введение</title></item>
      <item identifier="exam" identifierref="r2">
        <title>Экзамен</title>
        <adlcp:prerequisites>intro</adlcp:prerequisites>
      </item>`);
  const activities = byId(parseManifest(xml, 'imsmanifest.xml').activities);
  assert.deepEqual(activities.get('exam')?.prerequisites, { kind: 'item', identifier: 'intro' });
});

test('неразобранное условие становится находкой на месте пункта', () => {
  const xml = manifest(`
      <item identifier="exam" identifierref="r1">
        <title>Экзамен</title>
        <adlcp:prerequisites type="aicc_script">intro &amp;&amp;</adlcp:prerequisites>
      </item>`);
  const issues: ValidationIssue[] = [];
  parseManifest(xml, 'imsmanifest.xml', issues);

  const found = issues.filter(issue => issue.code === 'common.prerequisite-unparsable');
  assert.equal(found.length, 1);
  assert.equal(found[0].location, 'imsmanifest.xml#exam');
});
