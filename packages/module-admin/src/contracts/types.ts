import type { DashboardSection, DashboardTopic } from '@amplicada/platform-core/contracts';

export interface AdminDocumentListResponse {
  items: Record<string, unknown>[];
}

export interface AdminDocumentResponse {
  id: string;
  [key: string]: unknown;
}

export interface AdminRegistryDocument {
  id: string;
  label: string;
}

export type AdminDashboardItem =
  | { kind: 'document'; id: string; module: string; label: string; topic: string; section?: string }
  | { kind: 'link'; id: string; module: string; label: string; path: string; topic: string; section?: string; icon?: string };

export interface AdminDashboardResponse {
  topics: DashboardTopic[];
  sections: DashboardSection[];
  items: AdminDashboardItem[];
}
