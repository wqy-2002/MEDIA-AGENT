import type { ElementCandidate } from '@/types';
import {
  deepQueryAll,
  findByText,
  fillRichTextEditor,
  getEditableText,
  injectFiles,
  isVisible,
  reliableClick,
  setNativeValue,
  simulateClick,
  sleep,
} from '@/utils/dom';
import { describeElement } from './diagnostics';

export interface CandidateQuery {
  selectors?: string[];
  texts?: string[];
  tags?: string;
  visible?: boolean;
  exactText?: boolean;
  predicate?: (el: HTMLElement) => boolean;
}

export interface DriverActionResult {
  success: boolean;
  element?: HTMLElement;
  candidate?: ElementCandidate;
  message?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').trim();
}

function sortCandidates(elements: HTMLElement[]): HTMLElement[] {
  return [...elements].sort((a, b) => {
    const av = isVisible(a) ? 0 : 1;
    const bv = isVisible(b) ? 0 : 1;
    if (av !== bv) return av - bv;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const areaA = ar.width * ar.height;
    const areaB = br.width * br.height;
    const textA = (a.textContent ?? '').length;
    const textB = (b.textContent ?? '').length;
    return textA - textB || areaA - areaB;
  });
}

/** 查找候选元素，支持 selector 和文本语义查询 */
export function queryCandidates(query: CandidateQuery): HTMLElement[] {
  const visible = query.visible ?? true;
  const items: HTMLElement[] = [];

  for (const selector of query.selectors ?? []) {
    items.push(...deepQueryAll<HTMLElement>(selector));
  }

  for (const text of query.texts ?? []) {
    const tags = query.tags ?? 'button,div[role="button"],span,a,.d-button';
    const exact = query.exactText ?? false;
    const target = normalizeText(text);
    const textMatches = tags
      .split(',')
      .flatMap((tag) => deepQueryAll<HTMLElement>(tag.trim()))
      .filter((el) => {
        const actual = normalizeText(el.textContent ?? '');
        return exact ? actual === target : actual.includes(target);
      });
    items.push(...textMatches);
  }

  const unique = Array.from(new Set(items));
  return sortCandidates(
    unique.filter((el) => (!visible || isVisible(el)) && (!query.predicate || query.predicate(el))),
  );
}

/** 等待候选元素出现 */
export async function waitForCandidate(
  query: CandidateQuery,
  timeout = 15000,
  interval = 300,
): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const candidate = queryCandidates(query)[0];
    if (candidate) return candidate;
    await sleep(interval);
  }
  return null;
}

/** 点击候选元素 */
export async function clickCandidate(query: CandidateQuery, timeout = 15000): Promise<DriverActionResult> {
  const el = await waitForCandidate(query, timeout);
  if (!el) return { success: false, message: '未找到可点击候选元素' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(120);
  reliableClick(el);
  return { success: true, element: el, candidate: describeElement(el) };
}

/** 按文本点击元素 */
export async function clickByText(
  texts: string[],
  options: Partial<CandidateQuery> & { timeout?: number } = {},
): Promise<DriverActionResult> {
  return clickCandidate(
    {
      tags: options.tags ?? 'button,div[role="button"],span,a,.d-button',
      texts,
      visible: options.visible ?? true,
      exactText: options.exactText,
      predicate: options.predicate,
    },
    options.timeout ?? 15000,
  );
}

/** 填写 input/textarea/contenteditable */
export async function fillElement(el: HTMLElement, text: string): Promise<void> {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(120);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, text);
  } else if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    await fillRichTextEditor(el, text);
  } else {
    await fillRichTextEditor(el, text);
  }
}

/** 验证可编辑元素是否包含预期文本片段 */
export function verifyEditableContains(el: HTMLElement, expected: string): boolean {
  const probe = expected.trim().slice(0, Math.min(12, expected.trim().length));
  if (!probe) return true;
  return getEditableText(el).includes(probe);
}

/** 等待并填写第一个候选输入/编辑器 */
export async function fillCandidate(
  query: CandidateQuery,
  text: string,
  timeout = 15000,
): Promise<DriverActionResult> {
  const el = await waitForCandidate(query, timeout);
  if (!el) return { success: false, message: '未找到可填写候选元素' };
  await fillElement(el, text);
  return { success: true, element: el, candidate: describeElement(el) };
}

/** 滚动所有可滚动容器到底部 */
export async function scrollAllToBottom(): Promise<void> {
  const containers = deepQueryAll<HTMLElement>('*').filter(
    (el) => isVisible(el) && el.scrollHeight > el.clientHeight + 8,
  );
  for (const el of containers) {
    el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(250);
}

/** 把文件注入到隐藏 input[type=file] */
export async function injectFilesToCandidate(
  selectors: string[],
  files: File[],
  timeout = 15000,
): Promise<DriverActionResult> {
  const el = await waitForCandidate({ selectors, visible: false }, timeout);
  if (!el || !(el instanceof HTMLInputElement)) {
    return { success: false, message: '未找到 file input' };
  }
  injectFiles(el, files);
  return { success: true, element: el, candidate: describeElement(el) };
}

/** 等待页面文本出现 */
export async function waitForText(texts: string[], timeout = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = document.body.innerText || '';
    if (texts.some((text) => body.includes(text))) return true;
    await sleep(300);
  }
  return false;
}

/** 尝试使用 findByText 兜底 */
export function findTextElement(text: string, tags = 'button,div[role="button"],span,a,.d-button') {
  return findByText<HTMLElement>(tags, text);
}

