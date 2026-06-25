import { isVisible } from '@/utils/dom';
import { sohuSelectors } from './selectors';

export interface SohuFrameProbeResult {
  loginWall: boolean;
  editorReady: boolean;
  verification: boolean;
  url: string;
}

export interface SohuLoginProbeResult {
  loggedIn: boolean;
  needVerification: boolean;
  loginWall: boolean;
  editorReady: boolean;
  onBackend: boolean;
  url: string;
  message: string;
  verificationMatch?: string;
}

export interface SohuVerificationProbe {
  blocked: boolean;
  matchedSelector?: string;
}

const MIN_VERIFICATION_SIZE = 50;

/** 当前 frame 是否处于搜狐登录墙 URL */
export function isSohuLoginWallUrl(url = location.href): boolean {
  try {
    const parsed = new URL(url, location.origin);
    if (sohuSelectors.loginHostnames.some((h) => parsed.hostname === h)) return true;
    return sohuSelectors.loginPathPattern.test(parsed.pathname);
  } catch {
    const lower = url.toLowerCase();
    if (sohuSelectors.loginHostnames.some((h) => lower.includes(h))) return true;
    return sohuSelectors.loginPathPattern.test(lower);
  }
}

/** 是否在搜狐 mpfe 后台上下文（含无界 about:blank 子 frame） */
export function isSohuMpfeContext(url = location.href): boolean {
  if (isSohuBackendUrl(url)) return true;
  if (!url.startsWith('about:')) return false;
  try {
    const topHost = window.top?.location.hostname ?? '';
    return topHost === 'mp.sohu.com' || topHost.endsWith('.sohu.com');
  } catch {
    return false;
  }
}

/** DOM 是否出现登录墙文案（mpfe 后台内） */
export function hasSohuLoginWallDom(): boolean {
  if (!isSohuMpfeContext()) return false;
  const text = document.body?.innerText ?? '';
  return sohuSelectors.loginWallTextPattern.test(text);
}

/** 当前 frame DOM 是否已有发文编辑器 */
export function isSohuEditorDomReady(): boolean {
  for (const sel of sohuSelectors.titleInput) {
    if (document.querySelector(sel)) return true;
  }
  for (const sel of sohuSelectors.bodyEditor) {
    if (document.querySelector(sel)) return true;
  }
  return false;
}

function hasBlockingSize(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > MIN_VERIFICATION_SIZE && rect.height > MIN_VERIFICATION_SIZE;
}

/** 元素或其父级弹层是否含验证码相关文案 */
function hasVerificationContextText(el: Element): boolean {
  const pattern = sohuSelectors.verificationTextPattern;
  if (el instanceof HTMLElement && pattern.test(el.innerText ?? '')) return true;
  let parent: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 4 && parent; i++) {
    if (pattern.test(parent.innerText ?? '')) return true;
    parent = parent.parentElement;
  }
  return pattern.test(document.body?.innerText ?? '');
}

/** 查找可见且阻塞的验证码/滑块容器 */
export function findSohuVerificationWall(): SohuVerificationProbe {
  for (const sel of sohuSelectors.verificationFlags) {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) continue;
    if (!isVisible(el) || !hasBlockingSize(el)) continue;
    if (!hasVerificationContextText(el)) continue;
    return { blocked: true, matchedSelector: sel };
  }
  return { blocked: false };
}

/** 是否存在可见验证码墙 */
export function hasSohuVerificationWall(): boolean {
  return findSohuVerificationWall().blocked;
}

/** 快速探测登录态（无 waitForElement，适用于 dashboard check_login） */
export function probeSohuLoginState(): SohuLoginProbeResult {
  const url = location.href;
  const loginWall = isSohuLoginWallUrl(url) || hasSohuLoginWallDom();
  const verificationProbe = !loginWall ? findSohuVerificationWall() : { blocked: false };
  const verification = verificationProbe.blocked;
  const editorReady = !loginWall && !verification && isSohuEditorDomReady();
  const onBackend = isSohuMpfeContext(url);

  if (loginWall) {
    return {
      loggedIn: false,
      needVerification: false,
      loginWall: true,
      editorReady: false,
      onBackend,
      url,
      message: '检测到搜狐号登录页，请先完成登录',
    };
  }
  if (verification) {
    return {
      loggedIn: false,
      needVerification: true,
      loginWall: false,
      editorReady: false,
      onBackend,
      url,
      verificationMatch: verificationProbe.matchedSelector,
      message: '检测到验证码/安全验证，请人工处理后继续',
    };
  }
  if (editorReady) {
    return {
      loggedIn: true,
      needVerification: false,
      loginWall: false,
      editorReady: true,
      onBackend,
      url,
      message: '已登录且在发文编辑页',
    };
  }
  if (onBackend) {
    return {
      loggedIn: true,
      needVerification: false,
      loginWall: false,
      editorReady: false,
      onBackend: true,
      url,
      message: '搜狐后台已加载，未发现登录墙',
    };
  }
  return {
    loggedIn: true,
    needVerification: false,
    loginWall: false,
    editorReady: false,
    onBackend: false,
    url,
    message: '未发现登录墙，按已登录继续',
  };
}

/** 探测当前 frame 的搜狐发文就绪状态 */
export function probeSohuFrameState(): SohuFrameProbeResult {
  const url = location.href;
  const loginWall = isSohuLoginWallUrl(url) || hasSohuLoginWallDom();
  const verification = !loginWall && hasSohuVerificationWall();
  return {
    loginWall,
    editorReady: !loginWall && !verification && isSohuEditorDomReady(),
    verification,
    url,
  };
}

/** 是否为搜狐后台相关 URL（含列表页、编辑器、passport） */
export function isSohuBackendUrl(url: string): boolean {
  if (/passport\.sohu\.com/.test(url)) return true;
  if (/mp\.sohu\.com/.test(url)) return true;
  return /sohu\.com/.test(url) && /mpfe\/v4|contentManagement|addarticle|article\/new/.test(url);
}
