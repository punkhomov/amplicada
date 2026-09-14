import type { FieldMetadata } from '@amplicada/platform-core/contracts';
import {
  type ApiClient,
  QueryError,
  useApiClient,
  useMutation,
  useQuery,
  useQueryClient,
  useTranslation,
} from '@amplicada/platform-core/frontend';
import { Alert, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@amplicada/platform-core/frontend/ui/alert-dialog';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Card, CardContent } from '@amplicada/platform-core/frontend/ui/card';
import { Separator } from '@amplicada/platform-core/frontend/ui/separator';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, type Params, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { getComponent } from '../../../lib/component-registry.js';
import { DocumentCardContext } from '../../../lib/document-card-context.js';
import { getToolbarActions } from '../../../lib/toolbar-action-registry.js';
import { AdminBreadcrumbs } from '../../../widgets/admin-breadcrumbs/index.js';
import { FieldWidget } from '../../../widgets/field-widget/index.js';

type LayoutCell =
  | { kind: 'field'; field: string; span: number }
  | { kind: 'component'; component: string; span: number }
  | { kind: 'empty'; span: number };

type LayoutRow = LayoutCell[];

interface ExtensionData {
  module: string;
  /** Различает несколько extend() одного модуля. Вместе с `module` адресует бакет `data[module][key]`. */
  key: string;
  fields: Record<string, FieldMetadata>;
  rows: LayoutRow[];
}

/** Данные документа: module → key extension'а → поля. Форма зеркалит `DocumentObject.data` бэкенда. */
type DocumentData = Record<string, Record<string, Record<string, unknown>>>;

interface GroupData {
  id: string;
  label: string;
  order: number;
  extensions: ExtensionData[];
}

/**
 * Что получает кастомный компонент карточки, зарегистрированный через `registerComponent`.
 *
 * Здесь только бакет своего extension'а: этого хватает и тем, кто просто рисует загруженное
 * бэкендом (`user-group-members`), и тем, кто правит его в памяти до общего сохранения
 * (`poll-questions-editor`).
 *
 * **Кто такой документ — не в пропсах, а в `useDocumentCardContext()`.** Так уже устроены действия
 * тулбара, и заводить второй канал для того же значило бы разъехаться с ним при первой же правке.
 */
export interface CardComponentProps {
  data: Record<string, unknown>;
  fields: Record<string, FieldMetadata>;
  readonly?: boolean;
  onChange: (data: Record<string, unknown>) => void;
}

/** Стабильный ключ строки из её ячеек (индекс — для устойчивости к дублям). */
function rowKey(row: LayoutRow, idx: number): string {
  return `${row.map(c => (c.kind === 'field' ? c.field : c.kind === 'component' ? c.component : 'empty')).join('|')}#${idx}`;
}

function cellKey(cell: LayoutCell, idx: number): string {
  return cell.kind === 'field' ? `f:${cell.field}` : cell.kind === 'component' ? `c:${cell.component}` : `e:${idx}`;
}

interface PageData {
  id: string;
  label: string;
  linkTemplate?: string;
  groups: GroupData[];
}

interface DocumentDetail {
  type: { id: string; label: string; creatable: boolean; deletable: boolean };
  pages: PageData[];
  data: DocumentData;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function seedDefaults(pages: PageData[]): DocumentData {
  const seed: DocumentData = {};
  for (const page of pages) {
    for (const group of page.groups) {
      for (const ext of group.extensions) {
        for (const [fieldKey, meta] of Object.entries(ext.fields)) {
          if (meta.default !== undefined) {
            seed[ext.module] ??= {};
            seed[ext.module][ext.key] = { ...(seed[ext.module][ext.key] ?? {}), [fieldKey]: meta.default };
          }
        }
      }
    }
  }
  return seed;
}

/**
 * params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router.
 * Общая и для /admin/:type/create (id отсутствует → isNew), и для /admin/:type/:id.
 */
export function adminDocumentDetailQueryOptions(api: ApiClient, params: Params) {
  const type = params.type ?? '';
  const id = params.id;
  const isNew = !id;
  return {
    queryKey: isNew ? (['admin', 'registry', type] as const) : (['admin', 'document', type, id] as const),
    queryFn: async () => {
      if (isNew) {
        const registry = await api.get<Omit<DocumentDetail, 'data'>>(`/admin/registry/documents/${type}`);
        return { ...registry, data: {} } satisfies DocumentDetail;
      }
      return api.get<DocumentDetail>(`/admin/documents/${type}/${id}`);
    },
  };
}

export function AdminDocumentCard() {
  const { t } = useTranslation('admin');
  const params = useParams<{ type: string; id: string }>();
  const { type, id } = params;
  if (!type) throw new Error('Missing type route parameter');
  const isNew = !id;
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activePage, setActivePage] = useState<string>('');
  const [editData, setEditData] = useState<DocumentData>({});

  const { queryKey, ...docQueryOptions } = adminDocumentDetailQueryOptions(api, params);
  const { data: doc, isLoading, isError, error: queryError, refetch } = useQuery({ queryKey, ...docQueryOptions, enabled: !!type });

  // editData инициализируется из doc, но дальше независимо редактируется — не чистая derived-value,
  // нужен сброс именно при смене doc/isNew. Раньше это был useEffect([doc, isNew]); тот же триггер,
  // но во время рендера — без лишнего кадра со старыми данными между коммитом doc и срабатыванием effect.
  //
  // prevDoc стартует с undefined, а не с doc: route loader делает ensureQueryData до рендера, поэтому
  // на первом рендере useQuery уже отдаёт данные из кэша. С `useState(doc)` первая синхронизация
  // пропускалась — карточка оставалась пустой и сразу считалась dirty.
  const [prevDoc, setPrevDoc] = useState<DocumentDetail | undefined>(undefined);
  const [prevIsNew, setPrevIsNew] = useState(isNew);
  if (doc !== prevDoc || isNew !== prevIsNew) {
    setPrevDoc(doc);
    setPrevIsNew(isNew);
    if (doc) setEditData(isNew ? seedDefaults(doc.pages) : structuredClone(doc.data));
  }

  // Куда уехать после успешного создания. Отдельным состоянием, а не navigate() прямо в onSuccess:
  // useBlocker читает isDirty синхронно в момент навигации, а на create-маршруте doc — это заготовка
  // реестра с пустым data, то есть сразу после сохранения карточка формально ещё dirty. Через
  // состояние переход уходит уже следующим рендером, когда блокер разоружён.
  const [createdRedirect, setCreatedRedirect] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (data: DocumentData) =>
      isNew ? api.post<{ id: string }>(`/admin/documents/${type}`, data) : api.put<{ id: string }>(`/admin/documents/${type}/${id}`, data),
    onSuccess: created => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents', type] });
      if (isNew) {
        // Раньше POST отдавал строку базовой таблицы, и id приходилось выуживать угадайкой
        // (`id ?? login ?? первое попавшееся поле`). Базовой таблицы больше нет — только id.
        setCreatedRedirect(`/admin/${type}/${created.id}`);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  // Сохранённое считается сохранённым: пока идёт переход на карточку созданного документа,
  // расхождение editData с doc-заготовкой — не «несохранённые изменения».
  const isDirty = doc != null && createdRedirect === null && JSON.stringify(editData) !== JSON.stringify(doc.data);
  const blocker = useBlocker(isDirty);
  const creatable = doc?.type.creatable ?? true;

  // Маршруты /create и /:id — сиблинги одного лэйаута с одним и тем же элементом, компонент не
  // размонтируется, поэтому флаг надо снять руками. Признак приезда — isNew, к этому моменту
  // editData уже пересеян из загруженного doc, и dirty-трекинг честно возвращается в работу.
  useEffect(() => {
    if (!createdRedirect) return;
    if (isNew) navigate(createdRedirect, { replace: true });
    else setCreatedRedirect(null);
  }, [createdRedirect, isNew, navigate]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  const canSave = isNew ? creatable && !saveMutation.isPending : isDirty && !saveMutation.isPending;

  const handleSave = () => {
    if (!type || !canSave) return;
    saveMutation.mutate(editData);
  };

  /** Замена бакета extension'а целиком — то, что делает `onChange` component-ячейки. */
  const setExtData = (module: string, key: string, data: Record<string, unknown>) => {
    setEditData(prev => ({ ...prev, [module]: { ...(prev[module] ?? {}), [key]: data } }));
  };

  const updateField = (module: string, key: string, fieldKey: string, value: unknown) => {
    setEditData(prev => ({
      ...prev,
      [module]: { ...(prev[module] ?? {}), [key]: { ...(prev[module]?.[key] ?? {}), [fieldKey]: value } },
    }));
  };

  if (isError) return <QueryError error={queryError} onRetry={refetch} />;
  if (isLoading) return <div className="p-8 text-muted-foreground">{t('core:loading')}</div>;
  if (!doc) return <div className="p-8 text-muted-foreground">{t('core:not_found')}</div>;

  // Пока пользователь не кликнул вкладку — используем первую контентную страницу; чистое derived-значение,
  // без отдельного useEffect для "инициализации" activePage.
  const defaultPage = doc.pages.find(p => !p.linkTemplate) ?? doc.pages[0];
  const activePageId = activePage || defaultPage?.id;
  const currentPage = doc.pages.find(p => p.id === activePageId && !p.linkTemplate) || defaultPage;
  const title = isNew ? t('admin_doc_title_create') : String(id);
  const toolbarActions = getToolbarActions(type);

  return (
    <DocumentCardContext.Provider value={{ documentType: type, documentId: id ?? null, editData, updateField, isNew }}>
      <div className="h-full">
        <div className="w-full max-w-screen-2xl mx-auto flex h-full flex-col px-8 py-4 gap-4">
          <div className="shrink-0 flex flex-col gap-4">
            <AdminBreadcrumbs
              items={[
                { label: t('admin_breadcrumb_root'), to: '/admin' },
                { label: doc.type.label, to: `/admin/${type}` },
                { label: title },
              ]}
            />
            <div className="flex items-center gap-2">
              <Button
                size="lg"
                onClick={handleSave}
                disabled={!canSave}
                title={isNew && !creatable ? t('admin_toolbar_create_disabled') : undefined}
              >
                {saveMutation.isPending ? t('admin_doc_save_pending') : isNew ? t('admin_doc_create') : t('admin_doc_save')}
              </Button>
              {toolbarActions.length > 0 && <Separator orientation="vertical" className="h-6" />}
              {toolbarActions.map(action => {
                const ActionComponent = action.component;
                return <ActionComponent key={action.id} documentType={type} editData={editData} updateField={updateField} isNew={isNew} />;
              })}
            </div>
            {isNew && !creatable && (
              <Alert variant="destructive">
                <AlertTitle>{t('admin_toolbar_create_disabled')}</AlertTitle>
              </Alert>
            )}
            {saveMutation.isError && (
              <Alert variant="destructive">
                <AlertTitle>
                  {saveMutation.error instanceof Error ? saveMutation.error.message : t('admin_doc_save_error_fallback')}
                </AlertTitle>
              </Alert>
            )}
          </div>

          <div className="flex-1 min-h-0 flex gap-8 items-start">
            <nav className="w-56 shrink-0 self-stretch sticky top-0 flex flex-col">
              <ul className="flex flex-col gap-1 grow">
                {doc.pages.map(page =>
                  page.linkTemplate ? (
                    !isNew &&
                    id && (
                      <li key={page.id}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          render={<Link to={page.linkTemplate.replace('{id}', id)} />}
                          nativeButton={false}
                        >
                          {page.label}
                          <SquareArrowOutUpRight className="ml-auto size-3.5 text-muted-foreground" />
                        </Button>
                      </li>
                    )
                  ) : (
                    <li key={page.id}>
                      <Button
                        variant={activePageId === page.id ? 'secondary' : 'ghost'}
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setActivePage(page.id)}
                      >
                        {page.label}
                      </Button>
                    </li>
                  ),
                )}
              </ul>
              {!isNew && (
                <>
                  <Separator className="my-3" />
                  <div className="px-3 mt-auto text-xs text-muted-foreground space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0">{t('admin_doc_created_label')}</span>
                      <span className="text-right">{formatDateTime(doc.createdAt)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0">{t('admin_doc_by_label')}</span>
                      <span className="text-right">{doc.createdBy ?? '—'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0">{t('admin_doc_updated_label')}</span>
                      <span className="text-right">{formatDateTime(doc.updatedAt)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0">{t('admin_doc_by_label')}</span>
                      <span className="text-right">{doc.updatedBy ?? '—'}</span>
                    </div>
                  </div>
                </>
              )}
            </nav>

            <Card className="flex-1 min-w-0 h-full overflow-y-auto">
              <CardContent className="flex flex-col gap-6">
                {currentPage?.groups.map((group, groupIdx) => (
                  <div key={group.id}>
                    {groupIdx > 0 && <Separator className="mb-6" />}
                    <h2 className="text-lg font-semibold mb-4">{group.label}</h2>
                    {group.extensions.map((ext, i) => {
                      const extData = editData[ext.module]?.[ext.key] ?? {};

                      return (
                        <div key={`${ext.module}:${ext.key}`} className="flex flex-col gap-4">
                          {i > 0 && <Separator className="my-4" />}
                          {ext.rows.map((row, rowIdx) => {
                            const total = row.reduce((sum, cell) => sum + cell.span, 0) || 1;
                            return (
                              <div
                                key={rowKey(row, rowIdx)}
                                className="grid gap-4 items-start"
                                style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
                              >
                                {row.map((cell, cellIdx) => {
                                  const style = { gridColumn: `span ${cell.span}` };
                                  const key = cellKey(cell, cellIdx);

                                  if (cell.kind === 'empty') return <div key={key} style={style} aria-hidden />;

                                  if (cell.kind === 'component') {
                                    const CustomComponent = getComponent(cell.component);
                                    return (
                                      <div key={key} style={style}>
                                        {CustomComponent && (
                                          <CustomComponent
                                            key={id ?? 'new'}
                                            data={extData}
                                            fields={ext.fields}
                                            readonly={false}
                                            onChange={(data: Record<string, unknown>) => setExtData(ext.module, ext.key, data)}
                                          />
                                        )}
                                      </div>
                                    );
                                  }

                                  const meta = ext.fields[cell.field];
                                  if (meta?.component) {
                                    const CustomComponent = getComponent(meta.component);
                                    if (CustomComponent) {
                                      return (
                                        <div key={key} style={style}>
                                          <CustomComponent
                                            data={extData}
                                            fields={ext.fields}
                                            readonly={meta.readonly}
                                            onChange={(data: Record<string, unknown>) => setExtData(ext.module, ext.key, data)}
                                          />
                                        </div>
                                      );
                                    }
                                  }
                                  return (
                                    <div key={key} style={style}>
                                      <FieldWidget
                                        fieldKey={cell.field}
                                        meta={meta}
                                        value={extData[cell.field]}
                                        readonly={meta.readonly}
                                        onChange={val => updateField(ext.module, ext.key, cell.field, val)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {blocker.state === 'blocked' && (
        <AlertDialog
          open
          onOpenChange={open => {
            if (!open) blocker.reset();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('admin_doc_unsaved_title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('admin_doc_unsaved_description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant="outline" size="default" onClick={() => blocker.reset()}>
                {t('admin_doc_stay')}
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => blocker.proceed()}>{t('admin_doc_leave')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </DocumentCardContext.Provider>
  );
}
