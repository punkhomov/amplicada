/** Ошибки движка. Роуты (фазы 03/04) маппят их в HTTP-статусы в setErrorHandler. */

export class WorkflowValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Конфигурация процесса невалидна: ${errors.join('; ')}`);
    this.name = 'WorkflowValidationError';
    this.errors = errors;
  }
}

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionError';
  }
}

export class ValidatorFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidatorFailedError';
  }
}

export class ForbiddenActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenActionError';
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowNotFoundError';
  }
}
