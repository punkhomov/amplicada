import type { DocumentRegistry } from '../../contracts/documents.js';
import { DocumentGroups, DocumentPages } from '../../contracts/documents.js';

export function registerCorePages(docs: DocumentRegistry): void {
  docs.objects.registerPage(DocumentPages.DEFAULT, {
    document: '*',
    label: 'core:page_default',
  });

  docs.objects.registerGroup(DocumentGroups.DEFAULT, {
    document: '*',
    page: DocumentPages.DEFAULT,
    label: 'core:group_default',
    order: 0,
  });
}
