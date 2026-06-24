// Tab 管理：在 Background 中打开/复用目标平台标签页，并等待加载完成、
// 等待 Content Script 就绪。Content Script 不直接控制 tab，统一由此处管理。

import { sleep } from '@/utils/dom';

/** 判断 URL 是否同源/同平台，可用于复用已有平台标签页 */
function canReuseTab(tabUrl: string | undefined, targetUrl: string): boolean {
  if (!tabUrl) return false;
  try {
    const current = new URL(tabUrl);
    const target = new URL(targetUrl);
    // 同 host 直接复用；小红书创作平台 query 变化也复用
    return current.host === target.host;
  } catch {
    return false;
  }
}

/** 查找当前窗口中可复用的平台标签页 */
async function findReusableTab(url: string): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((tab) => tab.active && canReuseTab(tab.url, url));
  if (active?.id != null) return active.id;
  const existing = tabs.find((tab) => canReuseTab(tab.url, url));
  return existing?.id;
}

/** 打开或复用一个 URL 的标签页并激活，返回 tabId（加载完成后） */
export async function openTab(url: string): Promise<number> {
  const reusableTabId = await findReusableTab(url);
  if (reusableTabId != null) {
    await chrome.tabs.update(reusableTabId, { url, active: true });
    await waitForTabComplete(reusableTabId);
    return reusableTabId;
  }

  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id == null) throw new Error('创建标签页失败');
  await waitForTabComplete(tab.id);
  return tab.id;
}

/** 在已存在的标签页中导航到 URL */
export async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTabComplete(tabId);
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

    // 兜底：如果已经是 complete 状态
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

/**
 * 等待 Content Script 就绪：发送 ping，重试若干次。
 * 防止页面加载完成但脚本尚未注册监听器的竞态。
 */
export async function waitForContentReady(tabId: number, retries = 10): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 });
      if (res) return true;
    } catch {
      // 脚本尚未就绪
    }
    await sleep(800);
  }
  return false;
}

/** 截取标签页可见区域，返回 dataUrl */
export async function captureTab(windowId?: number): Promise<string | undefined> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId as number, { format: 'png' });
  } catch {
    return undefined;
  }
}
