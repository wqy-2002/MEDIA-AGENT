import { isSohuBackendUrl } from '@/adapters/sohu/readiness';
import type { PlatformName } from '@/types';

const STORAGE_KEY = 'mediaflow_platform_tabs';

interface PlatformTabEntry {
  tabId: number;
  platform: PlatformName;
  updatedAt: number;
}

type PlatformTabStore = Partial<Record<PlatformName, PlatformTabEntry>>;

/** 判断标签页是否处于已登录的平台后台（非 passport / login 页） */
export function isPlatformLoggedInTab(platform: PlatformName, url: string | undefined): boolean {
  if (!url || /^chrome:/.test(url)) return false;
  try {
    if (platform === 'sohu') {
      return isSohuBackendUrl(url) && !/passport\.sohu\.com/i.test(url);
    }
    if (platform === 'xiaohongshu') {
      const parsed = new URL(url);
      if (/\/login/i.test(parsed.pathname)) return false;
      if (parsed.hostname === 'creator.xiaohongshu.com') return true;
      if (parsed.hostname === 'www.xiaohongshu.com') return true;
      return /xiaohongshu\.com/i.test(parsed.hostname);
    }
  } catch {
    return false;
  }
  return false;
}

/** 复用标签页时是否跳过整页导航（避免每次任务像新设备登录） */
export function shouldSkipNavigationOnReuse(
  currentUrl: string | undefined,
  targetUrl: string,
  platform?: PlatformName,
): boolean {
  if (!currentUrl) return false;
  if (isSamePathTarget(currentUrl, targetUrl)) return true;
  if (platform === 'sohu') {
    if (
      isSohuBackendUrl(currentUrl) &&
      isSohuBackendUrl(targetUrl) &&
      !/passport/i.test(currentUrl)
    ) {
      return true;
    }
  }
  if (platform === 'xiaohongshu') {
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      if (
        current.host === target.host &&
        /creator\.xiaohongshu\.com/i.test(current.host) &&
        !/\/login/i.test(current.pathname)
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function isSamePathTarget(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

async function readStore(): Promise<PlatformTabStore> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as PlatformTabStore | undefined) ?? {};
}

async function writeStore(store: PlatformTabStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

/** 读取持久化的平台标签页 id，若标签已关闭或 URL 无效则返回 undefined */
export async function getPlatformSessionTab(platform: PlatformName): Promise<number | undefined> {
  const store = await readStore();
  const entry = store[platform];
  if (!entry?.tabId) return undefined;
  try {
    const tab = await chrome.tabs.get(entry.tabId);
    if (tab.id == null || !isPlatformLoggedInTab(platform, tab.url)) {
      await clearPlatformSessionTab(platform);
      return undefined;
    }
    return tab.id;
  } catch {
    await clearPlatformSessionTab(platform);
    return undefined;
  }
}

/** 绑定平台与标签页，供后续任务复用登录态 */
export async function bindPlatformSessionTab(platform: PlatformName, tabId: number): Promise<void> {
  const store = await readStore();
  store[platform] = { tabId, platform, updatedAt: Date.now() };
  await writeStore(store);
}

/** 清除某平台的持久化标签页 */
export async function clearPlatformSessionTab(platform: PlatformName): Promise<void> {
  const store = await readStore();
  if (!store[platform]) return;
  delete store[platform];
  await writeStore(store);
}

/** 标签页关闭时清除对应持久化记录 */
export async function clearPlatformSessionIfTabRemoved(tabId: number): Promise<void> {
  const store = await readStore();
  let changed = false;
  for (const platform of Object.keys(store) as PlatformName[]) {
    if (store[platform]?.tabId === tabId) {
      delete store[platform];
      changed = true;
    }
  }
  if (changed) await writeStore(store);
}

/**
 * 为任务解析可复用的平台标签页：
 * 1. 持久化记录；2. 当前窗口活动标签；3. 任意窗口已登录的平台页。
 */
export async function resolvePlatformTabForTask(platform: PlatformName): Promise<number | undefined> {
  const persisted = await getPlatformSessionTab(platform);
  if (persisted != null) return persisted;

  try {
    const tabs = await chrome.tabs.query({});
    const active = tabs.find((tab) => tab.active && isPlatformLoggedInTab(platform, tab.url));
    if (active?.id != null) {
      await bindPlatformSessionTab(platform, active.id);
      return active.id;
    }
    const any = tabs.find((tab) => isPlatformLoggedInTab(platform, tab.url));
    if (any?.id != null) {
      await bindPlatformSessionTab(platform, any.id);
      return any.id;
    }
  } catch {
    // 无法读取标签页时回退
  }
  return undefined;
}

/** 注册标签页关闭监听，保持持久化记录与真实标签一致 */
export function initPlatformSessionListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearPlatformSessionIfTabRemoved(tabId);
  });
}
