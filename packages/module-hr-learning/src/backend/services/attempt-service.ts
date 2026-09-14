import { randomUUID } from 'node:crypto';
import type { BackendDbService, BackendDocumentRuntime } from '@amplicada/platform-core/contracts/backend';
import { and, eq, ne } from 'drizzle-orm';
import { type AttemptProgress, isScormKind, LearningDocuments } from '../../contracts/index.js';
import {
  type HrLearningAttemptRow,
  type HrLearningPackageRow,
  hrLearningAttempts,
  hrLearningCourses,
  hrLearningPackages,
} from '../schemas/index.js';
import { normalizeCmi } from './cmi-normalize.js';

/** Ошибка с кодом статуса — обработчик модуля отдаёт её как есть. */
export class AttemptError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AttemptError';
  }
}

export interface LaunchedAttempt {
  attempt: HrLearningAttemptRow;
  pkg: HrLearningPackageRow;
  courseTitle: string;
  /** Выпущен на этот заход; коммиты принимаются только с ним. */
  sessionId: string;
}

/**
 * Попытки прохождения: старт, lease на одну активную сессию, применение коммитов.
 *
 * Попытка — документ (`learning-attempt`), поэтому строка заводится только через
 * `allocateDocumentId`: `attempts.id` ссылается на `core.document_index(id)` внешним ключом.
 */
export class AttemptService {
  constructor(
    private readonly db: BackendDbService,
    private readonly documents: BackendDocumentRuntime,
  ) {}

  /**
   * Открыть курс: найти незавершённую попытку или завести новую и выдать ей сессию.
   *
   * Пакет берётся **у попытки**, а не текущий у курса: перезалив контента посреди прохождения не
   * должен подменять курс под учащимся, а сохранённый `cmi` осмыслен только в том пакете, который
   * его написал. Текущий пакет выбирается лишь при заведении новой попытки.
   */
  async launch(courseId: string, userId: string): Promise<LaunchedAttempt> {
    const [course] = await this.db
      .select({ id: hrLearningCourses.id, title: hrLearningCourses.title, active: hrLearningCourses.active })
      .from(hrLearningCourses)
      .where(eq(hrLearningCourses.id, courseId))
      .limit(1);
    if (!course) throw new AttemptError(404, 'Курс не найден');
    if (!course.active) throw new AttemptError(409, 'Курс выключен');

    const sessionId = randomUUID();
    const open = await this.openAttempt(courseId, userId);

    if (open) {
      const pkg = await this.packageById(open.packageId);
      // Пакет мог быть удалён вместе с курсом-черновиком — попытка на несуществующем контенте
      // никуда не ведёт, и молчать об этом хуже, чем показать пустой iframe.
      if (!pkg) throw new AttemptError(409, 'Контент этой попытки больше не доступен');
      const [attempt] = await this.db.update(hrLearningAttempts).set({ sessionId }).where(eq(hrLearningAttempts.id, open.id)).returning();
      return { attempt, pkg, courseTitle: course.title, sessionId };
    }

    const pkg = await this.currentPackage(courseId);
    const attempt = await this.db.transaction(async tx => {
      const id = await this.documents.allocateDocumentId(LearningDocuments.ATTEMPT, tx, { actor: { userId } });
      const [row] = await tx.insert(hrLearningAttempts).values({ id, courseId, packageId: pkg.id, userId, sessionId }).returning();
      return row;
    });

    return { attempt, pkg, courseTitle: course.title, sessionId };
  }

  /**
   * Применить коммит рантайма.
   *
   * `cmi` перезаписывается целиком, а не сливается: рантайм присылает полное состояние
   * (`sendFullCommit`), и слияние с прошлым воскресило бы поля, которые курс намеренно очистил.
   */
  async applyCommit(attemptId: string, userId: string, sessionId: string, cmi: Record<string, unknown>): Promise<AttemptProgress> {
    const [attempt] = await this.db.select().from(hrLearningAttempts).where(eq(hrLearningAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new AttemptError(404, 'Попытка не найдена');

    // Владелец — из сессии, а не из тела: id попытки клиент называет сам, и без этой проверки любой
    // вошедший дописывал бы прогресс в чужую.
    if (attempt.userId !== userId) throw new AttemptError(403, 'Это чужая попытка');

    // Lease: курс, открытый во второй вкладке, перевыпустил сессию — первая с этого момента пишет
    // мимо. Без этого две вкладки перетирают `cmi` целиком по принципу «кто последний», и прогресс
    // теряется молча. Значение клиентское, и это осознанно: защита от случайности, не от умысла.
    if (attempt.sessionId !== sessionId)
      throw new AttemptError(409, 'Курс открыт в другом окне — эта вкладка больше не сохраняет прогресс');

    const pkg = await this.packageById(attempt.packageId);
    const normalized = normalizeCmi(cmi, pkg?.kind ?? 'scorm12');
    const completedNow = normalized.completion === 'completed';

    const [updated] = await this.db
      .update(hrLearningAttempts)
      .set({
        cmi,
        // Ручную отметку админа коммит не отменяет: «пройдено» проставлено человеком поверх курса,
        // который финального статуса не шлёт, и обратный переход означал бы, что кнопка не работает.
        completion: attempt.manualOverride ? attempt.completion : normalized.completion,
        success: attempt.manualOverride ? attempt.success : normalized.success,
        score: normalized.score === null ? attempt.score : String(normalized.score),
        totalTimeSeconds: normalized.totalTimeSeconds === null ? attempt.totalTimeSeconds : Math.round(normalized.totalTimeSeconds),
        updatedAt: new Date(),
        // Проставляется один раз: дата первого завершения, а не последнего коммита после него.
        completedAt: attempt.completedAt ?? (completedNow ? new Date() : null),
      })
      .where(eq(hrLearningAttempts.id, attemptId))
      .returning();

    return toProgress(updated);
  }

  /** «Ознакомлен» для `kind: 'file'` — у PDF и видео своего рантайма нет и быть не может. */
  async acknowledge(attemptId: string, userId: string): Promise<AttemptProgress> {
    const [attempt] = await this.db.select().from(hrLearningAttempts).where(eq(hrLearningAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new AttemptError(404, 'Попытка не найдена');
    if (attempt.userId !== userId) throw new AttemptError(403, 'Это чужая попытка');

    const pkg = await this.packageById(attempt.packageId);
    if (pkg && isScormKind(pkg.kind)) throw new AttemptError(409, 'У SCORM-курса статус проставляет сам курс');

    const [updated] = await this.db
      .update(hrLearningAttempts)
      .set({ completion: 'completed', updatedAt: new Date(), completedAt: attempt.completedAt ?? new Date() })
      .where(eq(hrLearningAttempts.id, attemptId))
      .returning();

    return toProgress(updated);
  }

  async progress(attemptId: string, userId: string): Promise<AttemptProgress> {
    const [attempt] = await this.db.select().from(hrLearningAttempts).where(eq(hrLearningAttempts.id, attemptId)).limit(1);
    if (!attempt) throw new AttemptError(404, 'Попытка не найдена');
    if (attempt.userId !== userId) throw new AttemptError(403, 'Это чужая попытка');
    return toProgress(attempt);
  }

  private async openAttempt(courseId: string, userId: string): Promise<HrLearningAttemptRow | null> {
    // Условие повторяет частичный уникальный индекс `idx_attempts_one_open`: незавершённая попытка
    // на курс ровно одна, поэтому limit(1) здесь не выбор из нескольких, а чтение единственной.
    const [row] = await this.db
      .select()
      .from(hrLearningAttempts)
      .where(
        and(
          eq(hrLearningAttempts.courseId, courseId),
          eq(hrLearningAttempts.userId, userId),
          ne(hrLearningAttempts.completion, 'completed'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async currentPackage(courseId: string): Promise<HrLearningPackageRow> {
    const [pkg] = await this.db
      .select()
      .from(hrLearningPackages)
      .where(and(eq(hrLearningPackages.courseId, courseId), eq(hrLearningPackages.isCurrent, true)))
      .limit(1);
    if (!pkg) throw new AttemptError(409, 'У курса нет контента — админ ещё не загрузил пакет');
    if (pkg.status !== 'ready') throw new AttemptError(409, 'Контент курса ещё обрабатывается');
    if (!pkg.entryPoint) throw new AttemptError(409, 'У пакета нет точки входа — запускать нечего');
    return pkg;
  }

  private async packageById(packageId: string): Promise<HrLearningPackageRow | null> {
    const [pkg] = await this.db.select().from(hrLearningPackages).where(eq(hrLearningPackages.id, packageId)).limit(1);
    return pkg ?? null;
  }
}

export function toProgress(row: HrLearningAttemptRow): AttemptProgress {
  return {
    attemptId: row.id,
    completion: row.completion,
    success: row.success ?? null,
    // `numeric` приезжает из pg строкой (точность там не влезает в double) — приводим явно.
    score: row.score === null ? null : Number(row.score),
    totalTimeSeconds: row.totalTimeSeconds,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
