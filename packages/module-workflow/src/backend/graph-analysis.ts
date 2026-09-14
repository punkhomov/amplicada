import type { GatewayNode, WorkflowEdge, WorkflowNode, WorkflowVersionConfig } from '../contracts/graph.js';

export interface ParallelBlockResult {
  /** null, если ветки split не сходятся ни в одном узле (см. errors) или граф некорректен структурно. */
  joinNodeId: string | null;
  errors: string[];
}

function buildEdgeIndex(config: WorkflowVersionConfig) {
  const outgoingByNode = new Map<string, WorkflowEdge[]>();
  const incomingCountByNode = new Map<string, number>();
  for (const edge of config.edges) {
    const list = outgoingByNode.get(edge.source) ?? [];
    list.push(edge);
    outgoingByNode.set(edge.source, list);
    incomingCountByNode.set(edge.target, (incomingCountByNode.get(edge.target) ?? 0) + 1);
  }
  return { outgoingByNode, incomingCountByNode };
}

/**
 * Разрешает пару split→join для parallel/inclusive gateway `split` (см. «Обязательная структурная
 * парность split/join» в ref/plans/2026-07-22-workflow-parallel-gateway.md). Используется дважды:
 * validation.ts — при публикации, чтобы отклонить неправильно спроектированный граф; engine.ts — в
 * рантайме форка, чтобы узнать, в каком узле создавать fork-bookkeeping запись (join уже гарантирован
 * единственным и корректным — публикация без ошибок здесь means граф уже прошёл эту же проверку).
 *
 * pathStack — предки ТЕКУЩЕГО пути обхода (для детекции циклов), НЕ "посещено когда-либо": ромбовидное
 * схождение двух веток в одном узле до join — легитимный DAG, не цикл. memo — кэш результата по
 * nodeId, общий между сиблингами одного split (результат не зависит от того, через какую ветвь пришли).
 */
export function resolveParallelBlock(config: WorkflowVersionConfig, split: GatewayNode): ParallelBlockResult {
  const errors: string[] = [];
  const nodeById = new Map(config.nodes.map(n => [n.id, n]));
  const { outgoingByNode, incomingCountByNode } = buildEdgeIndex(config);
  const memo = new Map<string, WorkflowNode | null>();

  const isJoinCandidate = (node: WorkflowNode): boolean =>
    node.type === 'gateway' && (node as GatewayNode).mode === split.mode && (incomingCountByNode.get(node.id) ?? 0) > 1;

  const isNestedSplit = (node: WorkflowNode): node is GatewayNode =>
    node.type === 'gateway' &&
    !!(node as GatewayNode).mode &&
    (node as GatewayNode).mode !== 'exclusive' &&
    node.id !== split.id &&
    (outgoingByNode.get(node.id)?.length ?? 0) > 1;

  function walk(nodeId: string, pathStack: string[]): WorkflowNode | null {
    if (memo.has(nodeId)) return memo.get(nodeId) ?? null;
    if (pathStack.includes(nodeId)) {
      errors.push(`Цикл внутри parallel/inclusive-блока (split "${split.id}") через ноду "${nodeId}" — запрещено`);
      memo.set(nodeId, null);
      return null;
    }

    const node = nodeById.get(nodeId);
    if (!node) {
      memo.set(nodeId, null);
      return null; // ссылка на несуществующую ноду — сообщается базовой валидацией формы, не здесь
    }

    let result: WorkflowNode | null;
    if (node.type === 'end') {
      errors.push(`Ветка split "${split.id}" завершается на "${nodeId}" до синхронизации на join — недопустимо`);
      result = null;
    } else if (isJoinCandidate(node)) {
      result = node;
    } else if (isNestedSplit(node)) {
      const nested = resolveParallelBlock(config, node);
      errors.push(...nested.errors);
      result = nested.joinNodeId ? walk(nested.joinNodeId, [...pathStack, nodeId]) : null;
    } else {
      const outs = outgoingByNode.get(nodeId) ?? [];
      const exits = outs.map(e => walk(e.target, [...pathStack, nodeId]));
      const resolved = exits.filter((e): e is WorkflowNode => e !== null);
      if (!resolved.length) {
        result = null; // тупик или ошибка глубже — уже сообщена
      } else if (resolved.every(e => e.id === resolved[0].id)) {
        result = resolved[0];
      } else {
        errors.push(`Пути из ноды "${nodeId}" (в ветке split "${split.id}") расходятся к разным точкам синхронизации`);
        result = null;
      }
    }
    memo.set(nodeId, result);
    return result;
  }

  let joinCandidate: WorkflowNode | null = null;
  for (const edge of outgoingByNode.get(split.id) ?? []) {
    const exit = walk(edge.target, [split.id]);
    if (!exit) continue;
    if (!joinCandidate) joinCandidate = exit;
    else if (exit.id !== joinCandidate.id) {
      errors.push(`Ветки split "${split.id}" сходятся в разных узлах ("${joinCandidate.id}" и "${exit.id}")`);
    }
  }

  if (joinCandidate) {
    const incoming = incomingCountByNode.get(joinCandidate.id) ?? 0;
    const outgoingCount = (outgoingByNode.get(split.id) ?? []).length;
    if (incoming !== outgoingCount) {
      errors.push(
        `Join "${joinCandidate.id}" ждёт рёбер: ${incoming}, а split "${split.id}" породил веток: ${outgoingCount} — несовпадение`,
      );
    }
  }

  return { joinNodeId: joinCandidate?.id ?? null, errors: [...new Set(errors)] };
}
