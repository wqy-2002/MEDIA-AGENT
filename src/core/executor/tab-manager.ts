import { sleep } from '@/utils/dom';
import type { PlatformName } from '@/types';
import {
  bindPlatformSessionTab,
  getPlatformSessionTab,
  isPlatformLoggedInTab,
  shouldSkipNavigationOnReuse,
} from '@/core/storage/platform-session';

export interface ContentReadyResult {
  ready: boolean;
  frameId?: number;
  frameUrls?: string[];
  pingResults?: FramePingResult[];
}

export interface FramePingResult {
  frameId: number;
  url: string;
  ok: boolean;
  error?: string;
}

export interface WaitForContentReadyOptions {
  retries?: number;
  platform?: PlatformName;
  preferEditorFrame?: boolean;
  /** 搜狐 check_login：优先选 loggedIn 且无验证码的子 frame */
  preferLoggedInFrame?: boolean;
}

export interface InjectContentScriptsResult {
  success: boolean;
  files: string[];
  error?: string;
}

const SOHU_CONTENT_SCRIPT_FILES = ['content-scripts/content.js'];

/** 判断 URL 是否同源/同平台，可用于复用已有平台标签页 */
function canReuseTab(tabUrl: string | undefined, targetUrl: string): boolean {
  if (!tabUrl) return false;
  try {
    const current = new URL(tabUrl);
    const target = new URL(targetUrl);
    if (current.host === target.host) return true;
    if (/\.sohu\.com$/i.test(current.host) && /\.sohu\.com$/i.test(target.host)) return true;
    return false;
  } catch {
    return false;
  }
}

export interface OpenTabOptions {
  /** 平台标识，用于跨任务复用持久化标签页 */
  platform?: PlatformName;
  /** 是否写入持久化会话，默认 true */
  persistSession?: boolean;
}

async function findReusableTab(url: string, platform?: PlatformName): Promise<number | undefined> {
  if (platform) {
    const persisted = await getPlatformSessionTab(platform);
    if (persisted != null) return persisted;

    const allTabs = await chrome.tabs.query({});
    const activeLoggedIn = allTabs.find(
      (tab) => tab.active && isPlatformLoggedInTab(platform, tab.url),
    );
    if (activeLoggedIn?.id != null) return activeLoggedIn.id;

    const anyLoggedIn = allTabs.find((tab) => isPlatformLoggedInTab(platform, tab.url));
    if (anyLoggedIn?.id != null) return anyLoggedIn.id;
  }

  const tabs = await chrome.tabs.query({});
  const active = tabs.find((tab) => tab.active && canReuseTab(tab.url, url));
  if (active?.id != null) return active.id;
  return tabs.find((tab) => canReuseTab(tab.url, url))?.id;
}

/** 打开或复用一个 URL 的标签页并激活，返回 tabId（加载完成后） */
export async function openTab(url: string, options?: OpenTabOptions): Promise<number> {
  const platform = options?.platform;
  const persistSession = options?.persistSession !== false;

  const reusableTabId = await findReusableTab(url, platform);
  if (reusableTabId != null) {
    const tab = await chrome.tabs.get(reusableTabId);
    const skipNavigate = shouldSkipNavigationOnReuse(tab.url, url, platform);
    if (skipNavigate) {
      await chrome.tabs.update(reusableTabId, { active: true });
    } else {
      await chrome.tabs.update(reusableTabId, { url, active: true });
      await waitForTabComplete(reusableTabId);
    }
    if (platform && persistSession) {
      await bindPlatformSessionTab(platform, reusableTabId);
    }
    return reusableTabId;
  }

  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id == null) throw new Error('创建标签页失败');
  await waitForTabComplete(tab.id);
  if (platform && persistSession) {
    await bindPlatformSessionTab(platform, tab.id);
  }
  return tab.id;
}

/** 在已存在的标签页中导航到 URL */
export async function navigateTab(
  tabId: number,
  url: string,
  options?: Pick<OpenTabOptions, 'platform' | 'persistSession'>,
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const skipNavigate = shouldSkipNavigationOnReuse(tab.url, url, options?.platform);
  if (skipNavigate) {
    await chrome.tabs.update(tabId, { active: true });
  } else {
    await chrome.tabs.update(tabId, { url, active: true });
    await waitForTabComplete(tabId);
  }
  if (options?.platform && options.persistSession !== false) {
    await bindPlatformSessionTab(options.platform, tabId);
  }
}

/** 刷新已存在的标签页，常用于扩展重载后重新注入 content script */
export async function reloadTab(tabId: number): Promise<void> {
  await chrome.tabs.reload(tabId);
  await waitForTabComplete(tabId);
}

/** 等待标签页加载完成 */
export function waitForTabComplete(tabId: number, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeout);

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

export async function listTabFrames(
  tabId: number,
): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
  if (!chrome.webNavigation?.getAllFrames) {
    return [
      { frameId: 0, url: '', errorOccurred: false, parentFrameId: -1 },
    ] as chrome.webNavigation.GetAllFrameResultDetails[];
  }
  return (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
}

function readLastError(): string | undefined {
  return chrome.runtime.lastError?.message;
}

/** 向指定 frame 发送 PING（含错误信息） */
export async function pingFrameDetailed(
  tabId: number,
  frameId: number,
  url = '',
): Promise<FramePingResult> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId });
    const err = readLastError();
    if (err) {
      return { frameId, url, ok: false, error: err };
    }
    return { frameId, url, ok: Boolean(res) };
  } catch (err) {
    return {
      frameId,
      url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 向指定 frame 发送 PING */
export async function pingFrame(tabId: number, frameId: number): Promise<boolean> {
  return (await pingFrameDetailed(tabId, frameId)).ok;
}

interface FrameProbePayload {
  loginWall?: boolean;
  editorReady?: boolean;
  verification?: boolean;
  url?: string;
  loggedIn?: boolean;
  needVerification?: boolean;
  verificationMatch?: string;
  onBackend?: boolean;
}

async function probeSohuFrame(tabId: number, frameId: number): Promise<FrameProbePayload | null> {
  try {
    const res = await chrome.tabs.sendMessage(
      tabId,
      {
        type: 'CONTENT_EXECUTE_ACTION',
        payload: {
          taskId: 'probe',
          platform: 'sohu',
          command: 'detect_state',
        },
      },
      { frameId },
    );
    const wrapped = res as { ok?: boolean; data?: { data?: FrameProbePayload } };
    if (!wrapped?.ok || !wrapped.data?.data) return null;
    return wrapped.data.data;
  } catch {
    return null;
  }
}

function resolveContentScriptFiles(manifest: chrome.runtime.Manifest): string[] {
  const fromManifest = manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
  const unique = [...new Set(fromManifest.length ? fromManifest : SOHU_CONTENT_SCRIPT_FILES)];
  return unique;
}

/** 通过 manifest 重新注入 content script（扩展热更新或 SPA 漏注入时兜底） */
export async function injectContentScripts(tabId: number): Promise<InjectContentScriptsResult> {
  if (!chrome.scripting?.executeScript) {
    return { success: false, files: [], error: 'chrome.scripting 不可用' };
  }
  const files = resolveContentScriptFiles(chrome.runtime.getManifest());
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files,
    });
    return { success: true, files };
  } catch (err) {
    return {
      success: false,
      files,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 扫描所有 frame 的 PING 结果（搜狐 ping 全部 frame，含 about:blank） */
export async function scanFramePingMatrix(
  tabId: number,
  options?: WaitForContentReadyOptions,
): Promise<FramePingResult[]> {
  const frames = await listTabFrames(tabId);
  const results: FramePingResult[] = [];
  for (const frame of frames) {
    if (frame.errorOccurred) {
      results.push({
        frameId: frame.frameId,
        url: frame.url ?? '',
        ok: false,
        error: 'frame errorOccurred',
      });
      continue;
    }
    results.push(await pingFrameDetailed(tabId, frame.frameId, frame.url ?? ''));
  }
  return results;
}

/**
 * 扫描所有 frame，返回首个响应 PING 的 frameId。
 * 搜狐任务 ping 全部 frame（含无界 about:blank 子 iframe）。
 */
export async function scanReadyFrame(
  tabId: number,
  options?: WaitForContentReadyOptions,
): Promise<ContentReadyResult> {
  const pingResults = await scanFramePingMatrix(tabId, options);
  const frameUrls = pingResults.map((p) => p.url);
  const responding = pingResults.filter((p) => p.ok).map((p) => ({ frameId: p.frameId, url: p.url }));

  if (!responding.length) {
    return { ready: false, frameUrls, pingResults };
  }

  if (options?.platform === 'sohu' && options.preferLoggedInFrame) {
    for (const item of responding) {
      const probe = await probeSohuFrame(tabId, item.frameId);
      if (probe?.loggedIn && !probe?.needVerification && !probe?.loginWall) {
        return { ready: true, frameId: item.frameId, frameUrls, pingResults };
      }
    }
    for (const item of responding) {
      const probe = await probeSohuFrame(tabId, item.frameId);
      if (probe && !probe.loginWall && !probe.needVerification) {
        return { ready: true, frameId: item.frameId, frameUrls, pingResults };
      }
    }
    for (const item of responding) {
      const probe = await probeSohuFrame(tabId, item.frameId);
      if (probe?.onBackend && !probe?.loginWall) {
        return { ready: true, frameId: item.frameId, frameUrls, pingResults };
      }
    }
  }

  if (options?.platform === 'sohu' && options.preferEditorFrame) {
    for (const item of responding) {
      const probe = await probeSohuFrame(tabId, item.frameId);
      if (probe?.editorReady) {
        return { ready: true, frameId: item.frameId, frameUrls, pingResults };
      }
    }
    for (const item of responding) {
      const probe = await probeSohuFrame(tabId, item.frameId);
      if (probe && !probe.loginWall) {
        return { ready: true, frameId: item.frameId, frameUrls, pingResults };
      }
    }
  }

  const preferred = responding.find((f) => f.frameId === 0) ?? responding[0];
  return { ready: true, frameId: preferred.frameId, frameUrls, pingResults };
}

/**
 * 搜狐 SPA 就绪：complete 后等待无界 iframe 挂载或任意 frame PING 成功。
 */
export async function waitForSohuSpaReady(tabId: number, timeoutMs = 25000): Promise<ContentReadyResult> {
  const start = Date.now();
  let lastResult: ContentReadyResult = { ready: false, frameUrls: [] };

  while (Date.now() - start < timeoutMs) {
    lastResult = await scanReadyFrame(tabId, { platform: 'sohu', preferEditorFrame: false });
    if (lastResult.ready) return lastResult;
    await sleep(500);
  }

  return lastResult;
}

/** 等待 Content Script 就绪：多 frame PING，搜狐默认更长等待 */
export async function waitForContentReady(
  tabId: number,
  options?: number | WaitForContentReadyOptions,
): Promise<ContentReadyResult> {
  const opts: WaitForContentReadyOptions =
    typeof options === 'number' ? { retries: options } : (options ?? {});
  const retries = opts.retries ?? (opts.platform === 'sohu' ? 45 : 10);
  const preferEditor = opts.preferEditorFrame ?? opts.platform === 'sohu';

  let lastResult: ContentReadyResult = { ready: false };

  for (let i = 0; i < retries; i++) {
    const result = await scanReadyFrame(tabId, { ...opts, preferEditorFrame: preferEditor });
    lastResult = result;
    if (result.ready) return result;
    await sleep(800);
  }

  const injectResult = await injectContentScripts(tabId);
  lastResult = {
    ...lastResult,
    pingResults: [
      ...(lastResult.pingResults ?? []),
      {
        frameId: -1,
        url: 'inject',
        ok: injectResult.success,
        error: injectResult.error,
      },
    ],
  };
  await sleep(1200);

  for (let i = 0; i < 5; i++) {
    const result = await scanReadyFrame(tabId, { ...opts, preferEditorFrame: preferEditor });
    lastResult = result;
    if (result.ready) return result;
    await sleep(800);
  }

  return { ready: false, frameUrls: lastResult.frameUrls, pingResults: lastResult.pingResults };
}

/** 截取标签页可见区域，返回 dataUrl */
export async function captureTab(windowId?: number): Promise<string | undefined> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId as number, { format: 'png' });
  } catch {
    return undefined;
  }
}
