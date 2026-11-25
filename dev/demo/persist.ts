/** Demo persistence: localStorage when allowed, else window.name (survives reloads of this frame). */
export type DemoState = {
  store?: string;
  reddit?: string;
  offset: number;
  user: string;
  view: { screen: 'feed' | 'game'; postId?: string | undefined };
  toolsOpen?: boolean;
};

const KEY = 'ce_demo_v1';
const fresh = (): DemoState => ({ offset: 0, user: 'you', view: { screen: 'feed' } });

function readRaw(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch {
    /* blocked */
  }
  return window.name.startsWith('{"ce_demo"') ? (JSON.parse(window.name) as { ce_demo: string }).ce_demo : null;
}

export function loadState(): DemoState {
  try {
    const raw = readRaw();
    return raw ? { ...fresh(), ...(JSON.parse(raw) as DemoState) } : fresh();
  } catch {
    return fresh();
  }
}

export function saveState(s: DemoState): void {
  const raw = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* blocked: fall through */
  }
  try {
    window.name = JSON.stringify({ ce_demo: raw });
  } catch {
    /* ignore */
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.name = '';
}
