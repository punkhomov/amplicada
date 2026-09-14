import type { PackageKind } from '../../contracts/index.js';
import { formatDuration } from './cmi-normalize.js';

/**
 * Рантайм SCORM, который вживляется в точку входа курса.
 *
 * Он живёт **внутри** iframe, вместе с содержимым, а не в родительском приложении. Причина
 * фундаментальная: SCORM API синхронный — `LMSGetValue` обязан вернуть строку немедленно, — а
 * контент раздаётся в песочнице с opaque origin и до родителя не дотягивается. Обойти это через
 * `postMessage` нельзя честно, и `scorm-again` этого не скрывает: его `CrossFrameAPI` отвечает
 * синхронно из локального кеша, а настоящее значение подтягивает потом. Для «покажи фамилию» это
 * сойдёт, для «дай сохранённый suspend_data на старте» — нет.
 *
 * Поэтому: рантайм рядом с курсом, стартовое состояние вшито в страницу (чтение вообще без
 * запросов), запись уходит на наш API.
 */

export interface RuntimeConfig {
  kind: PackageKind;
  /** Куда рантайм шлёт коммиты. */
  commitUrl: string;
  /** Адрес самой библиотеки — она часть платформы, а не пакета, и отдаётся нашим роутом. */
  libraryUrl: string;
  attemptId: string;
  /**
   * Сессия просмотра: коммит принимается, только если совпадает с текущей у попытки.
   *
   * Едет в теле запроса, то есть клиент может её подменить, — и это нормально: lease защищает от
   * двух случайно открытых вкладок, а не от злого умысла. Подделка даёт ровно то, что lease и так
   * разрешает владельцу попытки, — записать свой прогресс.
   */
  sessionId: string;
  /** Стартовое состояние: `{ cmi: { ... } }`, в том же виде, в каком рантайм присылает коммит. */
  cmi: Record<string, unknown>;
  /** Как часто автосохранять, секунды. */
  autocommitSeconds: number;
}

export interface LaunchState {
  kind: PackageKind;
  /** Сохранённое состояние прошлой сессии; `{}` — заход первый. */
  stored: Record<string, unknown>;
  totalTimeSeconds: number;
  userId: string;
  userLogin: string;
}

/**
 * Стартовый `cmi` для рантайма.
 *
 * Три вещи здесь не копируются из сохранённого, а вычисляются заново, и это не придирка:
 *
 * - `entry` — режим захода. Курс по нему решает, показывать ли «продолжить с 7 слайда». Значение
 *   выставляет LMS, а не контент, и хранить его между сессиями бессмысленно.
 * - `session_time` — время текущей сессии. Прошлое обнуляется, иначе рантайм прибавит его повторно.
 * - `total_time` — накопленный итог, который рантайм увеличит на длительность этой сессии. Мы
 *   отдаём его из своей колонки, а не из `cmi`: колонка и есть то, что видит отчётность.
 */
export function buildLaunchCmi(state: LaunchState): Record<string, unknown> {
  const stored = { ...(state.stored ?? {}) };
  const total = formatDuration(state.kind, state.totalTimeSeconds);

  if (state.kind === 'scorm2004') {
    const core = { ...stored } as Record<string, unknown>;
    delete core.session_time;
    return {
      cmi: {
        ...core,
        learner_id: state.userId,
        learner_name: state.userLogin,
        entry: entryMode(String(stored.exit ?? ''), Object.keys(stored).length > 0),
        exit: '',
        credit: 'credit',
        mode: 'normal',
        total_time: total,
      },
    };
  }

  const storedCore = { ...((stored.core as Record<string, unknown> | undefined) ?? {}) };
  delete storedCore.session_time;
  return {
    cmi: {
      ...stored,
      core: {
        ...storedCore,
        student_id: state.userId,
        student_name: state.userLogin,
        entry: entryMode(String(storedCore.exit ?? ''), Object.keys(storedCore).length > 0),
        exit: '',
        credit: 'credit',
        lesson_mode: 'normal',
        total_time: total,
      },
    },
  };
}

/**
 * `ab-initio` — заход первый, `resume` — курс просил себя приостановить, пусто — всё остальное.
 *
 * Спецификация именно так и делит: `resume` даётся только после `exit=suspend`. Ставить его всегда,
 * когда состояние есть, — частая ошибка: курс полезет восстанавливаться из `suspend_data`, которого
 * он не писал, и упадёт на разборе.
 */
function entryMode(storedExit: string, hasState: boolean): string {
  if (storedExit === 'suspend') return 'resume';
  return hasState ? '' : 'ab-initio';
}

/**
 * Кусок HTML, который вставляется в точку входа.
 *
 * Три тега подряд и в этом порядке: библиотека, конфигурация, запуск. Обычные (не `module`,
 * не `async`) скрипты выполняются по порядку и до скриптов самого курса, поэтому к моменту, когда
 * курс начнёт искать `window.API`, он уже на месте вместе с загруженным состоянием.
 */
export function renderRuntimeSnippet(config: RuntimeConfig): string {
  return [
    `<script src="${escapeAttribute(config.libraryUrl)}"></script>`,
    `<script>window.__AMPLICADA_LEARNING__=${embedJson(config)};</script>`,
    `<script>${BOOTSTRAP}</script>`,
  ].join('\n');
}

/**
 * JSON внутри `<script>` — это HTML, а не JavaScript: последовательность `</script` закрывает тег
 * прямо посреди строки, чем бы она ни была экранирована по правилам JS. Гасим `<` целиком —
 * `<` в JSON-строке читается как тот же символ, а парсер HTML его уже не видит.
 *
 * Заодно всё не-ASCII уходит в `\uXXXX`, и это не про безопасность: вставка попадает в чужой
 * документ, у которого своя кодировка. Курсы в windows-1251 — обычное дело, и байты UTF-8 внутри
 * такой страницы браузер прочитает как кракозябры. ASCII читается одинаково во всех кодировках,
 * с которыми мы можем встретиться.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]|</g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Вставка сразу **после открывающего** `<head>`, иначе в начало `<body>`, иначе в начало документа.
 *
 * Именно в начало, а не перед `</head>`: рантайм обязан существовать раньше любого скрипта курса.
 * Драйверы вроде Rustici ищут `window.API` прямо при загрузке, и вставка в конец `head` означала бы,
 * что курс успел поискать API до того, как мы его положили, — а второй попытки он не делает.
 *
 * Побочно это решает и `<base href>`: он действует только на элементы **после** себя, так что наши
 * теги остаются вне его влияния.
 *
 * Больше ничего не переписывается: разметку чужого пакета мы не трогаем принципиально — правка
 * чужого HTML регулярками и есть главный источник «у нас курс не открывается».
 */
export function injectRuntime(html: string, snippet: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`;
  }

  const body = /<body[^>]*>/i.exec(html);
  if (body) {
    const at = body.index + body[0].length;
    return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`;
  }

  return `${snippet}\n${html}`;
}

/**
 * Тело запуска. Строкой, а не отдельным собираемым файлом: это единственный кусок кода в проекте,
 * который исполняется в чужом документе, и таскать ради него сборку фронтенда в бэкенд-пакет
 * дороже, чем держать тридцать строк на виду.
 *
 * `commitRequestDataType: text/plain` — не небрежность: завершающий коммит `scorm-again` отправляет
 * через `sendBeacon`, а тот другого типа не умеет. Разводить два формата тела ради одного из двух
 * путей отправки — лишняя развилка на ровном месте, поэтому оба ходят одинаково. Тело от этого не
 * перестаёт быть JSON, и наш роут разбирает его явно.
 *
 * `requestHandler` дописывает в тело попытку и сессию просмотра. Раньше они ехали в подписанном
 * токене внутри URL; теперь чью попытку обновлять решает сессия на сервере, а `sessionId` —
 * клиентский lease против двух вкладок (см. `RuntimeConfig.sessionId`).
 *
 * Текст только ASCII — как и всё, что мы вставляем в чужую страницу: у неё своя кодировка, и
 * кириллица в windows-1251-документе превратилась бы в кракозябры (см. `embedJson`). Комментарии
 * внутри тоже: это не исходник, а данные, которые уедут в чужой документ как есть.
 *
 * Строка в консоль нужна для отладки: курсы ищут API по имени (`API` у 1.2, `API_1484_11` у 2004) и
 * при промахе жалуются одинаково — «unable to acquire LMS API», не говоря, что именно искали. Наша
 * запись оказывается в том же логе строкой выше и сразу показывает, чей это разлад.
 */
const BOOTSTRAP = `(function(){
var cfg=window.__AMPLICADA_LEARNING__;
var Api=cfg.kind==='scorm2004'?window.Scorm2004API:window.Scorm12API;
if(!Api){console.error('[amplicada] SCORM runtime failed to load');return;}
var api=new Api({
lmsCommitUrl:cfg.commitUrl,
autocommit:true,
autocommitSeconds:cfg.autocommitSeconds,
alwaysSendTotalTime:true,
commitRequestDataType:'text/plain;charset=UTF-8',
xhrWithCredentials:true,
requestHandler:function(body){body.attemptId=cfg.attemptId;body.sessionId=cfg.sessionId;return body;},
logLevel:4
});
api.loadFromJSON(cfg.cmi);
var name=cfg.kind==='scorm2004'?'API_1484_11':'API';
window[name]=api;
console.info('[amplicada] SCORM runtime installed as window.'+name+' ('+cfg.kind+')');
})();`;
