/** Типы вопросов опроса (v1: набор фиксирован, без кастомных виджетов на модуль). */
export type PollQuestionType = 'single-choice' | 'multi-choice' | 'text' | 'textarea' | 'rating' | 'nps';

/** Декларативное описание вопроса — редактируется админом, пока опрос в статусе draft. */
export interface PollQuestion {
  key: string;
  label: string;
  type: PollQuestionType;
  required?: boolean;
  helpText?: string;
  /** Только для single-choice / multi-choice. */
  options?: { label: string; value: string }[];
}

/** Статус опроса относительно текущего пользователя — вычисляемый, как RequestStatus в hr-request. */
export type PollUserStatus = 'available' | 'answered' | 'closed';

export interface PollListItem {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: PollUserStatus;
}

export interface PollDetail {
  id: string;
  title: string;
  description: string | null;
  questions: PollQuestion[];
  /** Не null, если пользователь уже отвечал — форма рендерится readonly поверх этих ответов (кроме allowRepeat). */
  myAnswers: Record<string, unknown> | null;
  allowRepeat: boolean;
  canSubmit: boolean;
}

/** id-константы Document System для документов «Опрос» и «Ответ на опрос» (read-only). */
export const HrPollDocuments = { POLL: 'poll', RESPONSE: 'response' } as const;
export const HrPollGroups = { QUESTIONS: 'hr-poll-questions' } as const;
