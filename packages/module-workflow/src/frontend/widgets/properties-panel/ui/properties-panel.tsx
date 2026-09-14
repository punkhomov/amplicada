import { Button } from '@amplicada/platform-core/frontend/ui/button';
import { Input } from '@amplicada/platform-core/frontend/ui/input';
import { Label } from '@amplicada/platform-core/frontend/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@amplicada/platform-core/frontend/ui/select';
import { Switch } from '@amplicada/platform-core/frontend/ui/switch';
import { Textarea } from '@amplicada/platform-core/frontend/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { NodeType, PostEnterHook } from '../../../../contracts/graph.js';
import type { WorkflowDelegatesMeta } from '../../../../contracts/registry.js';
import {
  DEFAULT_ASYNC_TASK_MAX_ATTEMPTS,
  DEFAULT_ASYNC_TASK_RETRY_DELAY_MS,
  DEFAULT_HOOK_MAX_ATTEMPTS,
  DEFAULT_HOOK_RETRY_DELAY_MS,
  type EditorEdge,
  type EditorNode,
} from '../../../lib/graph-mapping.js';
import { ConditionBuilder, type ConditionRow, jsonLogicToRows, rowsToJsonLogic } from '../../condition-builder/index.js';

interface PropertiesPanelProps {
  node?: EditorNode;
  edge?: EditorEdge;
  /** Тип source-ноды выбранного ребра — форма ребра зависит от него. */
  edgeSourceType?: NodeType;
  /** mode source-ноды, если это gateway — для parallel/inclusive форма ребра отличается от exclusive. */
  edgeSourceMode?: 'exclusive' | 'parallel' | 'inclusive';
  meta: WorkflowDelegatesMeta;
  onNodeChange: (id: string, data: Partial<EditorNode['data']>) => void;
  onEdgeChange: (id: string, patch: { label?: string; data?: Partial<NonNullable<EditorEdge['data']>> }) => void;
}

/** JSON-текстовое поле для произвольных params делегата: применяется по мере ввода, битый JSON подсвечивается и не применяется. */
function JsonParamsField({
  label,
  value,
  onApply,
}: {
  label: string;
  value: Record<string, unknown> | undefined;
  onApply: (v: Record<string, unknown> | undefined) => void;
}) {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ''));
  const [invalid, setInvalid] = useState(false);

  // Применяем сразу при вводе, не по blur: blur-вариант терял params, если после ввода
  // сразу кликнуть «Опубликовать» — конфиг публиковался без userId и падал только на submit заявки.
  const apply = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (!trimmed) {
      setInvalid(false);
      onApply(undefined);
      return;
    }
    try {
      onApply(JSON.parse(trimmed) as Record<string, unknown>);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Textarea
        className={`min-h-20 font-mono text-xs ${invalid ? 'border-destructive' : ''}`}
        placeholder='{ "userId": "..." }'
        value={text}
        onChange={e => apply(e.target.value)}
      />
      {invalid && <span className="text-xs text-destructive">Невалидный JSON — не применён</span>}
    </div>
  );
}

/** Список postEnterHooks (userTask/end): провайдер + свои ретраи + JSON-параметры, добавить/удалить по образцу RequestTypeFieldsEditor. */
function HooksEditor({
  node,
  meta,
  onNodeChange,
}: {
  node: EditorNode;
  meta: WorkflowDelegatesMeta;
  onNodeChange: PropertiesPanelProps['onNodeChange'];
}) {
  const hooks = node.data.postEnterHooks ?? [];
  const apply = (next: PostEnterHook[]) => onNodeChange(node.id, { postEnterHooks: next.length ? next : undefined });
  const update = (index: number, patch: Partial<PostEnterHook>) =>
    apply(hooks.map((hook, i) => (i === index ? { ...hook, ...patch } : hook)));

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">Хуки после входа</Label>
      {hooks.map((hook, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: у строк редактора нет стабильного id
        <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Select value={hook.providerId} onValueChange={v => update(i, { providerId: v ?? '' })}>
              <SelectTrigger className="h-8 flex-1 text-sm">
                <SelectValue placeholder="Выберите хук" />
              </SelectTrigger>
              <SelectContent>
                {meta.hook.map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => apply(hooks.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Макс. попыток</Label>
              <Input
                className="h-8 text-sm"
                type="number"
                min={1}
                step={1}
                value={hook.maxAttempts}
                onChange={e => update(i, { maxAttempts: Number(e.target.value) || DEFAULT_HOOK_MAX_ATTEMPTS })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Задержка ретрая (мс)</Label>
              <Input
                className="h-8 text-sm"
                type="number"
                min={0}
                step={1000}
                value={hook.retryDelayMs}
                onChange={e => update(i, { retryDelayMs: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
          <JsonParamsField label="Параметры хука (JSON)" value={hook.params} onApply={v => update(i, { params: v })} />
        </div>
      ))}
      {!meta.hook.length && <span className="text-xs text-muted-foreground">Нет зарегистрированных хуков</span>}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() =>
          apply([...hooks, { providerId: '', maxAttempts: DEFAULT_HOOK_MAX_ATTEMPTS, retryDelayMs: DEFAULT_HOOK_RETRY_DELAY_MS }])
        }
      >
        <Plus className="size-3.5" />
        Добавить хук
      </Button>
      <p className="text-xs text-muted-foreground">
        Асинхронные side-effect'ы после входа в статус (уведомления и т.п.) — не влияют на маршрутизацию, срабатывают при каждом входе.
      </p>
    </div>
  );
}

function NodeForm({
  node,
  meta,
  onNodeChange,
}: {
  node: EditorNode;
  meta: WorkflowDelegatesMeta;
  onNodeChange: PropertiesPanelProps['onNodeChange'];
}) {
  const type = node.type as NodeType;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Название</Label>
        <Input className="h-8 text-sm" value={node.data.label} onChange={e => onNodeChange(node.id, { label: e.target.value })} />
      </div>

      {(type === 'userTask' || type === 'end') && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Код статуса (стабильный, для отчётности)</Label>
          <Input
            className="h-8 text-sm"
            value={node.data.code ?? ''}
            onChange={e => onNodeChange(node.id, { code: e.target.value || undefined })}
          />
          <p className="text-xs text-muted-foreground">В отличие от технического id — не меняется при пересоздании ноды. Опционально.</p>
        </div>
      )}

      {type === 'userTask' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Исполнитель (делегат)</Label>
            <Select
              value={node.data.assigneeProviderId ?? ''}
              onValueChange={v => onNodeChange(node.id, { assigneeProviderId: v ?? undefined })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Выберите делегата" />
              </SelectTrigger>
              <SelectContent>
                {meta.assignee.map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!meta.assignee.length && <span className="text-xs text-muted-foreground">Нет зарегистрированных делегатов исполнителя</span>}
          </div>
          <JsonParamsField
            label="Параметры делегата (JSON)"
            value={node.data.assigneeProviderParams}
            onApply={v => onNodeChange(node.id, { assigneeProviderParams: v })}
          />
          {meta.validator.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Валидаторы (перед любым действием)</Label>
              {meta.validator.map(d => {
                const checked = node.data.validatorIds?.includes(d.id) ?? false;
                return (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={checked}
                      onCheckedChange={on => {
                        const current = node.data.validatorIds ?? [];
                        onNodeChange(node.id, { validatorIds: on ? [...current, d.id] : current.filter(id => id !== d.id) });
                      }}
                    />
                    {d.label}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Редактируемые ключи payload (через запятую)</Label>
            <Input
              className="h-8 text-sm"
              placeholder="cost, description"
              value={(node.data.editableKeys ?? []).join(', ')}
              onChange={e => {
                const keys = e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean);
                onNodeChange(node.id, { editableKeys: keys.length ? keys : undefined });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Ключи payload, которые исполнитель может менять действием на этом шаге. Пусто — менять нельзя ничего.
            </p>
          </div>
        </>
      )}

      {type === 'serviceTask' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Действие (делегат)</Label>
            <Select
              value={node.data.serviceTaskProviderId ?? ''}
              onValueChange={v => onNodeChange(node.id, { serviceTaskProviderId: v ?? undefined })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Выберите делегата" />
              </SelectTrigger>
              <SelectContent>
                {meta.serviceTask.map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!meta.serviceTask.length && <span className="text-xs text-muted-foreground">Нет зарегистрированных делегатов действий</span>}
          </div>
          <JsonParamsField
            label="Параметры делегата (JSON)"
            value={node.data.serviceTaskProviderParams}
            onApply={v => onNodeChange(node.id, { serviceTaskProviderParams: v })}
          />
        </>
      )}

      {type === 'asyncTask' && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Асинхронный делегат</Label>
            <Select
              value={node.data.asyncTaskProviderId ?? ''}
              onValueChange={v => onNodeChange(node.id, { asyncTaskProviderId: v ?? undefined })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Выберите делегата" />
              </SelectTrigger>
              <SelectContent>
                {meta.asyncTask.map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!meta.asyncTask.length && <span className="text-xs text-muted-foreground">Нет зарегистрированных асинхронных делегатов</span>}
          </div>
          <JsonParamsField
            label="Параметры делегата (JSON)"
            value={node.data.asyncTaskProviderParams}
            onApply={v => onNodeChange(node.id, { asyncTaskProviderParams: v })}
          />
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Максимум попыток</Label>
            <Input
              className="h-8 text-sm"
              type="number"
              min={1}
              step={1}
              value={node.data.maxAttempts ?? DEFAULT_ASYNC_TASK_MAX_ATTEMPTS}
              onChange={e => onNodeChange(node.id, { maxAttempts: Number(e.target.value) || DEFAULT_ASYNC_TASK_MAX_ATTEMPTS })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Задержка перед ретраем (мс)</Label>
            <Input
              className="h-8 text-sm"
              type="number"
              min={0}
              step={1000}
              value={node.data.retryDelayMs ?? DEFAULT_ASYNC_TASK_RETRY_DELAY_MS}
              onChange={e => onNodeChange(node.id, { retryDelayMs: Number(e.target.value) || 0 })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Исполняется асинхронно, вне транзакции движка — процесс паркуется на этой ноде до завершения джобы.
          </p>
        </>
      )}

      {type === 'gateway' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Режим</Label>
          <Select
            value={node.data.mode ?? 'exclusive'}
            onValueChange={v => onNodeChange(node.id, { mode: v === 'parallel' || v === 'inclusive' ? v : undefined })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclusive">Exclusive (XOR) — одна ветка</SelectItem>
              <SelectItem value="parallel">Parallel (AND) — все ветки</SelectItem>
              <SelectItem value="inclusive">Inclusive (OR) — совпавшие ветки</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {(node.data.mode ?? 'exclusive') === 'exclusive'
              ? 'Условия задаются на исходящих рёбрах — выберите ребро. Роль (split/join) не важна.'
              : 'Роль (split/join) определяется структурой графа: >1 исходящих рёбер — split, >1 входящих — join. Split обязан сходиться в ровно одном join того же режима.'}
          </p>
        </div>
      )}

      {type === 'end' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Тип завершения</Label>
          <Select
            value={node.data.outcome ?? 'none'}
            onValueChange={v => onNodeChange(node.id, { outcome: v === 'success' || v === 'failure' ? v : undefined })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Нейтральный</SelectItem>
              <SelectItem value="success">Успех (зелёный бейдж)</SelectItem>
              <SelectItem value="failure">Отказ (красный бейдж)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Влияет только на отображение статуса завершённой заявки.</p>
        </div>
      )}

      {(type === 'userTask' || type === 'end') && <HooksEditor node={node} meta={meta} onNodeChange={onNodeChange} />}
    </div>
  );
}

function EdgeForm({
  edge,
  sourceType,
  sourceMode,
  onEdgeChange,
}: {
  edge: EditorEdge;
  sourceType?: NodeType;
  sourceMode?: 'exclusive' | 'parallel' | 'inclusive';
  onEdgeChange: PropertiesPanelProps['onEdgeChange'];
}) {
  const isConditionalGateway = sourceType === 'gateway' && sourceMode !== 'parallel'; // exclusive или inclusive — оба condition+isDefault
  const isParallelGateway = sourceType === 'gateway' && sourceMode === 'parallel';

  // Строки билдера живут в локальном состоянии (компонент пересоздаётся по key={edge.id}), а не
  // выводятся из сохранённого условия: rowsToJsonLogic отбрасывает незаполненные строки, и без
  // локального состояния добавленная «+ Условие (AND)» пустая строка исчезала в тот же рендер.
  // null — условие не представимо плоским AND-списком (read-only JSON ниже).
  const [rows, setRows] = useState<ConditionRow[] | null>(() => (isConditionalGateway ? jsonLogicToRows(edge.data?.condition) : null));

  const changeRows = (next: ConditionRow[]) => {
    setRows(next);
    onEdgeChange(edge.id, { data: { condition: rowsToJsonLogic(next) } });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Подпись ребра</Label>
        <Input
          className="h-8 text-sm"
          value={typeof edge.label === 'string' ? edge.label : ''}
          onChange={e => onEdgeChange(edge.id, { label: e.target.value })}
        />
      </div>

      {sourceType === 'userTask' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Действие (action)</Label>
          <Input
            className="h-8 text-sm"
            placeholder="approve / reject"
            value={edge.data?.action ?? ''}
            onChange={e => onEdgeChange(edge.id, { data: { action: e.target.value || undefined } })}
          />
        </div>
      )}

      {isParallelGateway && (
        <p className="text-xs text-muted-foreground">Parallel-шлюз: условие не нужно — все исходящие ветки активируются всегда.</p>
      )}

      {isConditionalGateway && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={edge.data?.isDefault ?? false}
              onCheckedChange={on => {
                if (on) setRows([]);
                onEdgeChange(edge.id, { data: { isDefault: on || undefined, condition: on ? undefined : edge.data?.condition } });
              }}
            />
            Ветка по умолчанию (default)
          </div>
          {!edge.data?.isDefault &&
            (rows === null ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Условие (сложное, read-only)</Label>
                <pre className="max-h-40 overflow-auto rounded-md border bg-muted p-2 text-xs">
                  {JSON.stringify(edge.data?.condition, null, 2)}
                </pre>
                <p className="text-xs text-muted-foreground">Условие собрано не построителем — редактирование в v1 недоступно.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Условие перехода</Label>
                <ConditionBuilder rows={rows} onChange={changeRows} />
                <p className="text-xs text-muted-foreground">
                  {sourceMode === 'inclusive'
                    ? 'Inclusive: активируются ВСЕ рёбра, чьё условие совпало (не только первое).'
                    : 'Exclusive: активируется первое совпавшее условие, иначе — default.'}
                </p>
              </div>
            ))}
        </>
      )}

      {sourceType !== 'userTask' && sourceType !== 'gateway' && (
        <p className="text-xs text-muted-foreground">У этого ребра нет настроек — переход выполняется автоматически.</p>
      )}
    </div>
  );
}

export function PropertiesPanel({ node, edge, edgeSourceType, edgeSourceMode, meta, onNodeChange, onEdgeChange }: PropertiesPanelProps) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Свойства</div>
      {node && <NodeForm key={node.id} node={node} meta={meta} onNodeChange={onNodeChange} />}
      {!node && edge && (
        <EdgeForm key={edge.id} edge={edge} sourceType={edgeSourceType} sourceMode={edgeSourceMode} onEdgeChange={onEdgeChange} />
      )}
      {!node && !edge && <p className="text-sm text-muted-foreground">Выберите ноду или ребро на холсте.</p>}
    </div>
  );
}
