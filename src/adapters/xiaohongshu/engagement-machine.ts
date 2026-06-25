import type { ActionResult } from '@/types';
import {
  fillElement,
  queryCandidates,
  waitForCandidate,
} from '@/core/automation/dom-driver';
import { collectDiagnostics, describeElement, formatDiagnostics } from '@/core/automation/diagnostics';
import { verifyTextAppears } from '@/core/automation/verifier';
import { isVisible, simulateClick, sleep } from '@/utils/dom';
import { xhsSelectors } from './selectors';
import type { XhsDetailState } from './states';

function pageText(): string {
  return document.body.innerText || '';
}

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '').trim();
}

function isLoginWall(): boolean {
  const url = location.href.toLowerCase();
  return xhsSelectors.loginUrlKeywords.some((k) => url.includes(k)) || /短信登录|发送验证码|扫码登录/.test(pageText());
}

function isXhsNoteDetailPage(url = location.href): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.xiaohongshu.com') return false;
    return /^\/(explore\/[^/]+|discovery\/item\/[^/]+|note\/[^/]+)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function classText(el: Element): string {
  return typeof (el as HTMLElement).className === 'string'
    ? (el as HTMLElement).className
    : (el.getAttribute('class') ?? '');
}

function isActiveColor(value: string | null | undefined): boolean {
  const color = (value ?? '').trim().toLowerCase();
  if (!color || color === 'none' || color === 'currentcolor' || color === 'transparent') return false;
  if (/^#(?:fff|ffffff)$/i.test(color)) return false;
  if (/^#f00$/i.test(color)) return true;
  if (/^#ff[0-9a-f]{4}$/i.test(color)) return true;
  if (/^#e[0-9a-f]{5}$/i.test(color)) return true;
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    const [, r, g, b] = rgb.map(Number);
    return r >= 200 && g <= 120 && b <= 140;
  }
  return /\bred\b/i.test(color);
}

function hasActiveClass(className: string): boolean {
  const classes = className.toLowerCase().split(/\s+/).filter(Boolean);
  return classes.some((name) =>
    [
      'active',
      'selected',
      'is-active',
      'liked',
      'collected',
      'followed',
      'like-active',
      'collect-active',
      'favorite-active',
    ].includes(name),
  );
}

function hasPositiveState(el: Element): boolean {
  const ariaPressed = el.getAttribute('aria-pressed');
  const dataActive = el.getAttribute('data-active');
  const aria = normalize(el.getAttribute('aria-label'));
  const text = normalize(el.textContent);
  return (
    ariaPressed === 'true' ||
    dataActive === 'true' ||
    /已点赞|取消点赞|已收藏|取消收藏|已关注|互相关注/.test(`${aria}${text}`) ||
    hasActiveClass(classText(el))
  );
}

function isActive(el: HTMLElement): boolean {
  const hasActiveVisual = Array.from(el.querySelectorAll('*')).some((item) => {
    const fill = item.getAttribute('fill') ?? '';
    const stroke = item.getAttribute('stroke') ?? '';
    const style = item.getAttribute('style') ?? '';
    return [fill, stroke, ...style.split(';').map((part) => part.split(':')[1])].some(isActiveColor);
  });
  const hasDescendantState = Array.from(el.querySelectorAll('*')).slice(0, 30).some(hasPositiveState);
  return isActiveColor(el.getAttribute('fill')) || hasActiveVisual || hasPositiveState(el) || hasDescendantState;
}

function withDiag(state: XhsDetailState, code: ActionResult['errorCode'], message: string): ActionResult {
  const diagnostics = collectDiagnostics(state);
  return {
    success: false,
    errorCode: code,
    message: `${message}\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

function ensureNoteDetailPage(actionName: string): ActionResult | null {
  if (isXhsNoteDetailPage()) return null;
  return withDiag('unknown', 'PLATFORM_PAGE_CHANGED', `当前页面不是小红书笔记详情页，已停止${actionName}`);
}

export function detectXhsDetailState(): XhsDetailState {
  if (isLoginWall()) return 'login_wall';
  if (/加载中|正在加载/.test(pageText())) return 'loading_detail';
  if (!isXhsNoteDetailPage()) {
    return /www\.xiaohongshu\.com/.test(location.href) ? 'feed_page' : 'unknown';
  }
  if (findLikeCandidate()) return isActive(findLikeCandidate()!) ? 'liked' : 'like_ready';
  if (findFavoriteCandidate()) return isActive(findFavoriteCandidate()!) ? 'favorited' : 'favorite_ready';
  if (findFollowCandidate()) return isActive(findFollowCandidate()!) ? 'followed' : 'follow_ready';
  if (findCommentInput()) return 'comment_ready';
  if (/explore|discovery|search_result|note/.test(location.href)) return 'detail_page';
  return 'unknown';
}

const ACTION_SCOPE_SELECTOR = '.interaction-container,.interact-container,.note-container,.note-detail,.note-detail-container';
const CLICKABLE_SELECTOR = [
  'button',
  '[role="button"]',
  '.like-wrapper',
  '[class*="like-wrapper"]',
  '.collect-wrapper',
  '[class*="collect-wrapper"]',
  '.follow-button',
  '.btn',
  '.d-button',
].join(',');

function promoteClickable(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(CLICKABLE_SELECTOR) ?? el;
}

function isDisabled(el: HTMLElement): boolean {
  return (
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.getAttribute('aria-disabled') === 'true' ||
    /\b(disabled|is-disabled|--disabled)\b/i.test(classText(el))
  );
}

function hasCreatorLink(el: HTMLElement): boolean {
  const link = el.closest<HTMLAnchorElement>('a[href]');
  return Boolean(link?.href && /creator\.xiaohongshu\.com/i.test(link.href));
}

function preferActionCandidate(elements: HTMLElement[]): HTMLElement | null {
  const unique = Array.from(new Set(elements.map(promoteClickable))).filter((el) => isVisible(el) && !isDisabled(el));
  unique.sort((a, b) => {
    const as = a.closest(ACTION_SCOPE_SELECTOR) ? 0 : 1;
    const bs = b.closest(ACTION_SCOPE_SELECTOR) ? 0 : 1;
    if (as !== bs) return as - bs;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.top - br.top || ar.left - br.left;
  });
  return unique[0] ?? null;
}

function candidateBySelectorsAndKeywords(selectors: string[], keywords: string[]): HTMLElement | null {
  const selectorCandidates = queryCandidates({
    selectors,
    visible: true,
    predicate: (el) => {
      const text = normalize(el.textContent);
      const aria = normalize(el.getAttribute('aria-label'));
      const cls = String(el.className).toLowerCase();
      return keywords.some((k) => text.includes(k) || aria.includes(k) || cls.includes(k.toLowerCase()));
    },
  });
  const selectorCandidate = preferActionCandidate(selectorCandidates);
  if (selectorCandidate) return selectorCandidate;

  const semantic = queryCandidates({
    selectors: ['button', 'div[role="button"]', 'span', 'div'],
    visible: true,
    predicate: (el) => {
      const text = normalize(el.textContent);
      const aria = normalize(el.getAttribute('aria-label'));
      const cls = String(el.className).toLowerCase();
      const id = String(el.id).toLowerCase();
      return keywords.some((k) => {
        const lower = k.toLowerCase();
        return text === k || aria.includes(k) || cls.includes(lower) || id.includes(lower);
      });
    },
  });
  return preferActionCandidate(semantic);
}

function findLikeCandidate(): HTMLElement | null {
  return candidateBySelectorsAndKeywords(xhsSelectors.likeButton, ['点赞', 'like']);
}

function findFavoriteCandidate(): HTMLElement | null {
  return candidateBySelectorsAndKeywords(xhsSelectors.favoriteButton, ['收藏', 'collect', 'favorite']);
}

function findFollowCandidate(): HTMLElement | null {
  const byText = queryCandidates({
    texts: ['关注'],
    tags: 'button,div[role="button"],span,.d-button',
    exactText: false,
    visible: true,
    predicate: (el) => !normalize(el.textContent).includes('已关注'),
  })[0];
  return byText ?? candidateBySelectorsAndKeywords(xhsSelectors.followButton, ['关注', 'follow']);
}

function findCommentInput(): HTMLElement | null {
  return (
    queryCandidates({ selectors: xhsSelectors.commentInput, visible: true })[0] ??
    queryCandidates({
      selectors: ['textarea[placeholder*="评论"]', '[role="textbox"][placeholder*="评论"]'],
      visible: true,
      predicate: (el) => /评论|说点什么|输入/.test(el.getAttribute('placeholder') ?? ''),
    })[0] ??
    null
  );
}

interface EngagementSnapshot {
  active: boolean;
  count?: number;
  className: string;
  iconRefs: string[];
}

function parseCount(el: HTMLElement): number | undefined {
  const countEl = el.querySelector<HTMLElement>('.count');
  const text = normalize(countEl?.textContent ?? el.textContent);
  const matched = text.match(/\d+/);
  return matched ? Number(matched[0]) : undefined;
}

function iconRefs(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('use'))
    .map((item) => item.getAttribute('href') || item.getAttribute('xlink:href') || '')
    .filter(Boolean);
}

function takeEngagementSnapshot(el: HTMLElement): EngagementSnapshot {
  const target = promoteClickable(el);
  return {
    active: isActive(target),
    count: parseCount(target),
    className: classText(target),
    iconRefs: iconRefs(target),
  };
}

function hasVerifiedEngagementChange(before: EngagementSnapshot, after: EngagementSnapshot): boolean {
  if (!before.active && after.active) return true;
  if (before.count != null && after.count != null && before.count !== after.count) return true;
  return false;
}

async function waitForVerifiedState(
  getCandidate: () => HTMLElement | null,
  before: EngagementSnapshot,
  timeout = 5000,
): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (/creator\.xiaohongshu\.com/i.test(location.href)) return null;
    const candidate = getCandidate();
    if (candidate) {
      const target = promoteClickable(candidate);
      // 只把真实激活态视为成功，避免 hover/focus/计数刷新等普通 DOM 变化误判为已完成。
      const activeParent = target.parentElement && target.parentElement.closest(ACTION_SCOPE_SELECTOR)
        ? target.parentElement
        : null;
      const snapshot = takeEngagementSnapshot(target);
      const parentSnapshot = activeParent ? takeEngagementSnapshot(activeParent) : null;
      if (
        hasVerifiedEngagementChange(before, snapshot) ||
        (parentSnapshot && hasVerifiedEngagementChange(before, parentSnapshot))
      ) {
        await sleep(1200);
        const stable = getCandidate();
        if (!stable) return null;
        const stableTarget = promoteClickable(stable);
        const stableParent = stableTarget.parentElement && stableTarget.parentElement.closest(ACTION_SCOPE_SELECTOR)
          ? stableTarget.parentElement
          : null;
        const stableSnapshot = takeEngagementSnapshot(stableTarget);
        const stableParentSnapshot = stableParent ? takeEngagementSnapshot(stableParent) : null;
        if (
          hasVerifiedEngagementChange(before, stableSnapshot) ||
          (stableParentSnapshot && hasVerifiedEngagementChange(before, stableParentSnapshot))
        ) {
          return stableTarget;
        }
      }
    }
    await sleep(250);
  }
  return null;
}

async function clickAndVerifyState(
  el: HTMLElement,
  actionName: string,
  expectedTexts: string[],
  getCandidate: () => HTMLElement | null,
): Promise<ActionResult> {
  const target = promoteClickable(el);
  const before = takeEngagementSnapshot(target);
  target.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(150);
  simulateClick(target);

  const changed = await waitForVerifiedState(getCandidate, before, 5000);
  if (changed) return { success: true, message: `${actionName} 已完成`, data: describeElement(changed) };

  const text = await verifyTextAppears(expectedTexts, { timeout: 3000, state: `${actionName}_toast` });
  if (text.success) return { success: true, message: `${actionName} 已完成`, data: describeElement(target) };

  return withDiag(detectXhsDetailState(), 'RESULT_VERIFY_FAILED', `${actionName} 点击后未检测到状态变化`);
}

export async function runXhsLikeFlow(): Promise<ActionResult> {
  if (isLoginWall()) return withDiag('login_wall', 'PLATFORM_LOGIN_REQUIRED', '未登录小红书');
  const pageError = ensureNoteDetailPage('点赞');
  if (pageError) return pageError;
  const btn = await waitForCandidate(
    {
      selectors: [...xhsSelectors.likeButton, 'button', 'div[role="button"]', 'span'],
      visible: true,
      predicate: (el) => el === findLikeCandidate(),
    },
    10000,
  );
  const candidate = btn ?? findLikeCandidate();
  if (!candidate) return withDiag(detectXhsDetailState(), 'BUTTON_NOT_FOUND', '未找到点赞按钮候选');
  if (isActive(candidate)) return { success: true, message: '已处于点赞状态', data: describeElement(candidate) };
  return clickAndVerifyState(candidate, '点赞', ['已点赞', '取消点赞', '点赞成功'], findLikeCandidate);
}

export async function runXhsFavoriteFlow(): Promise<ActionResult> {
  if (isLoginWall()) return withDiag('login_wall', 'PLATFORM_LOGIN_REQUIRED', '未登录小红书');
  const pageError = ensureNoteDetailPage('收藏');
  if (pageError) return pageError;
  const candidate = findFavoriteCandidate();
  if (!candidate) return withDiag(detectXhsDetailState(), 'BUTTON_NOT_FOUND', '未找到收藏按钮候选');
  if (isActive(candidate)) return { success: true, message: '已处于收藏状态', data: describeElement(candidate) };
  return clickAndVerifyState(candidate, '收藏', ['已收藏', '取消收藏', '收藏成功'], findFavoriteCandidate);
}

export async function runXhsFollowFlow(): Promise<ActionResult> {
  if (isLoginWall()) return withDiag('login_wall', 'PLATFORM_LOGIN_REQUIRED', '未登录小红书');
  const pageError = ensureNoteDetailPage('关注');
  if (pageError) return pageError;
  const candidate = findFollowCandidate();
  if (!candidate) return withDiag(detectXhsDetailState(), 'BUTTON_NOT_FOUND', '未找到关注按钮候选');
  if (/已关注|互相关注/.test(candidate.textContent ?? '')) {
    return { success: true, message: '已处于关注状态', data: describeElement(candidate) };
  }
  return clickAndVerifyState(candidate, '关注', ['已关注', '互相关注', '关注成功'], findFollowCandidate);
}

function isNearInput(input: HTMLElement, submit: HTMLElement): boolean {
  const inputRect = input.getBoundingClientRect();
  const submitRect = submit.getBoundingClientRect();
  return Math.abs(submitRect.top - inputRect.top) <= 180 && submitRect.left >= inputRect.left - 20;
}

function findCommentSubmit(input: HTMLElement): HTMLElement | null {
  const roots: HTMLElement[] = [];
  let current: HTMLElement | null = input;
  for (let i = 0; current && i < 5; i += 1) {
    roots.push(current);
    current = current.parentElement;
  }

  const isValidSubmit = (el: HTMLElement) => !isDisabled(el) && !hasCreatorLink(el) && isNearInput(input, el);
  const bySelector = queryCandidates({
    selectors: xhsSelectors.commentSubmit,
    visible: true,
    predicate: (el) => roots.some((root) => root.contains(el)) && isValidSubmit(el),
  })[0];
  if (bySelector) return bySelector;

  return (
    queryCandidates({
      texts: ['发送'],
      tags: 'button,div[role="button"],.d-button',
      exactText: false,
      visible: true,
      predicate: (el) => normalize(el.textContent).includes('发送') && isValidSubmit(el),
    })[0] ?? null
  );
}

async function waitForCommentSubmit(input: HTMLElement, timeout = 5000): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const submit = findCommentSubmit(input);
    if (submit) return submit;
    await sleep(250);
  }
  return null;
}

export async function runXhsCommentFlow(comment: string): Promise<ActionResult> {
  if (isLoginWall()) return withDiag('login_wall', 'PLATFORM_LOGIN_REQUIRED', '未登录小红书');
  const pageError = ensureNoteDetailPage('评论');
  if (pageError) return pageError;
  const input = findCommentInput();
  if (!input) return withDiag(detectXhsDetailState(), 'INPUT_FIELD_NOT_FOUND', '未找到评论输入框候选');

  await fillElement(input, comment);
  const submit = await waitForCommentSubmit(input, 5000);

  if (!submit) return withDiag('comment_ready', 'BUTTON_NOT_FOUND', '未找到评论提交按钮候选');
  simulateClick(submit);
  const ok = await verifyTextAppears([comment, '评论成功', '已发送'], { timeout: 10000, state: 'comment_verify' });
  if (ok.success) return { success: true, message: '评论已提交' };
  return withDiag('comment_ready', 'RESULT_VERIFY_FAILED', '评论提交后未检测到结果变化');
}

