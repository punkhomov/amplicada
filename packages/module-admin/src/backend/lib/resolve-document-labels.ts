import type { DashboardSection, DashboardTopic, FieldMetadata, ListFieldMeta } from '@amplicada/platform-core/contracts';
import type {
  DocumentExportResult,
  DocumentListResult,
  DocumentRegistryMetaResult,
  DocumentTypeMeta,
  EnrichedExtension,
  EnrichedGroup,
  EnrichedPage,
} from '@amplicada/platform-core/contracts/backend';
import type { TFunction } from 'i18next';
import type { AdminDashboardItem, AdminDashboardResponse } from '../../contracts/types.js';

/**
 * `label` не сконвертированных ещё в ключи модулей — это по-прежнему сырой русский текст, а не
 * i18next-ключ. `defaultValue: label` гарантирует, что для них t() вернёт этот же текст без
 * изменений (и не наступит на i18next-парсинг разделителей `:`/`.`, если текст случайно их содержит).
 */
function tl(t: TFunction, label: string): string {
  return t(label, { defaultValue: label });
}

function resolveTypeMeta(meta: DocumentTypeMeta, t: TFunction): DocumentTypeMeta {
  return { ...meta, label: tl(t, meta.label) };
}

function resolveListColumns(columns: Record<string, ListFieldMeta>, t: TFunction): Record<string, ListFieldMeta> {
  return Object.fromEntries(
    Object.entries(columns).map(([key, meta]) => [
      key,
      // options резолвятся так же, как в resolveFieldMetadata — иначе варианты select-фильтра
      // приехали бы на фронт сырыми i18n-ключами.
      { ...meta, label: tl(t, meta.label), options: meta.options?.map(opt => ({ ...opt, label: tl(t, opt.label) })) },
    ]),
  );
}

function resolveFieldMetadata(fields: Record<string, FieldMetadata>, t: TFunction): Record<string, FieldMetadata> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, meta]) => [
      key,
      {
        ...meta,
        label: tl(t, meta.label),
        placeholder: meta.placeholder ? tl(t, meta.placeholder) : meta.placeholder,
        helpText: meta.helpText ? tl(t, meta.helpText) : meta.helpText,
        options: meta.options?.map(opt => ({ ...opt, label: tl(t, opt.label) })),
      },
    ]),
  );
}

function resolveExtension(ext: EnrichedExtension, t: TFunction): EnrichedExtension {
  return { ...ext, fields: resolveFieldMetadata(ext.fields, t) };
}

function resolveGroup(group: EnrichedGroup, t: TFunction): EnrichedGroup {
  return { ...group, label: tl(t, group.label), extensions: group.extensions.map(ext => resolveExtension(ext, t)) };
}

function resolvePage(page: EnrichedPage, t: TFunction): EnrichedPage {
  return { ...page, label: tl(t, page.label), groups: page.groups.map(group => resolveGroup(group, t)) };
}

export function resolveRegistryMeta(meta: DocumentRegistryMetaResult, t: TFunction): DocumentRegistryMetaResult {
  return { type: resolveTypeMeta(meta.type, t), pages: meta.pages.map(page => resolvePage(page, t)) };
}

export function resolveListResult(result: DocumentListResult, t: TFunction): DocumentListResult {
  return { ...result, type: resolveTypeMeta(result.type, t), columns: resolveListColumns(result.columns, t) };
}

export function resolveExportResult(result: DocumentExportResult, t: TFunction): DocumentExportResult {
  return {
    ...result,
    type: resolveTypeMeta(result.type, t),
    // columns — двухуровневый namespace (module → key extension'а → поля), см. DocumentExtension.key.
    columns: Object.fromEntries(
      Object.entries(result.columns).map(([mod, byKey]) => [
        mod,
        Object.fromEntries(Object.entries(byKey).map(([key, cols]) => [key, resolveListColumns(cols, t)])),
      ]),
    ),
  };
}

function resolveDashboardTopic(topic: DashboardTopic, t: TFunction): DashboardTopic {
  return { ...topic, label: tl(t, topic.label) };
}

function resolveDashboardSection(section: DashboardSection, t: TFunction): DashboardSection {
  return { ...section, label: tl(t, section.label) };
}

function resolveDashboardItem(item: AdminDashboardItem, t: TFunction): AdminDashboardItem {
  return { ...item, label: tl(t, item.label) };
}

export function resolveDashboardResponse(response: AdminDashboardResponse, t: TFunction): AdminDashboardResponse {
  return {
    topics: response.topics.map(topic => resolveDashboardTopic(topic, t)),
    sections: response.sections.map(section => resolveDashboardSection(section, t)),
    items: response.items.map(item => resolveDashboardItem(item, t)),
  };
}
