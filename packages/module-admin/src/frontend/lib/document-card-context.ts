import { createContext, useContext } from 'react';

export interface DocumentCardContextValue {
  documentType: string;
  /**
   * Идентификатор открытого документа; `null` у несохранённого (`isNew`).
   *
   * Нужен тем вкладам в карточку, которые ходят в свой API сами, а не через общее «Сохранить»:
   * загрузчик файла заливает пакет отдельным запросом со своим побочным эффектом, и ему надо знать,
   * к какому курсу. `null` при этом не «ещё не загрузилось», а «ссылаться пока не на что» — вклад
   * обязан это показать, а не отправить запрос в никуда.
   */
  documentId: string | null;
  /** module → key extension'а → поля. Модуль с единственным `extend()` берёт `DEFAULT_EXTENSION_KEY`. */
  editData: Record<string, Record<string, Record<string, unknown>>>;
  updateField: (module: string, key: string, fieldKey: string, value: unknown) => void;
  isNew: boolean;
}

export const DocumentCardContext = createContext<DocumentCardContextValue | null>(null);

export function useDocumentCardContext(): DocumentCardContextValue {
  const ctx = useContext(DocumentCardContext);
  if (!ctx) throw new Error('useDocumentCardContext must be used within DocumentCardContext.Provider');
  return ctx;
}
