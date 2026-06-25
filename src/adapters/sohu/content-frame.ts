/** 当前 frame 是否为 about:blank */
export function isAboutBlankFrame(href = location.href): boolean {
  return href === 'about:blank' || href.startsWith('about:');
}

/** 安全读取 top frame 的 hostname（跨域时可能抛错） */
export function getTopFrameHostname(): string | undefined {
  try {
    return window.top?.location.hostname;
  } catch {
    return undefined;
  }
}

/**
 * 是否应忽略 content script 消息（小红书 about:blank 防抢答）。
 * 搜狐 mpfe 无界子 iframe 为 about:blank 但 top 为 mp.sohu.com，仍需响应 PING。
 */
export function shouldIgnoreContentMessage(
  href = location.href,
  topHostname = getTopFrameHostname(),
): boolean {
  if (!isAboutBlankFrame(href)) return false;
  if (topHostname === 'mp.sohu.com' || topHostname?.endsWith('.sohu.com')) {
    return false;
  }
  return true;
}
