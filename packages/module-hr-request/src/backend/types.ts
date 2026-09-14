import { workflows } from '@amplicada/module-workflow/backend';
import type { BackendDbService } from '@amplicada/platform-core/contracts/backend';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { RequestTypeMeta } from '../contracts/index.js';
import { type HrRequestTypeRow, hrRequestTypes } from './schemas/index.js';

/** Карта code → тип, одним запросом на HTTP-запрос (типов единицы, списки резолвят label по коду). */
export async function loadTypeMap(db: BackendDbService): Promise<Map<string, HrRequestTypeRow>> {
  const rows = await db.select().from(hrRequestTypes);
  return new Map(rows.map(row => [row.code, row]));
}

/** Типы для портала: включены админом И workflow с таким кодом активен и имеет опубликованную версию. */
export async function loadPortalTypes(db: BackendDbService): Promise<RequestTypeMeta[]> {
  const rows = await db
    .select({ type: hrRequestTypes })
    .from(hrRequestTypes)
    .innerJoin(workflows, eq(workflows.code, hrRequestTypes.code))
    .where(and(eq(hrRequestTypes.portalEnabled, true), eq(workflows.isActive, true), isNotNull(workflows.currentVersionId)));
  return rows.map(({ type }) => ({
    code: type.code,
    label: type.label,
    titleTemplate: type.titleTemplate,
    formFields: type.formFields,
  }));
}

/** Заголовок заявки из шаблона типа: "{description} ({cost} ₽)" → подстановка полей. Пустой шаблон → label типа. */
export function renderTitle(type: HrRequestTypeRow | undefined, fields: Record<string, unknown>): string {
  const template = type?.titleTemplate?.trim();
  const fallback = type?.label ?? 'Заявка';
  if (!template) return fallback;
  const rendered = template
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = fields[key];
      return value === undefined || value === null ? '' : String(value);
    })
    .trim();
  return (rendered || fallback).slice(0, 250);
}
