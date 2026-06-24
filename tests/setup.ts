import { vi, beforeEach } from 'vitest';

// 测试环境通用的 chrome API mock。
// 各用例可在自己内部覆盖具体方法的实现。

interface TabRecord {
  id: number;
  url: string;
  windowId: number;
  status: string;
}

const state: { tabs: Map<number, TabRecord>; nextId: number } = {
  tabs: new Map(),
  nextId: 1,
};

function makeChromeMock() {
  return {
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      openOptionsPage: vi.fn(),
      lastError: undefined,
    },
    tabs: {
      query: vi.fn(async () => Array.from(state.tabs.values())),
      create: vi.fn(async ({ url }: { url: string }) => {
        const id = state.nextId++;
        const tab: TabRecord = { id, url, windowId: 100, status: 'complete' };
        state.tabs.set(id, tab);
        return tab;
      }),
      get: vi.fn(async (id: number) => {
        return state.tabs.get(id) ?? { id, url: '', windowId: 100, status: 'complete' };
      }),
      update: vi.fn(async (id: number, props: { url?: string }) => {
        const tab = state.tabs.get(id);
        if (tab && props.url) tab.url = props.url;
        return tab;
      }),
      sendMessage: vi.fn(async () => ({ ok: true, data: { success: true } })),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
    },
  };
}

// 注入到全局
(globalThis as unknown as { chrome: ReturnType<typeof makeChromeMock> }).chrome =
  makeChromeMock();

beforeEach(() => {
  state.tabs.clear();
  state.nextId = 1;
  (globalThis as unknown as { chrome: ReturnType<typeof makeChromeMock> }).chrome =
    makeChromeMock();
});
