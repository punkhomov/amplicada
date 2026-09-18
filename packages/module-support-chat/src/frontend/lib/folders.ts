import type { SupportAdminThreadDto } from '../../contracts/index.js';

/** Почтовые папки списка поддержки: вопросы отделены от обращений с участием поддержки. */
export type ThreadFolder = 'all' | 'questions' | 'requests' | 'incidents';

export const THREAD_FOLDERS: ThreadFolder[] = ['all', 'questions', 'requests', 'incidents'];

export function matchesFolder(thread: SupportAdminThreadDto, folder: ThreadFolder): boolean {
  switch (folder) {
    case 'all':
      return true;
    case 'questions':
      // Ещё не тронуты поддержкой и не привязаны к инциденту — кандидаты на авто-ответ.
      return thread.kind === 'question' && !thread.incidentThreadId && !thread.hasSupportReply;
    case 'requests':
      // Обычное обращение, где поддержка уже отвечала, или затронутое инцидентом.
      return thread.kind === 'question' && (thread.incidentThreadId !== null || thread.hasSupportReply);
    case 'incidents':
      return thread.kind === 'incident';
  }
}

export interface FolderCount {
  total: number;
  unread: number;
}

export function folderCounts(threads: SupportAdminThreadDto[]): Record<ThreadFolder, FolderCount> {
  const counts: Record<ThreadFolder, FolderCount> = {
    all: { total: 0, unread: 0 },
    questions: { total: 0, unread: 0 },
    requests: { total: 0, unread: 0 },
    incidents: { total: 0, unread: 0 },
  };

  for (const thread of threads) {
    for (const folder of THREAD_FOLDERS) {
      if (!matchesFolder(thread, folder)) continue;
      counts[folder].total += 1;
      counts[folder].unread += thread.unreadCount;
    }
  }
  return counts;
}
