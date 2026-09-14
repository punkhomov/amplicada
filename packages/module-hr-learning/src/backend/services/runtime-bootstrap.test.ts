import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLaunchCmi, injectRuntime, renderRuntimeSnippet } from './runtime-bootstrap.js';

const base = { userId: 'u-1', userLogin: 'ivanov', totalTimeSeconds: 0 };

test('первый заход в SCORM 1.2 — ab-initio, с личными данными учащегося', () => {
  const { cmi } = buildLaunchCmi({ ...base, kind: 'scorm12', stored: {} }) as { cmi: Record<string, Record<string, unknown>> };
  assert.equal(cmi.core.entry, 'ab-initio');
  assert.equal(cmi.core.student_id, 'u-1');
  assert.equal(cmi.core.student_name, 'ivanov');
  assert.equal(cmi.core.total_time, '00:00:00');
});

test('resume даётся только после exit=suspend, а не при любом сохранённом состоянии', () => {
  const suspended = buildLaunchCmi({
    ...base,
    kind: 'scorm12',
    stored: { core: { exit: 'suspend', lesson_status: 'incomplete' } },
  }) as { cmi: Record<string, Record<string, unknown>> };
  assert.equal(suspended.cmi.core.entry, 'resume');

  // Курс, который просто закрыли, suspend_data не писал — предлагать ему восстановление нельзя.
  const closed = buildLaunchCmi({
    ...base,
    kind: 'scorm12',
    stored: { core: { exit: '', lesson_status: 'incomplete' } },
  }) as { cmi: Record<string, Record<string, unknown>> };
  assert.equal(closed.cmi.core.entry, '');
});

test('накопленное время отдаётся рантайму, а время прошлой сессии обнуляется', () => {
  const { cmi } = buildLaunchCmi({
    ...base,
    kind: 'scorm12',
    totalTimeSeconds: 3661,
    stored: { core: { session_time: '00:10:00', total_time: '99:99:99' } },
  }) as { cmi: Record<string, Record<string, unknown>> };

  assert.equal(cmi.core.total_time, '01:01:01', 'итог берётся из колонки, а не из сохранённого cmi');
  assert.equal(cmi.core.session_time, undefined, 'иначе рантайм прибавит прошлую сессию повторно');
});

test('в SCORM 2004 те же поля лежат на другом уровне', () => {
  const { cmi } = buildLaunchCmi({
    ...base,
    kind: 'scorm2004',
    totalTimeSeconds: 750,
    stored: { exit: 'suspend', suspend_data: 'slide=7', session_time: 'PT5M' },
  }) as { cmi: Record<string, unknown> };

  assert.equal(cmi.learner_id, 'u-1');
  assert.equal(cmi.entry, 'resume');
  assert.equal(cmi.total_time, 'PT0H12M30S');
  assert.equal(cmi.session_time, undefined);
  assert.equal(cmi.suspend_data, 'slide=7', 'состояние курса переносится как есть');
});

test('конфигурация вшивается так, что её нельзя закрыть тегом из данных', () => {
  const snippet = renderRuntimeSnippet({
    kind: 'scorm12',
    commitUrl: '/api/learning/runtime/commit',
    libraryUrl: '/api/learning/runtime/scorm-again.js',
    attemptId: 'a-1',
    sessionId: 's-1',
    cmi: { cmi: { core: { lesson_location: '</script><script>alert(1)</script>' } } },
    autocommitSeconds: 30,
  });

  assert.ok(!snippet.includes('</script><script>alert(1)'), 'иначе курс со злым состоянием исполняет свой код');
  assert.ok(snippet.includes('\\u003c/script'));
  assert.equal(snippet.match(/<script/g)?.length, 3, 'библиотека, конфигурация, запуск — и ничего больше');
});

test('вставка целиком в ASCII — она попадает в чужой документ с чужой кодировкой', () => {
  const snippet = renderRuntimeSnippet({
    kind: 'scorm2004',
    commitUrl: '/api/learning/runtime/commit',
    libraryUrl: '/api/learning/runtime/scorm-again.js',
    attemptId: 'a-1',
    sessionId: 's-1',
    cmi: { cmi: { learner_name: 'Иванов Иван', suspend_data: 'слайд=7' } },
    autocommitSeconds: 30,
  });

  // Курс в windows-1251 прочитал бы байты UTF-8 как кракозябры — и фамилия учащегося внутри курса
  // превратилась бы в мусор.
  assert.ok(/^[\x20-\x7e\n]*$/.test(snippet), 'в снипете не должно остаться ни одного не-ASCII символа');
  assert.ok(snippet.includes('\\u0418\\u0432\\u0430\\u043d\\u043e\\u0432'), 'кириллица уходит в \\uXXXX');
});

test('рантайм встаёт в начало head — до скриптов курса, а не после них', () => {
  const html = '<html><head><script src="scormdriver.js"></script><title>Курс</title></head><body><p>Привет</p></body></html>';
  const result = injectRuntime(html, '<script>ok</script>');

  // Драйвер курса ищет window.API прямо при загрузке и второй попытки не делает: вставка в конец
  // head означала бы, что он искал раньше, чем мы положили.
  assert.ok(result.indexOf('<script>ok</script>') < result.indexOf('scormdriver.js'));
  assert.ok(result.includes('<title>Курс</title>'));
  assert.ok(result.includes('<p>Привет</p>'));
});

test('вставка идёт до <base href> — он действует только на то, что после него', () => {
  const result = injectRuntime('<head><base href="https://example.com/"><script src="a.js"></script></head>', '<!--R-->');
  assert.ok(result.indexOf('<!--R-->') < result.indexOf('<base'));
});

test('атрибуты на <head> вставку не ломают', () => {
  const result = injectRuntime('<head profile="http://example.com/p"><title>t</title></head>', '<!--R-->');
  assert.ok(result.indexOf('<!--R-->') < result.indexOf('<title>'));
  assert.ok(result.includes('profile="http://example.com/p"'));
});

test('без head рантайм идёт в начало body, а без body — в начало документа', () => {
  const noHead = injectRuntime('<html><body class="x"><p>Привет</p></body></html>', '<!--R-->');
  assert.ok(noHead.indexOf('<!--R-->') > noHead.indexOf('<body class="x">'));
  assert.ok(noHead.indexOf('<!--R-->') < noHead.indexOf('<p>Привет</p>'));

  const bare = injectRuntime('<p>Привет</p>', '<!--R-->');
  assert.ok(bare.startsWith('<!--R-->'));
});

test('тег head узнаётся в любом регистре', () => {
  for (const opening of ['<head>', '<HEAD>', '<Head lang="ru">']) {
    const result = injectRuntime(`<html>${opening}<title>t</title></head><body>`, '<!--R-->');
    assert.ok(result.indexOf('<!--R-->') > result.indexOf(opening), opening);
    assert.ok(result.indexOf('<!--R-->') < result.indexOf('<title>'), opening);
  }
});
