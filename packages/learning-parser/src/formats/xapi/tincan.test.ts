import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../../issue.js';
import { launchableActivities } from '../../model/activity.js';
import { parseTincan } from './tincan.js';

/** Форма, которую выдаёт Articulate Storyline при публикации в xAPI. */
const TINCAN = `<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="http://example.com/courses/onboarding" type="http://adlnet.gov/expapi/activities/course">
      <name lang="ru">Адаптация новичка</name>
      <description lang="ru">Что нужно знать в первую неделю</description>
      <launch lang="ru">story.html</launch>
    </activity>
    <activity id="http://example.com/courses/onboarding/quiz" type="http://adlnet.gov/expapi/activities/assessment">
      <name lang="ru">Проверка</name>
    </activity>
  </activities>
</tincan>`;

test('tincan.xml разбирается: запускаемая активность, название, описание', () => {
  const metadata = parseTincan(TINCAN);
  assert.equal(metadata.format, 'xapi');
  assert.equal(metadata.identifier, 'http://example.com/courses/onboarding');
  assert.equal(metadata.title, 'Адаптация новичка');
  assert.equal(metadata.description, 'Что нужно знать в первую неделю');
  assert.equal(metadata.entryPoint, 'story.html');
});

test('запускаемой считается активность с <launch>, а не первая в списке', () => {
  const xml = `<tincan><activities>
    <activity id="meta" type="http://adlnet.gov/expapi/activities/course"><name>Описательная</name></activity>
    <activity id="real"><name>Запускаемая</name><launch>index.html</launch></activity>
  </activities></tincan>`;
  const metadata = parseTincan(xml);
  assert.equal(metadata.identifier, 'real');
  assert.equal(launchableActivities(metadata.activities).length, 1, 'активность без launch запускаемой не считается');
  assert.equal(metadata.activities.length, 2, 'но в оглавлении она остаётся — её описал автор');
});

test('многоязычные подписи хранятся целиком, наверх идёт первая', () => {
  // `<name>` и `<description>` в tincan.xml повторяются по одному на язык. Брать первый и
  // выбрасывать остальные значило бы поступить с переводами не так, как мы поступили в LOM.
  const xml = `<tincan><activities><activity id="a">
    <name lang="en">Onboarding</name>
    <name lang="ru">Адаптация</name>
    <description lang="en">First week</description>
    <description lang="ru">Первая неделя</description>
    <launch>index.html</launch>
  </activity></activities></tincan>`;
  const metadata = parseTincan(xml);

  assert.equal(metadata.title, 'Onboarding');
  assert.equal(metadata.description, 'First week');
  assert.deepEqual(metadata.activities[0].titles, { en: 'Onboarding', ru: 'Адаптация' });
  assert.deepEqual(metadata.activities[0].descriptions, { en: 'First week', ru: 'Первая неделя' });
});

test('подпись без языка кладётся под пустой ключ, а не теряется', () => {
  const xml = '<tincan><activities><activity id="a"><name>Курс</name><launch>i.html</launch></activity></activities></tincan>';
  assert.deepEqual(parseTincan(xml).activities[0].titles, { '': 'Курс' });
});

test('описание берётся с запускаемой активности, а не с первой в списке', () => {
  const xml = `<tincan><activities>
    <activity id="meta"><name>Описательная</name><description lang="ru">Не та</description></activity>
    <activity id="real"><name>Запускаемая</name><description lang="ru">Та самая</description><launch>i.html</launch></activity>
  </activities></tincan>`;
  assert.equal(parseTincan(xml).description, 'Та самая');
});

test('внешний launch отдаётся как URL', () => {
  const xml = `<tincan><activities><activity id="a">
    <launch>https://vendor.example/player/index.html</launch>
  </activity></activities></tincan>`;
  const metadata = parseTincan(xml);
  assert.equal(metadata.entryPoint, null);
  assert.equal(metadata.entryUrl, 'https://vendor.example/player/index.html');
});

test('проходного балла в xAPI-пакете нет по устройству формата', () => {
  assert.equal(parseTincan(TINCAN).masteryScore, null);
});

test('пакет без запускаемой активности разбирается, но помечается', () => {
  const described: ValidationIssue[] = [];
  const metadata = parseTincan('<tincan><activities><activity id="a"/></activities></tincan>', 'tincan.xml', described);
  assert.equal(metadata.entryPoint, null);
  assert.equal(metadata.activities.length, 1, 'активность без launch остаётся в оглавлении — её описал автор');
  assert.deepEqual(described, [], 'сама по себе активность без launch не изъян: их описывают под statement’ы');

  const empty: ValidationIssue[] = [];
  parseTincan('<tincan/>', 'tincan.xml', empty);
  assert.deepEqual(
    empty.map(issue => issue.code),
    ['xapi.activities-missing'],
  );
});

test('тип активности и расширения читаются', () => {
  const xml = `<tincan><activities>
    <activity id="http://example.com/course" type="http://adlnet.gov/expapi/activities/course">
      <name>Курс</name>
      <launch>story.html</launch>
      <extensions>
        <extension key="http://example.com/ext/vendor">Наш центр</extension>
        <extension key="http://example.com/ext/build">42</extension>
      </extensions>
    </activity>
  </activities></tincan>`;
  const activity = parseTincan(xml).activities[0];

  assert.equal(activity.activityType, 'http://adlnet.gov/expapi/activities/course');
  assert.deepEqual(activity.extensions, {
    'http://example.com/ext/vendor': 'Наш центр',
    'http://example.com/ext/build': '42',
  });
});

test('активность без расширений даёт пустой набор', () => {
  const activity = parseTincan('<tincan><activities><activity id="a"><launch>a.html</launch></activity></activities></tincan>')
    .activities[0];
  assert.deepEqual(activity.extensions, {});
  assert.equal(activity.activityType, null);
});
