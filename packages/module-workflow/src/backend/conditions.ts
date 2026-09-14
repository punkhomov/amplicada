import type { JsonLogicRule } from '../contracts/graph.js';
import type { DelegateContext } from '../contracts/registry.js';

/**
 * Самописный эвалуатор JSONLogic-совместимого подмножества вместо json-logic-js:
 * формат хранения полностью совместим с JSONLogic (усложнение UI позже не потребует миграции),
 * но кода — ~80 строк без новой зависимости (план 02 допускал оба варианта, ADR-02: explicit code).
 *
 * Поддерживаемые операторы: var, ==, !=, ===, !==, >, >=, <, <=, in, and, or, !, !!.
 */

const SUPPORTED_OPERATORS = new Set(['var', '==', '!=', '===', '!==', '>', '>=', '<', '<=', 'in', 'and', 'or', '!', '!!']);

type Data = Record<string, unknown>;

function resolveVar(path: unknown, data: Data): unknown {
  if (typeof path !== 'string' || path === '') return undefined;
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Data)[segment];
  }
  return current;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

// biome-ignore lint/suspicious/noExplicitAny: значения условий приходят из произвольного payload
function looseEq(a: any, b: any): boolean {
  // biome-ignore lint/suspicious/noDoubleEquals: '==' в JSONLogic — намеренно нестрогое сравнение
  return a == b;
}

function evaluate(rule: unknown, data: Data): unknown {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return rule;

  const entries = Object.entries(rule as Data);
  if (entries.length !== 1) {
    throw new Error(`Условие должно содержать ровно один оператор, получено: ${entries.map(([k]) => k).join(', ')}`);
  }
  const [operator, rawArgs] = entries[0];
  if (!SUPPORTED_OPERATORS.has(operator)) {
    throw new Error(`Неподдерживаемый оператор условия: "${operator}"`);
  }

  if (operator === 'var') {
    return resolveVar(Array.isArray(rawArgs) ? rawArgs[0] : rawArgs, data);
  }

  const args = toArray(rawArgs).map(arg => evaluate(arg, data));

  switch (operator) {
    case '==':
      return looseEq(args[0], args[1]);
    case '!=':
      return !looseEq(args[0], args[1]);
    case '===':
      return args[0] === args[1];
    case '!==':
      return args[0] !== args[1];
    case '>':
      return (args[0] as number) > (args[1] as number);
    case '>=':
      return (args[0] as number) >= (args[1] as number);
    case '<':
      return (args[0] as number) < (args[1] as number);
    case '<=':
      return (args[0] as number) <= (args[1] as number);
    case 'in':
      if (Array.isArray(args[1])) return args[1].some(item => looseEq(item, args[0]));
      if (typeof args[1] === 'string') return args[1].includes(String(args[0]));
      return false;
    case 'and':
      return args.every(Boolean);
    case 'or':
      return args.some(Boolean);
    case '!':
      return !args[0];
    case '!!':
      return Boolean(args[0]);
    default:
      return false;
  }
}

export function evaluateCondition(rule: JsonLogicRule, ctx: DelegateContext): boolean {
  return Boolean(evaluate(rule, { payload: ctx.payload, context: ctx.context }));
}

/** Структурная проверка дерева условия для validateWorkflowConfig — без вычисления. */
export function validateConditionRule(rule: unknown, path: string, errors: string[]): void {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    errors.push(`${path}: условие должно быть объектом с одним оператором`);
    return;
  }
  const entries = Object.entries(rule as Data);
  if (entries.length !== 1) {
    errors.push(`${path}: условие должно содержать ровно один оператор, получено ${entries.length}`);
    return;
  }
  const [operator, rawArgs] = entries[0];
  if (!SUPPORTED_OPERATORS.has(operator)) {
    errors.push(`${path}: неподдерживаемый оператор "${operator}"`);
    return;
  }
  if (operator === 'var') return;
  for (const [i, arg] of toArray(rawArgs).entries()) {
    if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
      validateConditionRule(arg, `${path}[${i}]`, errors);
    }
  }
}
