import type { FilterCombinator, FilterCondition, FilterTree, ListFieldMeta } from '@amplicada/platform-core/contracts';
import { useTranslation } from '@amplicada/platform-core/frontend';
import { Alert, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@amplicada/platform-core/frontend/ui/dialog';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { type ColumnEntry, type DraftItem, type DraftState, draftToTree, makeDraftCondition, treeToDraft } from '../lib/draft.js';
import { FilterCombinatorCell } from './filter-combinator-cell.js';
import { FilterConditionRow } from './filter-condition-row.js';

export interface AdminFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Record<string, ListFieldMeta>;
  filters: FilterTree;
  onApply: (filters: FilterTree) => void;
  onReset: () => void;
}

export function AdminFilterDialog({ open, onOpenChange, columns, filters, onApply, onReset }: AdminFilterDialogProps) {
  const { t } = useTranslation('admin');
  const [draft, setDraft] = useState<DraftState>(() => treeToDraft(filters).draft);
  const [flattened, setFlattened] = useState(false);

  // Диалог не размонтируется при закрытии (Base UI прячет DOM, компонент живёт дальше), поэтому
  // драфт нужно сбрасывать явно. Сравнение прошлого open во время рендера вместо useEffect —
  // та же семантика без лишнего кадра со старым драфтом.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const next = treeToDraft(filters);
      setDraft(next.draft);
      setFlattened(next.flattened);
    }
  }

  const filterableColumns: ColumnEntry[] = Object.entries(columns).filter(([, meta]) => meta.filterable !== false);

  const updateItem = (id: string, update: (item: DraftItem) => DraftItem) => {
    setDraft(prev => ({ ...prev, items: prev.items.map(item => (item.id === id ? update(item) : item)) }));
  };

  const removeItem = (id: string) => setDraft(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));

  const addCondition = () => {
    setDraft(prev => ({ ...prev, items: [...prev.items, { ...makeDraftCondition(filterableColumns), kind: 'condition' }] }));
  };

  const addGroup = () => {
    setDraft(prev => ({
      ...prev,
      items: [
        ...prev.items,
        // Новая группа сразу с одним условием: пустая группа ни на что не влияет и только путает.
        { id: crypto.randomUUID(), kind: 'group', combinator: 'or', children: [makeDraftCondition(filterableColumns)] },
      ],
    }));
  };

  const setCombinator = (combinator: FilterCombinator) => setDraft(prev => ({ ...prev, combinator }));

  const handleApply = () => {
    onApply(draftToTree(draft));
    onOpenChange(false);
  };

  const handleReset = () => {
    onReset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('admin_toolbar_filters')}</DialogTitle>
        </DialogHeader>

        {flattened && (
          <Alert variant="destructive">
            <AlertTitle>{t('admin_filter_flattened_warning')}</AlertTitle>
          </Alert>
        )}

        <div className="-m-1 flex max-h-[28rem] flex-col gap-2 overflow-y-auto p-1">
          {draft.items.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_filter_none')}</p>}

          {draft.items.map((item, index) => (
            <div key={item.id} className="flex items-start gap-2">
              <FilterCombinatorCell index={index} combinator={draft.combinator} onChange={setCombinator} />

              {item.kind === 'condition' ? (
                <div className="min-w-0 flex-1">
                  <FilterConditionRow
                    condition={item.condition}
                    columns={filterableColumns}
                    onChange={next => updateItem(item.id, i => (i.kind === 'condition' ? { ...i, condition: next } : i))}
                    onRemove={() => removeItem(item.id)}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1 rounded-md border border-l-2 border-l-primary/40 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t('admin_filter_group')}</span>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeItem(item.id)} title={t('admin_filter_remove_group')}>
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {item.children.map((child, childIndex) => (
                      <div key={child.id} className="flex items-start gap-2">
                        <FilterCombinatorCell
                          index={childIndex}
                          combinator={item.combinator}
                          onChange={combinator => updateItem(item.id, i => (i.kind === 'group' ? { ...i, combinator } : i))}
                        />
                        <div className="min-w-0 flex-1">
                          <FilterConditionRow
                            condition={child.condition}
                            columns={filterableColumns}
                            onChange={next =>
                              updateItem(item.id, i =>
                                i.kind === 'group'
                                  ? { ...i, children: i.children.map(c => (c.id === child.id ? { ...c, condition: next } : c)) }
                                  : i,
                              )
                            }
                            onRemove={() =>
                              updateItem(item.id, i =>
                                i.kind === 'group' ? { ...i, children: i.children.filter(c => c.id !== child.id) } : i,
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      disabled={filterableColumns.length === 0}
                      onClick={() =>
                        updateItem(item.id, i =>
                          i.kind === 'group' ? { ...i, children: [...i.children, makeDraftCondition(filterableColumns)] } : i,
                        )
                      }
                    >
                      <Plus className="size-4" />
                      {t('admin_filter_add')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addCondition} disabled={filterableColumns.length === 0}>
            <Plus className="size-4" />
            {t('admin_filter_add')}
          </Button>
          {/* Группы добавляются только на верхнем уровне — вложенность ограничена одним уровнем. */}
          <Button variant="outline" size="sm" onClick={addGroup} disabled={filterableColumns.length === 0}>
            <Plus className="size-4" />
            {t('admin_filter_add_group')}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            {t('admin_filter_reset')}
          </Button>
          <Button onClick={handleApply}>{t('admin_filter_apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { FilterCondition };
