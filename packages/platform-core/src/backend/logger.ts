import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

/** Пишет строку в лог конкретного run'а фоновой задачи (история в БД + live через SSE). */
export interface TaskLogSink {
  info(message: string): void;
  error(message: string): void;
}

export interface TaskLogContext {
  taskId: string;
  runId: string;
  taskLogger: TaskLogSink;
}

const taskContext = new AsyncLocalStorage<TaskLogContext>();

let instance: pino.Logger | undefined;

function ensureInstance(): pino.Logger {
  if (!instance) instance = pino();
  return instance;
}

/**
 * Задаёт конфигурацию pino (опции + опционально свой destination/transport) до первого использования
 * логгера. Вызывать самой первой строкой в apps/api/src/index.ts, до createApp() — pino не умеет менять
 * destination/transport у уже созданного инстанса, поэтому конфигурация возможна только один раз, заранее.
 * Если никто не вызвал — при первом обращении к `logger` инстанс лениво создаётся с дефолтной
 * конфигурацией (вывод в stdout), приложение не падает.
 */
export function configureLogger(options?: pino.LoggerOptions, destination?: pino.DestinationStream): void {
  if (instance) {
    throw new Error(
      'configureLogger() called after the logger was already used — move this call to the very start of the application entrypoint, before anything else can log.',
    );
  }
  instance = destination ? pino(options ?? {}, destination) : pino(options ?? {});
}

const MIRRORED_METHODS = new Set(['info', 'error']);

function extractMessage(args: unknown[]): string {
  if (typeof args[0] === 'string') return args[0];
  if (args.length > 1 && typeof args[1] === 'string') return args[1];
  try {
    return JSON.stringify(args[0]);
  } catch {
    return String(args[0]);
  }
}

/**
 * Проксирует только то, что нам реально нужно — info/error (дублирование в лог фоновой задачи
 * через ALS, пока выполняется runWithTaskLogger) и child (чтобы обёртка с этим же перехватом не
 * терялась на дочерних логгерах). Всё остальное (level, flush, bindings, isLevelEnabled, символьные
 * свойства вроде serializersSym, которые проверяет сам Fastify, и т.д.) уходит напрямую в реальный
 * pino через Reflect — поэтому фасад честно типизируется как pino.Logger, а не урезанный контракт.
 */
function createFacade(getTarget: () => pino.Logger): pino.Logger {
  return new Proxy({} as pino.Logger, {
    get(_target, prop, _receiver) {
      const target = getTarget();

      if (prop === 'child') {
        return (bindings: pino.Bindings, options?: pino.ChildLoggerOptions) => createFacade(() => target.child(bindings, options));
      }

      if (typeof prop === 'string' && MIRRORED_METHODS.has(prop)) {
        const level = prop as 'info' | 'error';
        return (...args: unknown[]) => {
          (target[level] as (...a: unknown[]) => void)(...args);
          taskContext.getStore()?.taskLogger[level](extractMessage(args));
        };
      }

      // receiver = target (не сам Proxy) — иначе внутренний `this` в методах/геттерах pino
      // попадёт на пустой прокси-объект вместо реального инстанса.
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(getTarget(), prop, value);
    },
  });
}

/** Платформенный логгер — модульный singleton, импортируется напрямую везде: `import { logger } from '@amplicada/platform-core/backend'`. */
export const logger: pino.Logger = createFacade(ensureInstance);

/** Оборачивает выполнение фоновой задачи ambient-контекстом: пока выполняется fn, вызовы logger.info/error дублируются в ctx.taskLogger. */
export function runWithTaskLogger<T>(ctx: TaskLogContext, fn: () => Promise<T>): Promise<T> {
  return taskContext.run(ctx, fn);
}
