import type {
  DashboardLink,
  DashboardRegistry,
  DashboardSection,
  DashboardTopic,
  DocumentExtension,
  DocumentGroup,
  DocumentListRegistry,
  DocumentObjectRegistry,
  DocumentPage,
  DocumentRegistry,
  DocumentType,
  FixtureDefinition,
  FixtureRegistry,
  ListExtension,
} from '../contracts/documents.js';
import { DEFAULT_EXTENSION_KEY } from '../contracts/documents.js';

export class DocumentRegistryImpl implements DocumentRegistry {
  private docs = new Map<string, DocumentType>();
  private pages = new Map<string, DocumentPage>();
  private groups = new Map<string, DocumentGroup>();
  private extensions = new Map<string, DocumentExtension[]>();
  private listExtensions = new Map<string, ListExtension[]>();
  private dashboardTopics = new Map<string, DashboardTopic>();
  private dashboardSections = new Map<string, DashboardSection>();
  private dashboardLinks = new Map<string, DashboardLink>();
  private fixtureDefs: FixtureDefinition[] = [];

  readonly objects: DocumentObjectRegistry = {
    registerPage: (id, page) => {
      this.pages.set(id, { id, ...page });
    },
    registerGroup: (id, group) => {
      this.groups.set(id, { id, ...group });
    },
    extend: (docId, ext) => {
      const list = this.extensions.get(docId) || [];
      // key нормализуется здесь и только здесь: дальше по коду (рантайм, wire-формат, БД) он —
      // всегда конкретная строка, поэтому ветки "а если ключа нет" нигде не нужны.
      const key = ext.key ?? DEFAULT_EXTENSION_KEY;
      if (list.some(e => e.module === ext.module && e.key === key)) {
        throw new Error(`Document '${docId}' already has an extension registered for module '${ext.module}' with key '${key}'`);
      }
      list.push({ document: docId, ...ext, key });
      this.extensions.set(docId, list);
    },
    getPages: docId => {
      return [...this.pages.values()].filter(p => p.document === docId || p.document === '*');
    },
    getGroups: (pageId, docId) => {
      return [...this.groups.values()].filter(g => g.page === pageId && (!docId || g.document === docId || g.document === '*'));
    },
    getExtensions: docId => {
      return this.extensions.get(docId) || [];
    },
  };

  readonly lists: DocumentListRegistry = {
    extend: (docId, ext) => {
      const list = this.listExtensions.get(docId) || [];
      // Проверки уникальности здесь нет (и не было) — только нормализация key, как в objects.extend.
      list.push({ document: docId, ...ext, key: ext.key ?? DEFAULT_EXTENSION_KEY });
      this.listExtensions.set(docId, list);
    },
    getExtensions: docId => {
      return this.listExtensions.get(docId) || [];
    },
  };

  readonly dashboard: DashboardRegistry = {
    registerTopic: (id, topic) => {
      this.dashboardTopics.set(id, { id, ...topic });
    },
    registerSection: (id, section) => {
      this.dashboardSections.set(id, { id, ...section });
    },
    registerLink: (id, link) => {
      this.dashboardLinks.set(id, { id, ...link });
    },
    getTopics: () => [...this.dashboardTopics.values()],
    getSections: topicId => [...this.dashboardSections.values()].filter(s => !topicId || s.topic === topicId),
    getLinks: topicId => [...this.dashboardLinks.values()].filter(l => !topicId || l.topic === topicId),
  };

  readonly fixtures: FixtureRegistry = {
    register: fixture => {
      this.fixtureDefs.push(fixture);
    },
    getAll: () => [...this.fixtureDefs],
  };

  register(id: string, doc: Omit<DocumentType, 'id'>): void {
    this.docs.set(id, { id, ...doc });
  }

  get(docId: string): DocumentType | undefined {
    return this.docs.get(docId);
  }

  getAll(): DocumentType[] {
    return [...this.docs.values()];
  }
}
