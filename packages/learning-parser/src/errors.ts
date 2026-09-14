/**
 * Отказ разобрать пакет. Текст уходит в `packages.error` и попадает админу на карточку курса,
 * поэтому пишется для человека, а не для лога.
 */
export class PackageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageParseError';
  }
}
