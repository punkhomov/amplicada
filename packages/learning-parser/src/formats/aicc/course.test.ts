import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ValidationIssue } from '../../issue.js';
import { type Activity, launchableActivities, walkActivities } from '../../model/activity.js';
import type { AiccDetails } from '../../model/details.js';
import type { PackageMetadata } from '../../model/metadata.js';
import { type AiccFiles, isAiccCourseFile, parseAicc } from './course.js';

function detailsOf(metadata: PackageMetadata): AiccDetails {
  if (metadata.format !== 'aicc') throw new Error(`ожидался AICC, а не ${metadata.format}`);
  return metadata.details;
}

const CRS = `[Course]
Course_Creator=Учебный центр
Course_ID=SEC-101
Course_Title=Охрана труда
Course_System=AICC
Level=1
Version=2.0

[Course_Behavior]
Max_Normal=1

[Course_Description]
Вводный курс по охране труда
для новых сотрудников
`;

const AU = `"System_ID","Command_Line","File_Name","Max_Time_Allowed","Time_Limit_Action","Max_Score","Mastery_Score","Web_Launch"
"A1","","content/start.html","01:00:00","E,C","100","80","mode=normal"
"A2","","content/test.html","00:30:00","E,C","100","70",""
`;

const DES = `"System_ID","Developer_ID","Title","Description"
"A1","DEV1","Первый блок","Знакомство"
"A2","DEV1","Проверка знаний","Итоговый тест"
`;

function files(overrides: Partial<AiccFiles> = {}): AiccFiles {
  return { course: CRS, assignableUnits: AU, descriptors: DES, structure: null, prerequisites: null, objectives: null, ...overrides };
}

function byId(activities: readonly Activity[]): Map<string, Activity> {
  return new Map([...walkActivities(activities)].map(activity => [activity.identifier, activity]));
}

test('AICC-пакет разбирается: заголовок из .crs, запуск из .au', () => {
  const metadata = parseAicc(files(), 'course.crs');
  assert.equal(metadata.format, 'aicc');
  assert.equal(metadata.identifier, 'SEC-101');
  assert.equal(metadata.title, 'Охрана труда');
  assert.equal(metadata.schemaVersion, '2.0');
  assert.equal(metadata.entryPoint, 'content/start.html');
  assert.equal(launchableActivities(metadata.activities).length, 2);
});

test('без .cst дерево плоское — единицы в порядке объявления', () => {
  const activities = parseAicc(files(), 'course.crs').activities;
  assert.deepEqual(
    activities.map(activity => activity.identifier),
    ['A1', 'A2'],
  );
  assert.equal(
    activities.every(activity => activity.children.length === 0),
    true,
  );
});

test('.cst собирает единицы в блоки', () => {
  const cst = '"Block","Member"\n"ROOT","Модуль 1"\n"Модуль 1","A1"\n"Модуль 1","A2"\n';
  const activities = parseAicc(files({ structure: cst }), 'course.crs').activities;

  assert.equal(activities.length, 1, 'корень один — блок');
  assert.equal(activities[0].launch, null, 'блок сам не запускается');
  assert.deepEqual(
    activities[0].children.map(child => child.identifier),
    ['A1', 'A2'],
  );
});

test('единица вне структуры не теряется', () => {
  // `.cst` в живых пакетах бывает неполным, а незапущенная единица — это непройденный курс.
  const cst = '"Block","Member"\n"ROOT","Модуль 1"\n"Модуль 1","A1"\n';
  const activities = parseAicc(files({ structure: cst }), 'course.crs').activities;
  assert.deepEqual(
    activities.map(activity => activity.identifier),
    ['Модуль 1', 'A2'],
  );
});

test('цикл в .cst не уводит сборку в бесконечную рекурсию', () => {
  const cst = '"Block","Member"\n"ROOT","B1"\n"B1","B2"\n"B2","B1"\n"B1","A1"\n';
  const activities = parseAicc(files({ structure: cst }), 'course.crs').activities;
  assert.equal(activities[0].identifier, 'B1');
  assert.deepEqual(
    activities[0].children.map(child => child.identifier),
    ['B2', 'A1'],
    'повторный B1 внутри B2 отброшен, остальное на месте',
  );
});

test('max_time_allowed и time_limit_action доезжают до пункта', () => {
  // Без них рантайм не заполнит cmi.student_data.* — ограничение времени просто не сработает.
  const first = parseAicc(files(), 'course.crs').activities[0];
  assert.equal(first.maxTimeSeconds, 3600);
  assert.equal(first.timeLimitAction, 'E,C');
});

test('свободный текст секции описания собирается в одну строку', () => {
  assert.equal(parseAicc(files(), 'course.crs').description, 'Вводный курс по охране труда\nдля новых сотрудников');
});

test('mastery score в AICC — проценты, приводится к доле', () => {
  assert.equal(parseAicc(files(), 'course.crs').masteryScore, 0.8);
});

test('web_launch дописывается к параметрам запуска, а не теряется', () => {
  assert.equal(parseAicc(files(), 'course.crs').entryParameters, '?mode=normal');
});

test('регистр ключей и секций в .crs произвольный', () => {
  const crs = '[COURSE]\r\ncourse_title=Название вразнобой\r\nCOURSE_ID=X1\r\n';
  const metadata = parseAicc(files({ course: crs }), 'course.crs');
  assert.equal(metadata.title, 'Название вразнобой');
  assert.equal(metadata.identifier, 'X1');
});

test('CSV с запятыми и кавычками внутри значений читается верно', () => {
  const au = `"System_ID","File_Name","Description"
"A1","content/a, b.html","Строка с ""кавычками"" внутри"
`;
  const metadata = parseAicc(files({ assignableUnits: au, descriptors: null, course: '[Course]\nCourse_ID=X\n' }), 'x.crs');
  assert.equal(metadata.entryPoint, 'content/a, b.html', 'запятая внутри кавычек не разделитель');
});

test('название берётся из .des, когда в .crs его нет', () => {
  const metadata = parseAicc(files({ course: '[Course]\nCourse_ID=X1\n' }), 'course.crs');
  assert.equal(metadata.title, 'Первый блок', 'соответствие ищется по System_ID первой единицы');
});

test('комментарии и пустые строки в .crs игнорируются', () => {
  const crs = '; это комментарий\n\n[Course]\n; и это тоже\nCourse_Title=Курс\n';
  assert.equal(parseAicc(files({ course: crs }), 'c.crs').title, 'Курс');
});

test('внешний адрес запуска отдаётся как URL', () => {
  const au = '"System_ID","File_Name"\n"A1","https://vendor.example/aicc/start"\n';
  const metadata = parseAicc(files({ assignableUnits: au }), 'c.crs');
  assert.equal(metadata.entryPoint, null);
  assert.equal(metadata.entryUrl, 'https://vendor.example/aicc/start');
});

test('пакет без .au и .au без file_name становятся находками, а не исключениями', () => {
  const noUnits: ValidationIssue[] = [];
  parseAicc(files({ assignableUnits: null }), 'c.crs', noUnits);
  assert.deepEqual(
    noUnits.map(issue => issue.code),
    ['aicc.au-missing'],
  );
  assert.equal(noUnits[0].severity, 'error');

  const noLaunch: ValidationIssue[] = [];
  const metadata = parseAicc(files({ assignableUnits: '"System_ID"\n"A1"\n' }), 'c.crs', noLaunch);
  assert.equal(metadata.entryPoint, null);
  assert.equal(noLaunch[0].code, 'aicc.launch-url-missing');
  assert.equal(noLaunch[0].location, 'c.crs#A1', 'место названо — какая именно единица');
});

test('условия открытия читаются из .pre', () => {
  const pre = '"Structure_Element","Prerequisite"\n"A2","A1"\n';
  const activities = byId(parseAicc(files({ prerequisites: pre }), 'course.crs').activities);

  assert.equal(activities.get('A1')?.prerequisites, null);
  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'item', identifier: 'A1' });
});

test('.pre сопоставляется без учёта регистра — .au и .pre пишут разные инструменты', () => {
  const pre = '"Structure_Element","Prerequisite"\n"a2","A1"\n';
  const activities = byId(parseAicc(files({ prerequisites: pre }), 'course.crs').activities);
  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'item', identifier: 'A1' });
});

test('колонка prerequisites в .au тоже читается', () => {
  const au = `"System_ID","File_Name","Prerequisites"
"A1","one.html",""
"A2","two.html","A1"
`;
  const activities = byId(parseAicc(files({ assignableUnits: au }), 'course.crs').activities);
  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'item', identifier: 'A1' });
});

test('.pre важнее колонки в .au: спецификация отводит условия туда', () => {
  const au = '"System_ID","File_Name","Prerequisite"\n"A1","one.html",""\n"A2","two.html","A1"\n';
  const pre = '"Structure_Element","Prerequisite"\n"A2","~A1"\n';
  const activities = byId(parseAicc(files({ assignableUnits: au, prerequisites: pre }), 'course.crs').activities);
  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'not', operand: { kind: 'item', identifier: 'A1' } });
});

test('условие из .cst достаётся и блоку, и участнику', () => {
  const cst = '"Block","Member","Prerequisite"\n"ROOT","Модуль 1",""\n"Модуль 1","A1",""\n"Модуль 1","A2","A1"\n';
  const activities = byId(parseAicc(files({ structure: cst }), 'course.crs').activities);
  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'item', identifier: 'A1' });

  const onBlock = '"Block","Member","Prerequisite"\n"ROOT","Модуль 2","A1"\n"Модуль 2","A2",""\n';
  const blocks = byId(parseAicc(files({ structure: onBlock }), 'course.crs').activities);
  assert.deepEqual(blocks.get('Модуль 2')?.prerequisites, { kind: 'item', identifier: 'A1' });
});

test('.pre рёбрами: зависимый слева, требуемое справа', () => {
  // Направление установлено по трём свидетельствам: колонка `type="requires"`, смысл настоящих
  // курсов корпуса и эвристика образца. До появления корпуса читать это было нельзя — из имён
  // колонок направление не следует, а ошибка в нём запирает главу вместо того, чтобы её открыть.
  const issues: ValidationIssue[] = [];
  const pre = '"Source","Target","Type"\n"A2","A1","requires"\n';
  const activities = byId(parseAicc(files({ prerequisites: pre }), 'course.crs', issues).activities);

  assert.deepEqual(activities.get('A2')?.prerequisites, { kind: 'item', identifier: 'A1' });
  assert.equal(activities.get('A1')?.prerequisites, null);
  assert.deepEqual(issues, []);
});

test('.pre рёбрами: несколько условий на один элемент складываются по И', () => {
  const issues: ValidationIssue[] = [];
  const au = `${AU}"A3","","content/final.html","00:30:00","E,C","100","80",""\n`;
  const pre = '"pre_from","post_to"\n"A2","A1"\n"A3","A1"\n"A3","A2"\n';
  const activities = byId(parseAicc(files({ assignableUnits: au, prerequisites: pre }), 'course.crs', issues).activities);

  assert.deepEqual(activities.get('A3')?.prerequisites, {
    kind: 'and',
    operands: [
      { kind: 'item', identifier: 'A1' },
      { kind: 'item', identifier: 'A2' },
    ],
  });
  assert.deepEqual(issues, []);
});

test('.pre рёбрами: связь не «requires» не читается как «requires»', () => {
  // Что означает «excludes», неизвестно, а прочитать его как «требует» — перевернуть смысл.
  const issues: ValidationIssue[] = [];
  const pre = '"source","target","type"\n"A2","A1","excludes"\n';
  const activities = byId(parseAicc(files({ prerequisites: pre }), 'course.crs', issues).activities);

  assert.equal(activities.get('A2')?.prerequisites, null);
  assert.deepEqual(
    issues.map(issue => issue.code),
    ['aicc.prerequisite-relation-unknown'],
  );
});

test('.pre с колонками ни той, ни другой формы даёт находку', () => {
  const issues: ValidationIssue[] = [];
  const pre = '"left","right"\n"A2","A1"\n';
  const activities = byId(parseAicc(files({ prerequisites: pre }), 'course.crs', issues).activities);

  assert.equal(activities.get('A2')?.prerequisites, null);
  assert.deepEqual(
    issues.map(issue => issue.code),
    ['aicc.prerequisites-unreadable'],
  );
});

test('AICC опознаётся по секции [Course], а не по расширению', () => {
  // `.crs` называют и посторонние файлы — расширения мало.
  assert.equal(isAiccCourseFile(CRS), true);
  assert.equal(isAiccCourseFile('  [course]\nCourse_ID=1'), true, 'регистр и отступ не важны');
  assert.equal(isAiccCourseFile('просто текстовый файл'), false);
  assert.equal(isAiccCourseFile('[Course_Behavior]\nMax_Normal=1'), false, 'похожая секция — не та секция');
});

test('.ort связывает цели с единицами: перечень в details, ссылки на пункте', () => {
  const ort = `"Objective_ID","AU_System_ID","Relation"
"OBJ1","A1","write"
"OBJ1","A2","read"
"OBJ2","A2","write"
`;
  const metadata = parseAicc(files({ objectives: ort }), 'course.crs');
  assert.deepEqual(detailsOf(metadata).objectives, [
    {
      id: 'OBJ1',
      members: [
        { unitId: 'A1', relation: 'write' },
        { unitId: 'A2', relation: 'read' },
      ],
    },
    { id: 'OBJ2', members: [{ unitId: 'A2', relation: 'write' }] },
  ]);

  const activities = byId(metadata.activities);
  assert.deepEqual(activities.get('A1')?.objectiveRefs, ['OBJ1']);
  assert.deepEqual(activities.get('A2')?.objectiveRefs, ['OBJ1', 'OBJ2']);
});

test('цель, связанная с несуществующей единицей, — находка, но из перечня не пропадает', () => {
  const issues: ValidationIssue[] = [];
  const ort = '"Objective_ID","AU_System_ID"\n"OBJ1","A9"\n';
  const metadata = parseAicc(files({ objectives: ort }), 'course.crs', issues);

  assert.equal(detailsOf(metadata).objectives.length, 1, 'объявленную автором цель молча не теряем');
  assert.deepEqual(
    issues.map(issue => issue.code),
    ['aicc.objective-dangling'],
  );
  assert.equal(issues[0].location, 'course.crs#A9');
});

test('секции .crs сверх общего доезжают до details', () => {
  const details = detailsOf(parseAicc(files(), 'course.crs'));
  assert.equal(details.level, '1');
  assert.equal(details.courseSystem, 'AICC');
  assert.equal(details.maxAttempts, 1, 'Max_Normal из [Course_Behavior]');
});

test('пакет без .ort разбирается как раньше', () => {
  const metadata = parseAicc(files(), 'course.crs');
  assert.deepEqual(detailsOf(metadata).objectives, []);
  assert.deepEqual(byId(metadata.activities).get('A1')?.objectiveRefs, []);
});
