import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bindPlatformSessionTab,
  clearPlatformSessionIfTabRemoved,
  getPlatformSessionTab,
  isPlatformLoggedInTab,
  resolvePlatformTabForTask,
  shouldSkipNavigationOnReuse,
} from '@/core/storage/platform-session';

type ChromeGlobal = typeof globalThis & {
  chrome: {
    storage: { local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
    tabs: {
      get: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
    };
  };
};

const SOHU_DASHBOARD = 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page';
const SOHU_EDITOR = 'https://mp.sohu.com/mpfe/v4/contentManagement/addarticle/addarticle';
const SOHU_PASSPORT = 'https://passport.sohu.com/login';

beforeEach(() => {
  vi.clearAllMocks();
  const store: Record<string, unknown> = {};
  const g = globalThis as ChromeGlobal;
  g.chrome.storage.local.get = vi.fn(async (key: string) => ({ [key]: store[key] }));
  g.chrome.storage.local.set = vi.fn(async (payload: Record<string, unknown>) => {
    Object.assign(store, payload);
  });
  g.chrome.tabs.get = vi.fn();
  g.chrome.tabs.query = vi.fn(async () => []);
});

describe('isPlatformLoggedInTab', () => {
  it('搜狐后台非 passport 视为已登录', () => {
    expect(isPlatformLoggedInTab('sohu', SOHU_DASHBOARD)).toBe(true);
    expect(isPlatformLoggedInTab('sohu', SOHU_PASSPORT)).toBe(false);
  });

  it('小红书创作者中心视为已登录', () => {
    expect(isPlatformLoggedInTab('xiaohongshu', 'https://creator.xiaohongshu.com/publish/publish')).toBe(
      true,
    );
    expect(isPlatformLoggedInTab('xiaohongshu', 'https://creator.xiaohongshu.com/login')).toBe(false);
  });
});

describe('shouldSkipNavigationOnReuse', () => {
  it('搜狐已在后台时不应因 dashboard 目标强制导航', () => {
    expect(shouldSkipNavigationOnReuse(SOHU_EDITOR, SOHU_DASHBOARD, 'sohu')).toBe(true);
  });

  it('passport 页不应跳过导航', () => {
    expect(shouldSkipNavigationOnReuse(SOHU_PASSPORT, SOHU_DASHBOARD, 'sohu')).toBe(false);
  });
});

describe('platform session store', () => {
  it('getPlatformSessionTab 在 tab 仍有效时返回 id', async () => {
    await bindPlatformSessionTab('sohu', 42);
    (globalThis as ChromeGlobal).chrome.tabs.get = vi.fn(async () => ({
      id: 42,
      url: SOHU_DASHBOARD,
    }));
    await expect(getPlatformSessionTab('sohu')).resolves.toBe(42);
  });

  it('标签关闭后 clearPlatformSessionIfTabRemoved 清除记录', async () => {
    await bindPlatformSessionTab('sohu', 99);
    await clearPlatformSessionIfTabRemoved(99);
    (globalThis as ChromeGlobal).chrome.tabs.get = vi.fn(async () => {
      throw new Error('No tab');
    });
    await expect(getPlatformSessionTab('sohu')).resolves.toBeUndefined();
  });

  it('resolvePlatformTabForTask 优先使用持久化 tab', async () => {
    await bindPlatformSessionTab('sohu', 7);
    (globalThis as ChromeGlobal).chrome.tabs.get = vi.fn(async () => ({
      id: 7,
      url: SOHU_DASHBOARD,
    }));
    await expect(resolvePlatformTabForTask('sohu')).resolves.toBe(7);
  });
});
