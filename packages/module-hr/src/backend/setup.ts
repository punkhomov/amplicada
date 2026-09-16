import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_REGISTRY_TOKEN, type WorkflowRegistry } from '@amplicada/module-workflow/contracts';
import type { BackendDbService, BackendDocumentRuntime, BackendModule } from '@amplicada/platform-core/contracts/backend';
import { moduleManifest } from '../contracts/manifest.js';
import { HR_STRUCTURE_SERVICE_TOKEN } from '../contracts/service.js';
import { registerHrDocuments } from './documents/index.js';
import { hrBackendLocales } from './locales/index.js';
import { HrStructureService } from './services/hr-structure-service.js';
import { fixedAssigneeProvider } from './workflow-delegates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const hrModule: BackendModule = {
  ...moduleManifest,
  locales: { backend: { ru: hrBackendLocales.ru, en: hrBackendLocales.en } },

  setup(context) {
    const migrationsPath = join(__dirname, '..', '..', 'migrations');
    context.migrations.register('hr', migrationsPath);

    const workflowRegistry = context.services.resolve<WorkflowRegistry>(WORKFLOW_REGISTRY_TOKEN);
    workflowRegistry.registerAssigneeProvider('fixed-assignee', 'Фиксированный исполнитель', fixedAssigneeProvider);

    const db = context.services.resolve<BackendDbService>('db');
    const documentRuntime = context.services.resolve<BackendDocumentRuntime>('document-runtime');
    const hrStructureService = new HrStructureService({ db, documentRuntime });
    context.services.register(HR_STRUCTURE_SERVICE_TOKEN, hrStructureService);

    registerHrDocuments(context.documents, hrStructureService);
  },
};
