import type { LangString } from './lom.js';
import type { SequencingUsage } from './sequencing.js';

/**
 * Разобранное сверх общего — то, что есть у одного формата и не имеет смысла у остальных.
 *
 * Пока все пять форматов сходились в один плоский `PackageMetadata`, это работало: из каждого
 * доставали одно и то же — точку входа, название, порог. Sequencing SCORM 2004, `moveOn` из cmi5 и
 * секции `.crs` в общий тип не сводятся и не должны: `controlMode` у AICC не значит ничего.
 */

/**
 * Редакция SCORM 2004. Не косметика: 3-я изменила правила rollup, 4-я добавила
 * `constrainedChoiceConsiderations` и `rollupConsiderations`. Тому, кто однажды напишет рантайм,
 * разница нужна.
 */
export type ScormEdition = '2nd' | '3rd' | '4th';

export interface Scorm2004Details {
  /**
   * `null` — редакция не объявлена. Выводится из текста `schemaversion`; неймспейс для этого не
   * годится, `adlcp_v1p3` стоит и у 3-й, и у 4-й.
   */
  edition: ScormEdition | null;
  sequencingUsage: SequencingUsage;
  /**
   * Цели, через которые пункты курса обмениваются результатом. Собраны со всех `mapInfo` дерева:
   * по отдельному пункту их не видно, а поведение курса определяют они.
   */
  globalObjectives: string[];
  /** Общие «корзины» `adl.data`, к которым обращается хоть один пункт. */
  sharedDataTargets: string[];
}

/**
 * Условие зачёта единицы cmi5 — прямой аналог «когда засчитано». Порог сам по себе не решает
 * ничего: `masteryScore` говорит, сколько набрать, а `moveOn` — считать ли этого достаточным.
 *
 * Объявляется на `<au>`, а не на курсе, поэтому и живёт на пункте дерева, а не в `details`.
 */
export type MoveOn = 'Passed' | 'Completed' | 'CompletedAndPassed' | 'CompletedOrPassed' | 'NotApplicable';

/** Цель курса cmi5: объявляется один раз на курс, единицы ссылаются на неё по `idref`. */
export interface Cmi5Objective {
  id: string;
  title: string | null;
  description: string | null;
}

/**
 * Заготовка контекста xAPI: `<contextTemplate>` на `<course>` и на `<au>`.
 *
 * Элемента с таким именем в схеме course structure нет — это расширение, которое кладут сборщики,
 * чтобы LMS слила объявленное здесь с тем, что сама подставляет в `LMS.LaunchData`. Разбираем его
 * структурно, а не сырым деревом: внутри обычный объект контекста xAPI, и он описан.
 */
export interface Cmi5ContextTemplate {
  /** `contextActivities`: `parent` | `grouping` | `category` | `other` → IRI активностей. */
  contextActivities: Record<string, string[]>;
  /** `<extensions><extension id="IRI">значение</extension></extensions>` — пары от автора. */
  extensions: Record<string, string>;
}

export interface Cmi5Details {
  objectives: Cmi5Objective[];
  /**
   * Название и описание курса на всех объявленных языках. Наверху (`title`, `description`) лежит
   * выбранное для показа; здесь — то, что автор написал, целиком.
   *
   * В `details`, а не в общей части, потому что это подписи `<course>` — узла, которого в дереве
   * оглавления нет: в cmi5 корень дерева это блоки и единицы, а курс их обрамляет.
   */
  courseTitles: LangString;
  courseDescriptions: LangString;
  /** Курсовая заготовка контекста. Единицы объявляют свою — она лежит на пункте дерева. */
  contextTemplate: Cmi5ContextTemplate | null;
}

/** Связь цели AICC с единицей: `read` — цель влияет на единицу, `write` — единица её закрывает. */
export interface AiccObjectiveMember {
  unitId: string;
  relation: string | null;
}

export interface AiccObjective {
  id: string;
  members: AiccObjectiveMember[];
}

export interface AiccDetails {
  /** `Level` из `[Course]` — уровень поддержки AICC (1–4), от него зависит, что курс вообще умеет. */
  level: string | null;
  /** `Course_System` — чем собран курс. */
  courseSystem: string | null;
  /** `Max_Normal` из `[Course_Behavior]` — сколько раз курс можно проходить. */
  maxAttempts: number | null;
  /**
   * `Total_AUs` и `Total_Blocks` как объявил автор. Держим рядом с фактическим деревом намеренно:
   * расхождение — верный признак неполного `.au` или `.cst`, а решать, что с этим делать, не нам.
   */
  declaredUnits: number | null;
  declaredBlocks: number | null;
  /** Цели из `.ort` вместе с тем, какие единицы с ними связаны. */
  objectives: AiccObjective[];
}

/**
 * Специфика по формату. `null` там, где её нет: у SCORM 1.2 и xAPI всё объявленное — либо общее,
 * либо на пункте дерева, и заводить под это пустой тип значило бы обещать содержание, которого в
 * формате не бывает.
 *
 * Ключи обязаны совпадать с `PackageFormat` — за этим следит индексация в `PackageMetadata`.
 */
export interface PackageDetails {
  scorm12: null;
  scorm2004: Scorm2004Details;
  cmi5: Cmi5Details;
  xapi: null;
  aicc: AiccDetails;
}
