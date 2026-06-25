import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openTab } from '@/core/executor/tab-manager';

type ChromeGlobal = typeof globalThis & {
  chrome: {
    storage: { local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
    tabs: {
      query: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      onUpdated: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    };
  };
};

const SOHU_DASHBOARD = 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page';
const SOHU_EDITOR = 'https://mp.sohu.com/mpfe/v4/contentManagement/addarticle/addarticle';

beforeEach(() => {
  vi.clearAllMocks();
  const store: Record<string, unknown> = {};
  const g = globalThis as ChromeGlobal;
  g.chrome.storage.local.get = vi.fn(async (key: string) => ({ [key]: store[key] }));
  g.chrome.storage.local.set = vi.fn(async (payload: Record<string, unknown>) => {
    Object.assign(store, payload);
  });
  g.chrome.tabs.onUpdated = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  g.chrome.tabs.update = vi.fn(async () => ({}));
  g.chrome.tabs.create = vi.fn(async () => ({ id: 999 }));
  g.chrome.tabs.get = vi.fn(async (id: number) => ({
    id,
    url: SOHU_EDITOR,
    status: 'complete',
    windowId: 1,
  }));
});

describe('openTab platform reuse', () => {
  it('已有搜狐后台 tab 时不应 create 新标签，且复用时跳过 url 导航', async () => {
    const g = globalThis as ChromeGlobal;
    g.chrome.tabs.query = vi.fn(async () => [
      { id: 12, url: SOHU_EDITOR, active: false },
    ]);

    const tabId = await openTab(SOHU_DASHBOARD, { platform: 'sohu' });

    expect(tabId).toBe(12);
    expect(g.chrome.tabs.create).not.toHaveBeenCalled();
    expect(g.chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(g.chrome.tabs.update).not.toHaveBeenCalledWith(
      12,
      expect.objectContaining({ url: SOHU_DASHBOARD }),
    );
  });

  it('无复用 tab 时才 create', async () => {
    const g = globalThis as ChromeGlobal;
    g.chrome.tabs.query = vi.fn(async () => []);

    const tabId = await openTab(SOHU_DASHBOARD, { platform: 'sohu' });

    expect(tabId).toBe(999);
    expect(g.chrome.tabs.create).toHaveBeenCalledWith({ url: SOHU_DASHBOARD, active: true });
  });
});
