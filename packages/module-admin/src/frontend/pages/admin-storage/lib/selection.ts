export interface SelectionState {
  keys: string[];
  anchor: string | null;
}

export type SelectionAction =
  | { type: 'click'; key: string; additive: boolean; range: boolean; visible: string[] }
  | { type: 'check'; key: string; checked: boolean }
  | { type: 'checkAll'; keys: string[]; checked: boolean }
  | { type: 'clear' }
  | { type: 'sync'; visible: string[] };

type ClickAction = Extract<SelectionAction, { type: 'click' }>;

/**
 * Выбор строк списка. Видимые ключи приходят в действиях, а не лежат в состоянии: их набор меняется
 * вместе с папкой и поиском, и копия в состоянии — это лишний источник рассинхрона.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return click(state, action);
    case 'check': {
      const has = state.keys.includes(action.key);
      if (action.checked === has) return state;
      const keys = action.checked ? [...state.keys, action.key] : state.keys.filter(key => key !== action.key);
      // Якорь — последнее действие: за чекбоксом обычно следует Shift-клик по диапазону.
      return { keys, anchor: action.key };
    }
    case 'checkAll': {
      if (action.checked) {
        const missing = action.keys.filter(key => !state.keys.includes(key));
        return missing.length ? { keys: [...state.keys, ...missing], anchor: state.anchor } : state;
      }
      const drop = new Set(action.keys);
      const keys = state.keys.filter(key => !drop.has(key));
      return keys.length === state.keys.length ? state : { keys, anchor: state.anchor };
    }
    case 'clear':
      return state.keys.length === 0 && state.anchor === null ? state : { keys: [], anchor: null };
    case 'sync': {
      const visible = new Set(action.visible);
      const keys = state.keys.filter(key => visible.has(key));
      const anchor = state.anchor !== null && visible.has(state.anchor) ? state.anchor : null;
      // Ссылку сохраняем, когда ничего не изменилось: `sync` может вызываться на каждый рендер.
      if (keys.length === state.keys.length && anchor === state.anchor) return state;
      return { keys, anchor };
    }
  }
}

function click(state: SelectionState, action: ClickAction): SelectionState {
  if (action.range && state.anchor !== null) {
    const from = action.visible.indexOf(state.anchor);
    const to = action.visible.indexOf(action.key);
    // Якорь мог исчезнуть из вида (сменилась папка, включился поиск) — тогда диапазон не построить.
    if (from !== -1 && to !== -1) {
      const range = action.visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      if (!action.additive) return { keys: range, anchor: state.anchor };
      const extra = range.filter(key => !state.keys.includes(key));
      // Диапазон дополняет выбор, но якорь не двигаем: иначе следующий Shift-клик начнётся с конца.
      return extra.length ? { keys: [...state.keys, ...extra], anchor: state.anchor } : state;
    }
  }
  if (!action.additive) return { keys: [action.key], anchor: action.key };
  const keys = state.keys.includes(action.key) ? state.keys.filter(key => key !== action.key) : [...state.keys, action.key];
  return { keys, anchor: action.key };
}
