import type { DocumentRegistry } from '@amplicada/platform-core/contracts';
import { registerProcessInstanceDoc } from './process-instance.js';
import { registerWorkflowDoc } from './workflow.js';

export { registerProcessInstanceDoc } from './process-instance.js';
export { registerWorkflowDoc } from './workflow.js';

export function registerWorkflowDocuments(docs: DocumentRegistry): void {
  registerWorkflowDoc(docs);
  registerProcessInstanceDoc(docs);
}
