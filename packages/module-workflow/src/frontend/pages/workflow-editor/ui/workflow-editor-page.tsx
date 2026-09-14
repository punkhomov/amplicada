import { type ApiClient, QueryError, useApiClient, useMutation, useQuery, useQueryClient } from '@amplicada/platform-core/frontend';
import { Alert, AlertDescription, AlertTitle } from '@amplicada/platform-core/frontend/ui/alert';
import { Badge } from '@amplicada/platform-core/frontend/ui/badge';
import { Button } from '@amplicada/platform-core/frontend/ui/button';
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { AlertTriangle, Upload } from 'lucide-react';
import { type DragEvent, useCallback, useMemo, useState } from 'react';
import { type Params, useParams } from 'react-router-dom';
import type { NodeType, WorkflowVersionConfig } from '../../../../contracts/graph.js';
import type { WorkflowDelegatesMeta } from '../../../../contracts/registry.js';
import {
  configToFlow,
  type EditorEdge,
  type EditorNode,
  edgeCaption,
  emptyStartEndTemplate,
  flowToConfig,
  withGatewayEdgeOrder,
} from '../../../lib/graph-mapping.js';
import { NodePalette, PALETTE_DRAG_TYPE } from '../../../widgets/node-palette/index.js';
import { PropertiesPanel } from '../../../widgets/properties-panel/index.js';
import { workflowNodeTypes } from '../../../widgets/workflow-node-types/index.js';

interface WorkflowVersionDto {
  id: string;
  versionNumber: number;
  config: WorkflowVersionConfig;
  createdAt: string;
}

const NODE_DEFAULT_LABEL: Record<NodeType, string> = {
  start: 'Начало',
  end: 'Конец',
  userTask: 'Новая задача',
  gateway: 'Шлюз',
  serviceTask: 'Автодействие',
  asyncTask: 'Асинхронное автодействие',
};

const EMPTY_META: WorkflowDelegatesMeta = { assignee: [], validator: [], serviceTask: [], asyncTask: [], hook: [] };

const DELETE_KEY_CODES = ['Backspace', 'Delete'];
const PRO_OPTIONS = { hideAttribution: true };

function EditorCanvas({
  workflowId,
  initial,
  latestVersion,
  meta,
}: {
  workflowId: string;
  initial: WorkflowVersionConfig;
  latestVersion: number;
  meta: WorkflowDelegatesMeta;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow();

  const initialFlow = useMemo(() => configToFlow(initial), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initialFlow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(initialFlow.edges);
  const [selection, setSelection] = useState<{ nodeId?: string; edgeId?: string }>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const publishMutation = useMutation({
    mutationFn: (config: WorkflowVersionConfig) =>
      api.post<WorkflowVersionDto>(`/workflows/admin/workflows/${workflowId}/publish`, { config }),
    onSuccess: () => {
      setValidationErrors([]);
      queryClient.invalidateQueries({ queryKey: ['workflows', workflowId, 'versions'] });
    },
    onError: (err: unknown) => {
      const data = (err as { data?: { errors?: string[]; error?: string } }).data;
      setValidationErrors(data?.errors ?? [data?.error ?? (err as Error).message]);
    },
  });

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds => addEdge<EditorEdge>({ ...connection, data: {} }, eds));
    },
    [setEdges],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(PALETTE_DRAG_TYPE) as NodeType | '';
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const node: EditorNode = {
        id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
        type,
        position,
        data: { label: NODE_DEFAULT_LABEL[type] },
      };
      setNodes(nds => [...nds, node]);
    },
    [screenToFlowPosition, setNodes],
  );

  // Стабильная ссылка + идемпотентный setState обязательны: SelectionListenerInner в @xyflow/react
  // держит onSelectionChange в deps своего useEffect — инлайн-колбэк с безусловным setSelection
  // давал бесконечную петлю ререндеров (рендер → новая ссылка → эффект → setState → рендер).
  const onSelectionChange = useCallback(({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
    const nodeId = selNodes[0]?.id;
    const edgeId = selEdges[0]?.id;
    setSelection(prev => (prev.nodeId === nodeId && prev.edgeId === edgeId ? prev : { nodeId, edgeId }));
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Только для рендера: номер приоритета перед подписью не-default ребра gateway, в порядке
  // pickGatewayEdge — не трогает edges-state (иначе номер утёк бы в WorkflowEdge.label при публикации).
  const renderEdges = useMemo(() => withGatewayEdgeOrder(edges, nodes), [edges, nodes]);

  const selectedNode = nodes.find(n => n.id === selection.nodeId);
  const selectedEdge = edges.find(e => e.id === selection.edgeId);
  const edgeSourceNode = selectedEdge ? nodes.find(n => n.id === selectedEdge.source) : undefined;
  const edgeSourceType = edgeSourceNode?.type as NodeType | undefined;
  const edgeSourceMode = edgeSourceNode?.data.mode;

  const onNodeDataChange = useCallback(
    (id: string, patch: Partial<EditorNode['data']>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes],
  );

  const onEdgePatch = useCallback(
    (id: string, patch: { label?: string; data?: Partial<NonNullable<EditorEdge['data']>> }) => {
      setEdges(eds =>
        eds.map(e => {
          if (e.id !== id) return e;
          const data = { ...e.data, ...patch.data };
          const label = patch.label !== undefined ? patch.label : typeof e.label === 'string' ? e.label : undefined;
          return { ...e, data, label: label || edgeCaption({ label: undefined, ...data }) };
        }),
      );
    },
    [setEdges],
  );

  return (
    <div className="flex flex-1 min-h-0">
      <NodePalette />
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={renderEdges}
          nodeTypes={workflowNodeTypes}
          onNodesChange={onNodesChange as (changes: NodeChange<EditorNode>[]) => void}
          onEdgesChange={onEdgesChange as (changes: EdgeChange<EditorEdge>[]) => void}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onSelectionChange={onSelectionChange}
          fitView
          deleteKeyCode={DELETE_KEY_CODES}
          proOptions={PRO_OPTIONS}
        >
          <Background />
          <Controls />
        </ReactFlow>

        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <Badge variant="outline">{latestVersion ? `Опубликована v${latestVersion}` : 'Нет опубликованных версий'}</Badge>
          <Button size="sm" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate(flowToConfig(nodes, edges))}>
            <Upload />
            Опубликовать v{latestVersion + 1}
          </Button>
        </div>

        {validationErrors.length > 0 && (
          <Alert variant="destructive" className="absolute bottom-3 left-3 right-3 z-10 max-h-48 overflow-auto">
            <AlertTriangle className="size-4" />
            <AlertTitle>Публикация отклонена</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 text-xs">
                {validationErrors.map(error => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
      <PropertiesPanel
        node={selectedNode}
        edge={selectedEdge}
        edgeSourceType={edgeSourceType}
        edgeSourceMode={edgeSourceMode}
        meta={meta}
        onNodeChange={onNodeDataChange}
        onEdgeChange={onEdgePatch}
      />
    </div>
  );
}

/** params — тот же объект, что возвращает useParams() в компоненте и loader получает от react-router. */
export function workflowVersionsQueryOptions(api: ApiClient, params: Params) {
  const workflowId = params.id ?? '';
  return {
    queryKey: ['workflows', workflowId, 'versions'] as const,
    queryFn: () => api.get<WorkflowVersionDto[]>(`/workflows/admin/workflows/${workflowId}/versions`),
  };
}

export function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const api = useApiClient();

  const {
    data: versions,
    isLoading: versionsLoading,
    isError: versionsError,
    error: versionsErrorObj,
    refetch: refetchVersions,
  } = useQuery({ ...workflowVersionsQueryOptions(api, params), enabled: !!id });

  const { data: meta } = useQuery({
    queryKey: ['workflows', 'builder-meta'],
    queryFn: () => api.get<WorkflowDelegatesMeta>('/workflows/admin/builder/meta'),
  });

  if (!id) return null;
  if (versionsError) return <QueryError error={versionsErrorObj} onRetry={refetchVersions} />;
  if (versionsLoading) return <div className="p-8 text-muted-foreground">Загрузка...</div>;

  const latest = versions?.at(-1);
  // Черновик живёт только в состоянии React Flow до нажатия «Опубликовать» (решение v1) —
  // перезагрузка страницы теряет несохранённые правки.
  const initial = latest?.config ?? emptyStartEndTemplate();

  return (
    <div className="flex h-full flex-col">
      <ReactFlowProvider>
        <EditorCanvas
          key={latest?.id ?? 'empty'}
          workflowId={id}
          initial={initial}
          latestVersion={latest?.versionNumber ?? 0}
          meta={meta ?? EMPTY_META}
        />
      </ReactFlowProvider>
    </div>
  );
}
