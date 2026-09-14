/** Ошибки HrStructureService. Роуты (когда появятся) маппят их через .statusCode; до тех пор их подхватывает
 *  generic-фолбэк в module-admin's setErrorHandler (`error.statusCode ?? 500`). */

export class VersionOverlapError extends Error {
  readonly statusCode = 409;
  constructor(message = 'На указанную дату уже существует другая версия этой сущности. Проверьте даты действия.') {
    super(message);
    this.name = 'VersionOverlapError';
  }
}

export class NodeHasActiveAppointmentsError extends Error {
  readonly statusCode = 400;
  constructor(
    message = 'Невозможно закрыть: на связанных штатных единицах числятся активные сотрудники. Сначала оформите перевод или увольнение.',
  ) {
    super(message);
    this.name = 'NodeHasActiveAppointmentsError';
  }
}

export class InvalidEffectiveDateError extends Error {
  readonly statusCode = 400;
  constructor(message = 'Дата вступления в силу не может быть в прошлом без пометки isSystemCorrection (ретроспективная корректировка).') {
    super(message);
    this.name = 'InvalidEffectiveDateError';
  }
}

export class ParentCycleDetectedError extends Error {
  readonly statusCode = 400;
  constructor(message = 'Нельзя сделать узел потомком самого себя — циклическая зависимость в иерархии.') {
    super(message);
    this.name = 'ParentCycleDetectedError';
  }
}
