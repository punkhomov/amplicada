import { DashboardTopics } from '@amplicada/platform-core/contracts';
import type { BackendSetupContext } from '@amplicada/platform-core/contracts/backend';
import type { FastifyInstance } from 'fastify';
import type { AdminDashboardItem, AdminDashboardResponse } from '../../contracts/types.js';
import { resolveDashboardResponse, resolveRegistryMeta } from '../lib/resolve-document-labels.js';

export function createRegistryRoutes(fastify: FastifyInstance, context: BackendSetupContext): void {
  const runtime = context.services.resolve<import('@amplicada/platform-core/contracts/backend').BackendDocumentRuntime>('document-runtime');

  fastify.get('/registry/documents', async (request): Promise<AdminDashboardResponse> => {
    const registeredTopics = context.documents.dashboard.getTopics();
    const topics = registeredTopics.some(t => t.id === DashboardTopics.DOCUMENTS)
      ? registeredTopics
      : [{ id: DashboardTopics.DOCUMENTS, label: 'admin:dashboard_topic_documents', order: 0 }, ...registeredTopics];

    const documentItems: AdminDashboardItem[] = context.documents.getAll().map(doc => ({
      kind: 'document',
      id: doc.id,
      module: doc.module,
      label: doc.label,
      topic: doc.topic ?? DashboardTopics.DOCUMENTS,
      section: doc.section,
    }));
    const linkItems: AdminDashboardItem[] = context.documents.dashboard.getLinks().map(link => ({
      kind: 'link',
      id: link.id,
      module: link.module,
      label: link.label,
      path: link.path,
      topic: link.topic,
      section: link.section,
      icon: link.icon,
    }));

    return resolveDashboardResponse(
      {
        topics,
        sections: context.documents.dashboard.getSections(),
        items: [...documentItems, ...linkItems],
      },
      request.t,
    );
  });

  fastify.get('/registry/documents/:type', async (request, reply) => {
    const { type } = request.params as { type: string };
    const meta = runtime.getRegistryMeta(type);
    if (!meta) return reply.code(404).send({ error: 'Document type not found' });
    return resolveRegistryMeta(meta, request.t);
  });

  fastify.get('/registry/modules', async () => {
    return context.modules.getAll();
  });
}
