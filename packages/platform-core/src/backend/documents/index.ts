import type { BackendStorageService } from '../../contracts/backend/storage.js';
import type { DocumentRegistry } from '../../contracts/documents.js';
import { registerCorePages } from './core-pages.js';
import { registerNotificationTemplateDoc } from './notification-template.js';
import { registerScheduledTaskDoc } from './scheduled-task.js';
import { registerUserDoc } from './user.js';
import { registerUserGroupDoc } from './user-group.js';

export { registerCorePages } from './core-pages.js';
export { registerNotificationTemplateDoc } from './notification-template.js';
export { registerScheduledTaskDoc } from './scheduled-task.js';
export { registerUserDoc } from './user.js';
export { registerUserGroupDoc } from './user-group.js';

export function registerCoreDocuments(docs: DocumentRegistry, storage: BackendStorageService): void {
  registerCorePages(docs);
  registerUserDoc(docs);
  registerUserGroupDoc(docs);
  registerScheduledTaskDoc(docs);
  registerNotificationTemplateDoc(docs, storage);
}
