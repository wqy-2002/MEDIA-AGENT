import type { ActionResult, GeneratedContent, PublishResult, UploadResult } from '@/types';
import {
  clickByText,
  fillElement,
  queryCandidates,
  verifyEditableContains,
  waitForCandidate,
  waitForText,
} from '@/core/automation/dom-driver';
import { collectDiagnostics, formatDiagnostics } from '@/core/automation/diagnostics';
import { runStateMachine } from '@/core/automation/state-machine';
import { verifyTextAppears } from '@/core/automation/verifier';
import {
  deepQueryAll,
  getEditableText,
  injectFiles,
  isVisible,
  reliableClick,
  setNativeValue,
  simulateClick,
  sleep,
} from '@/utils/dom';
import { xhsSelectors } from './selectors';
import type { XhsPublishState } from './states';

// 小红书发布状态机：对齐 xiaohongshu-mcp 有图路径，并单独校验无素材文字配图路径。

export type XhsPublishMode = 'image_upload' | 'text_image';

export interface XhsPublishContext {
  content: GeneratedContent;
  /** 有图片素材时为 true，走“上传图文 + 逐张上传”路径，跳过文字配图 */
  preferImageUpload?: boolean;
  publishMode?: XhsPublishMode;
  finalFormFilled?: boolean;
}

export interface XhsFillContentOptions {
  preferImageUpload?: boolean;
  publishMode?: XhsPublishMode;
}

export interface SafePublishButtonData {
  text: string;
  tag: string;
  visible: boolean;
  disabled: boolean;
  covered: boolean;
  frame: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface ScanButtonResult {
  blockers: string[];
  enabledButtons: PublishButtonCandidate[];
  disabledButtons: PublishButtonCandidate[];
  allButtons: PublishButtonCandidate[];
  safeData: {
    blockers: string[];
    enabledButtons: SafePublishButtonData[];
    disabledButtons: SafePublishButtonData[];
    allButtons: SafePublishButtonData[];
    url: string;
    title: string;
  };
}

function bodyText(): string {
  return document.body.innerText || '';
}

/** 发布页阶段文案信号，用于在多个根容器候选中选取真正有内容的子树 */
const PUBLISH_PAGE_SIGNAL = /上传视频|上传图文|上传图片|文字配图|填写标题|输入正文|生成图片|写文字|发布成功/;

function hasPublishPageSignal(el: HTMLElement): boolean {
  return PUBLISH_PAGE_SIGNAL.test(el.innerText || '');
}

function hasPublishPageSignalText(text: string): boolean {
  return PUBLISH_PAGE_SIGNAL.test(text);
}

interface PublishRootCandidate {
  el: HTMLElement;
  selector: string;
}

/** 最近一次 getPublishPageRoot 命中的选择器，供诊断对比 */
let lastPublishPageRootSelector = 'body';

/** 收集所有 publishPageRoot 候选（同选择器可能有多个节点） */
function collectPublishRootCandidates(): PublishRootCandidate[] {
  const seen = new Set<HTMLElement>();
  const items: PublishRootCandidate[] = [];
  for (const sel of xhsSelectors.publishPageRoot) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      items.push({ el, selector: sel });
    });
  }
  return items;
}

/** 根容器评分：可见 > 含发布信号 > 文案更长 */
function scorePublishRootCandidate(el: HTMLElement): number {
  let score = 0;
  if (isVisible(el)) score += 1000;
  if (hasPublishPageSignal(el)) score += 500;
  score += el.innerText?.length ?? 0;
  return score;
}

/** 发布 SPA 根容器（无匹配时回退 body，兼容单测/Mock） */
function getPublishPageRoot(): HTMLElement {
  const candidates = collectPublishRootCandidates();
  if (!candidates.length) {
    lastPublishPageRootSelector = 'body';
    return document.body;
  }

  // 优先保留 .publish-page：其下可能同时包含 microapp 编辑区与底部发布按钮栏
  for (const { el: publishPage } of candidates.filter((c) => c.selector === '.publish-page')) {
    if (hasPublishPageSignal(publishPage)) {
      lastPublishPageRootSelector = '.publish-page';
      return publishPage;
    }
    const hasVisibleSignaledChild = candidates.some(
      (c) =>
        c.el !== publishPage &&
        publishPage.contains(c.el) &&
        isVisible(c.el) &&
        hasPublishPageSignal(c.el),
    );
    if (hasVisibleSignaledChild) {
      lastPublishPageRootSelector = '.publish-page';
      return publishPage;
    }
  }

  const best = [...candidates].sort(
    (a, b) => scorePublishRootCandidate(b.el) - scorePublishRootCandidate(a.el),
  )[0];
  lastPublishPageRootSelector = best.selector;
  return best.el;
}

/** 从可见 microapp-container 读取文案（root 选取偶发失败时的兜底） */
function readVisibleMicroappText(): string {
  for (const el of document.querySelectorAll<HTMLElement>('.microapp-container')) {
    if (!isVisible(el)) continue;
    const text = el.innerText || '';
    if (hasPublishPageSignalText(text)) return text;
  }
  return '';
}

/** 发布页容器内文案，用于阶段识别（避免侧栏「发布笔记」等全局文案干扰） */
function publishPageText(): string {
  const scoped = getPublishPageRoot().innerText || '';
  if (hasPublishPageSignalText(scoped)) return scoped;
  const fallback = readVisibleMicroappText();
  return fallback || scoped;
}

/** 元素是否位于 publish-page 子树内 */
function isInsidePublishPage(el: HTMLElement): boolean {
  const root = getPublishPageRoot();
  if (root === document.body) return true;
  return root.contains(el);
}

/** 在 publish-page 内滚动到底部，使底部发布按钮进入视口 */
async function scrollPublishPageToBottom(): Promise<void> {
  const containers = [
    document.querySelector<HTMLElement>('.publish-page'),
    document.querySelector<HTMLElement>('.publish-page-content'),
    document.querySelector<HTMLElement>('.publish-page-publish-btn'),
    getPublishPageRoot(),
    document.scrollingElement as HTMLElement | null,
  ].filter((el): el is HTMLElement => Boolean(el));

  const seen = new Set<HTMLElement>();
  for (const el of containers) {
    if (seen.has(el)) continue;
    seen.add(el);
    el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(250);
}

function isLoginWall(): boolean {
  const url = location.href.toLowerCase();
  return (
    xhsSelectors.loginUrlKeywords.some((k) => url.includes(k)) ||
    /短信登录|发送验证码|扫码登录|登录即同意/.test(bodyText())
  );
}

function buildBodyText(content: GeneratedContent, includeTitle = false, includeHashtags = true): string {
  const parts: string[] = [];
  if (includeTitle && content.title) parts.push(content.title);
  if (content.body) parts.push(content.body);
  if (content.description && content.description !== content.body) parts.push(content.description);
  if (includeHashtags && content.hashtags?.length) {
    parts.push(content.hashtags.map((t) => `#${t.replace(/^#/, '')}`).join(' '));
  }
  return parts.filter(Boolean).join('\n');
}

/** 参考官方实现：点击空白区域收起引导遮罩 */
function clickEmptyPosition(): void {
  const x = 380 + Math.floor(Math.random() * 100);
  const y = 20 + Math.floor(Math.random() * 60);
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  if (target) simulateClick(target);
}

/** 逐字符输入，模拟真实键盘输入（用于话题标签联想） */
async function typeCharByChar(el: HTMLElement, text: string, delayMs = 50): Promise<void> {
  el.focus();
  for (const char of text) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, `${el.value}${char}`);
    } else {
      try {
        document.execCommand('insertText', false, char);
      } catch {
        el.textContent = `${el.textContent ?? ''}${char}`;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    await sleep(delayMs);
  }
}

/** 参考官方 inputTags：先按方向键+回车收起编辑器浮层，再逐个输入 #话题 并点选联想项 */
async function dismissEditorOverlay(contentEl: HTMLElement): Promise<void> {
  contentEl.focus();
  for (let i = 0; i < 20; i++) {
    contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await sleep(10);
  }
  contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  contentEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  contentEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  await sleep(1000);
}

async function inputXhsTags(contentEl: HTMLElement, tags: string[]): Promise<ActionResult> {
  const normalized = tags
    .slice(0, 10)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  if (!normalized.length) return { success: true, message: '无标签需要输入' };

  await dismissEditorOverlay(contentEl);

  for (const tag of normalized) {
    await typeCharByChar(contentEl, '#', 0);
    await sleep(200);
    await typeCharByChar(contentEl, tag, 50);

    let topicItem: HTMLElement | undefined;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 2000) {
      topicItem = queryCandidates({ selectors: xhsSelectors.topicSuggestion, visible: true })[0];
      if (topicItem) break;
      await sleep(200);
    }

    if (topicItem) {
      simulateClick(topicItem);
      await sleep(300);
    } else {
      await typeCharByChar(contentEl, ' ', 50);
    }
  }
  return { success: true, message: `已输入 ${normalized.length} 个话题标签` };
}

/** 在指定坐标触发完整 Pointer/Mouse 点击序列（穿透 closed shadow Host） */
function clickAtPoint(x: number, y: number, doc: Document = document): void {
  const target = doc.elementFromPoint(x, y) as HTMLElement | null;
  if (!target) return;
  simulateClick(target);
}

/** 参考官方 clickPublishWidget：closed shadow 的 xhs-publish-btn 需坐标点击 Host 内部 */
function clickXhsPublishElement(button: HTMLElement): void {
  const doc = button.ownerDocument;
  if (button.tagName.toLowerCase() === 'xhs-publish-btn') {
    const rect = button.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    for (const ratio of [0.5, 0.65, 0.75]) {
      clickAtPoint(rect.left + rect.width * ratio, y, doc);
    }
    simulateClick(button);
    button.click();
    return;
  }
  reliableClick(button);
}

function isXhsPublishHost(el: HTMLElement): boolean {
  return el.tagName.toLowerCase() === 'xhs-publish-btn';
}

/** 普通 button 是否可点击（disabled / aria-disabled / class 判断，供新旧发布按钮共用） */
function isPlainButtonClickable(el: HTMLElement): boolean {
  if (el.getAttribute('submit-disabled') === 'true') return false;
  return !(
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.getAttribute('disabled') != null ||
    /\b(disabled|is-disabled|--disabled)\b/i.test(String(el.className))
  );
}

function isButtonUsable(el: HTMLElement): boolean {
  // closed shadow Host：必须通过 is-publish="true" 且 submit-disabled 不为 true
  if (isXhsPublishHost(el)) {
    if (el.getAttribute('is-publish') !== 'true') return false;
    if (el.getAttribute('submit-disabled') === 'true') return false;
    return true;
  }
  return isPlainButtonClickable(el);
}

/**
 * 从候选列表中选取第一个可点击发布按钮（对齐 xiaohongshu-mcp pickClickableButton）。
 * @param requirePublishText 为 true 时要求文本含「发布」，并排除侧栏「发布笔记」
 */
function pickClickableButton(
  elements: HTMLElement[],
  requirePublishText = false,
): HTMLElement | null {
  for (const el of elements) {
    if (requirePublishText) {
      const text = (el.textContent ?? '').replace(/\s/g, '');
      if (!text.includes('发布') || text.includes('发布笔记')) continue;
    }
    if (!isButtonUsable(el)) continue;
    return el;
  }
  return null;
}

/** 查找文字配图草稿编辑器（不依赖草稿态判定，供结构检测使用） */
function queryTextImageDraftEditor(): HTMLElement | null {
  const inPage = { predicate: isInsidePublishPage };
  return (
    queryCandidates({
      selectors: xhsSelectors.textImageDraftEditor,
      visible: true,
      ...inPage,
    })[0] ??
    queryCandidates({
      selectors: xhsSelectors.bodyEditor,
      visible: true,
      ...inPage,
    })[0] ??
    null
  );
}

/** 文字配图草稿阶段：文案信号 + 可见「生成图片」按钮或草稿编辑器 */
function isTextImageDraftActive(): boolean {
  const text = publishPageText();
  if (!/写文字|生成图片|再写一张/.test(text)) return false;
  // 入口页营销文案「写文字生成图片」需配合可见结构，避免误判
  return hasVisibleGenerateImageButton() || Boolean(queryTextImageDraftEditor());
}

const inPublishPageQuery = { predicate: isInsidePublishPage };

/** 查找文字配图草稿编辑器 */
function findTextImageDraftEditor(): HTMLElement | null {
  if (!isTextImageDraftActive()) return null;
  return queryTextImageDraftEditor();
}

/** 查找最终发布表单标题框（草稿阶段返回 null） */
function findFinalTitleInput(): HTMLElement | null {
  if (isTextImageDraftActive()) return null;
  return (
    queryCandidates({
      selectors: xhsSelectors.titleInput,
      visible: true,
      ...inPublishPageQuery,
    })[0] ?? null
  );
}

/** 查找最终发布表单正文编辑器（草稿阶段返回 null） */
function findFinalBodyEditor(): HTMLElement | null {
  if (isTextImageDraftActive()) return null;
  const title = findFinalTitleInput();
  const uploaded = countXhsUploadedImages() > 0;
  if (!title && !uploaded) return null;
  return (
    queryCandidates({
      selectors: xhsSelectors.finalBodyEditor,
      visible: true,
      ...inPublishPageQuery,
    })[0] ?? null
  );
}

/** 是否具备最终发布表单字段（标题 + 正文，且不在草稿阶段） */
function hasFinalFormFields(): boolean {
  return Boolean(findFinalTitleInput() && findFinalBodyEditor());
}

/** publish-page 内是否存在可见的「生成图片」按钮（草稿阶段信号） */
function hasVisibleGenerateImageButton(): boolean {
  return queryCandidates({
    texts: ['生成图片'],
    tags: 'button,div[role="button"],span,.d-button',
    exactText: true,
    visible: true,
    ...inPublishPageQuery,
  }).length > 0;
}

function scorePublishHost(el: HTMLElement): number {
  let score = 0;
  if (isXhsPublishHost(el) && el.getAttribute('is-publish') === 'true') score += 150;
  if (el.closest('.publish-page-publish-btn')) score += 120;
  if (el.matches?.('button.ce-btn.bg-red')) score += 110;
  if (isInsidePublishPage(el)) score += 80;
  const rect = el.getBoundingClientRect();
  score += (rect.width * rect.height) / 100;
  score += rect.y;
  return score;
}

/** 收集 publish-page 内所有 xhs-publish-btn Host 诊断信息 */
function collectPublishButtonHosts(): Array<Record<string, unknown>> {
  const pageRoot = getPublishPageRoot();
  const seen = new Set<HTMLElement>();
  return queryPublishButtonHosts(pageRoot)
    .filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    })
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        isPublish: el.getAttribute('is-publish'),
        submitDisabled: el.getAttribute('submit-disabled'),
        inPublishPage: isInsidePublishPage(el),
        inPublishBtnBar: Boolean(el.closest('.publish-page-publish-btn')),
        isCeBtn2026: el.matches?.('button.ce-btn.bg-red') ?? false,
        text: normalizeText(el.textContent ?? ''),
        visible: isElementVisibleInOwnFrame(el),
        usable: isButtonUsable(el),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    });
}

/** 在指定 root 下按选择器收集按钮（去重） */
function queryPublishButtonsBySelectors(root: ParentNode, selectors: string[]): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const sel of selectors) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (!items.includes(el)) items.push(el);
    });
  }
  return items;
}

/** 收集发布按钮查询 root（publish-page + 可访问 iframe） */
function collectPublishButtonRoots(): ParentNode[] {
  const roots: ParentNode[] = [getPublishPageRoot()];
  for (const doc of collectAccessibleIframeDocuments()) {
    roots.push(doc.body);
  }
  return roots;
}

/** 在 publish-page 子树内查询发布按钮（诊断扫描用，含 2026 ce-btn） */
function queryPublishButtonHosts(root: ParentNode): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  const pushUnique = (el: HTMLElement) => {
    if (!hosts.includes(el)) hosts.push(el);
  };
  for (const sel of [
    ...xhsSelectors.publishButtonHost,
    ...xhsSelectors.publishButtonOld,
    ...xhsSelectors.publishButtonCe2026,
  ]) {
    root.querySelectorAll<HTMLElement>(sel).forEach(pushUnique);
  }
  if (!hosts.length) {
    for (const sel of xhsSelectors.publishButtonNew) {
      root.querySelectorAll<HTMLElement>(sel).forEach(pushUnique);
    }
  }
  return hosts;
}

/** 收集可访问 iframe 内的 document */
function collectAccessibleIframeDocuments(): Document[] {
  const docs: Document[] = [];
  document.querySelectorAll('iframe').forEach((frame) => {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {
      // 跨域 iframe 无法访问
    }
  });
  return docs;
}

/** 查找真正可点击的发布按钮：旧版优先 → 2026 ce-btn → plain Host 兜底 */
function findRealPublishButton(): HTMLElement | null {
  for (const root of collectPublishButtonRoots()) {
    const scoped = (els: HTMLElement[]) => els.filter(isPublishButtonCandidate);

    const legacy = scoped(
      queryPublishButtonsBySelectors(root, [
        ...xhsSelectors.publishButtonHost,
        ...xhsSelectors.publishButtonOld,
      ]),
    );
    const legacyBtn = pickClickableButton(legacy, false);
    if (legacyBtn && isPublishHostClickable(legacyBtn)) return legacyBtn;

    const ceButtons = scoped(queryPublishButtonsBySelectors(root, xhsSelectors.publishButtonCe2026));
    const ceBtn = pickClickableButton(ceButtons, true);
    if (ceBtn && isPublishHostClickable(ceBtn)) return ceBtn;

    const hosts = scoped(queryPublishButtonsBySelectors(root, xhsSelectors.publishButtonNew));
    const hostBtn = pickClickableButton(hosts, false);
    if (hostBtn && isPublishHostClickable(hostBtn)) return hostBtn;
  }
  return null;
}

/** 是否达到可提交终态：最终表单 + 真正发布 Host + 不在文字配图草稿 */
function isReadyToSubmit(): boolean {
  if (isTextImageDraftActive()) return false;
  if (hasVisibleGenerateImageButton()) return false;
  return Boolean(findRealPublishButton() && hasFinalFormFields());
}

/** 采集填写流程诊断信息，写入任务日志 */
export function getXhsPublishFlowDiagnostics(): Record<string, unknown> {
  const draftEditor = findTextImageDraftEditor();
  const finalEditor = findFinalBodyEditor();
  const root = getPublishPageRoot();
  const scopedText = publishPageText();
  const bodyFull = bodyText();
  return {
    state: detectXhsPublishState(),
    publishPageRoot: root.className || root.tagName.toLowerCase(),
    publishPageRootSelector: lastPublishPageRootSelector,
    publishPageTextLength: scopedText.length,
    publishPageTextPreview: scopedText.slice(0, 120),
    bodyHasPublishSignal: hasPublishPageSignalText(bodyFull),
    publishModeSignals: {
      textImageDraft: isTextImageDraftActive(),
      uploadedImages: countXhsUploadedImages(),
      hasFinalForm: hasFinalFormFields(),
      readyToSubmit: isReadyToSubmit(),
      hasGenerateButton: hasVisibleGenerateImageButton(),
    },
    editors: {
      draftTextLength: draftEditor ? getEditableText(draftEditor).length : 0,
      finalTextLength: finalEditor ? getEditableText(finalEditor).length : 0,
    },
    publishButtonHosts: collectPublishButtonHosts(),
    publishButtons: scanXhsPublishButtons().safeData,
  };
}

/** 校验发布成功（优先 publish-page 内文案，Toast 在全页时兜底） */
export async function verifyXhsPublishSuccess(timeout = 15000): Promise<ActionResult> {
  const successPatterns = ['发布成功', '已发布', '发布审核中', '笔记管理'];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const scoped = publishPageText();
    const full = bodyText();
    if (successPatterns.some((p) => scoped.includes(p) || full.includes(p))) {
      return { success: true, message: '检测到发布成功信号' };
    }
    await sleep(500);
  }
  return verifyTextAppears(successPatterns, { timeout: 0, state: 'success' });
}

/** 图片编辑/封面建议是文字配图后的中间页，不应误判为最终发布表单 */
function isImageEditingPage(text: string): boolean {
  return (
    /图片编辑/.test(text) ||
    /获取封面建议/.test(text) ||
    /编辑\s*智能标题/.test(text) ||
    /图片编辑\s*\d+\s*\/\s*\d+/.test(text)
  );
}

function getElementWindow(el: HTMLElement): Window {
  return el.ownerDocument.defaultView ?? window;
}

function isElementVisibleInOwnFrame(el: HTMLElement): boolean {
  const win = getElementWindow(el);
  const style = win.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity !== '' && Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  if (rect.left >= win.innerWidth || rect.top >= win.innerHeight) return false;
  return true;
}

function isElementCovered(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const top = doc.elementFromPoint(x, y);
  if (!top) return false;
  return top !== el && !el.contains(top) && !top.contains(el);
}

function collectRoots(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [root];
  const visit = (current: Document | ShadowRoot) => {
    current.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        visit(el.shadowRoot);
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const doc = el.contentDocument;
          if (doc) {
            roots.push(doc);
            visit(doc);
          }
        } catch {
          // 跨域 iframe 无法直接访问，后续由截图兜底处理。
        }
      }
    });
  };
  visit(root);
  return roots;
}

interface PublishButtonCandidate {
  el: HTMLElement;
  disabled: boolean;
  visible: boolean;
  covered: boolean;
  frame: string;
  score: number;
}

function detectXhsBlockers(): string[] {
  const text = publishPageText();
  const patterns: Array<[RegExp, string]> = [
    [/登录|短信|扫码登录/, '登录要求'],
    [/验证码|安全验证/, '安全验证'],
    [/操作频繁|请稍后/, '频率限制'],
    [/上传失败|重新上传|生成失败/, '上传或生成失败'],
    [/发布失败|不可发布|违规/, '发布阻塞'],
    [/请先完成|同意|我知道了/, '页面确认弹层或未完成项'],
  ];
  return patterns.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function scorePublishCandidate(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const text = normalizeText(el.textContent ?? '');
  const tag = el.tagName.toLowerCase();
  let score = 0;
  // 参考官方实现：新版 xhs-publish-btn 与旧版 .publish-page-publish-btn 是最可靠的发布按钮信号。
  if (tag === 'xhs-publish-btn') score += 120;
  if (el.closest('.publish-page-publish-btn')) score += 100;
  if (el.matches?.('button.ce-btn.bg-red')) score += 95;
  if (text === '发布') score += 50;
  if (tag === 'button') score += 20;
  if (el.getAttribute('role') === 'button') score += 15;
  if (/\bd-button|contentBtn|publish/i.test(String(el.className))) score += 10;
  // 小红书左侧“发布笔记”菜单通常在左侧，最终发布按钮更靠页面中下区域。
  if (rect.x > 180) score += 8;
  if (rect.y > 300) score += 6;
  if (rect.width >= 40 && rect.height >= 24) score += 4;
  return score;
}

/** 文本兜底匹配的发布按钮文案（严格排除左侧「发布笔记」菜单） */
function isPublishButtonText(text: string): boolean {
  return /^(发布|立即发布|确认发布)$/.test(text);
}

function normalizeText(text: string): string {
  return text.replace(/\s/g, '');
}

function isPublishButtonCandidate(el: HTMLElement): boolean {
  if (isInsidePublishPage(el)) return true;
  // 可访问 iframe 内的发布按钮（子 frame 可能无 publish-page 包裹）
  return el.ownerDocument !== document;
}

function isPublishHostClickable(el: HTMLElement): boolean {
  if (!isButtonUsable(el)) return false;
  // iframe 内 Host：jsdom 视口/遮挡检测不稳定，仅校验 Host 属性
  if (el.ownerDocument !== document) return true;
  if (!isElementVisibleInOwnFrame(el)) return false;
  if (isXhsPublishHost(el)) return true;
  return !isElementCovered(el);
}

function scanXhsPublishButtonCandidates(): PublishButtonCandidate[] {
  const selector = 'button,[role="button"],.d-button,a,div,span';
  const candidates: PublishButtonCandidate[] = [];
  const seen = new Set<HTMLElement>();
  const pageRoot = getPublishPageRoot();

  const pushCandidate = (el: HTMLElement, frame: string) => {
    if (seen.has(el)) return;
    seen.add(el);
    const visible = isElementVisibleInOwnFrame(el);
    const disabled = !isButtonUsable(el);
    const covered = visible ? isElementCovered(el) : false;
    candidates.push({
      el,
      disabled,
      visible,
      covered,
      frame,
      score: scorePublishCandidate(el),
    });
  };

  // 1) publish-page 内 Host / 旧版按钮（诊断与 findRealPublishButton 同源）
  queryPublishButtonHosts(pageRoot).forEach((el) => pushCandidate(el, location.href));

  // 2) 可访问 iframe 内的 Host
  for (const root of collectRoots(document)) {
    if (!(root instanceof Document) || root === document) continue;
    const frame = root.location?.href ?? location.href;
    queryPublishButtonHosts(root.body).forEach((el) => pushCandidate(el, frame));
  }

  // 3) 文本兜底：仅 publish-page 内，仅供诊断，不作为点击依据
  pageRoot.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const text = normalizeText(el.textContent ?? '');
    if (!isPublishButtonText(text)) return;
    pushCandidate(el, location.href);
  });

  return candidates.sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return b.score - a.score;
  });
}

function toSafeButtonData(candidate: PublishButtonCandidate): SafePublishButtonData {
  const rect = candidate.el.getBoundingClientRect();
  return {
    text: normalizeText(candidate.el.textContent ?? ''),
    tag: candidate.el.tagName.toLowerCase(),
    visible: candidate.visible,
    disabled: candidate.disabled,
    covered: candidate.covered,
    frame: candidate.frame,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export function scanXhsPublishButtons(): ScanButtonResult {
  const blockers = detectXhsBlockers();
  const allButtons = scanXhsPublishButtonCandidates();
  const realButton = findRealPublishButton();
  const enabledButtons = allButtons.filter((x) => x.visible && !x.disabled && !x.covered);
  if (realButton && !enabledButtons.some((x) => x.el === realButton)) {
    enabledButtons.unshift({
      el: realButton,
      disabled: false,
      visible: true,
      covered: false,
      frame: location.href,
      score: 200,
    });
  }
  const disabledButtons = allButtons.filter((x) => x.visible && x.disabled);
  return {
    blockers,
    enabledButtons,
    disabledButtons,
    allButtons,
    safeData: {
      blockers,
      enabledButtons: enabledButtons.map(toSafeButtonData),
      disabledButtons: disabledButtons.map(toSafeButtonData),
      allButtons: allButtons.map(toSafeButtonData),
      url: location.href,
      title: document.title,
    },
  };
}

/** 查找最终发布按钮，仅认 xhs-publish-btn / button.bg-red，避免误点侧栏 */
export function findXhsPublishButton(): HTMLElement | null {
  return findRealPublishButton();
}

/** 统计 publish-page 内已渲染的图片预览数量 */
export function countXhsUploadedImages(): number {
  const pageRoot = getPublishPageRoot();
  for (const sel of xhsSelectors.imagePreview) {
    const count = pageRoot.querySelectorAll<HTMLElement>(sel).length;
    if (count > 0) return count;
  }
  // 兜底：publish-page 未匹配时查全页
  if (pageRoot === document.body) {
    for (const sel of xhsSelectors.imagePreview) {
      const count = deepQueryAll<HTMLElement>(sel).length;
      if (count > 0) return count;
    }
  }
  return 0;
}

/**
 * 等待图片上传完成：预览数量达到期望值（参考官方实现 waitForUploadComplete）。
 * @param expectedCount 期望出现的预览数量
 * @param timeout 最长等待时间（毫秒），默认 60 秒
 */
export async function waitForXhsUploadComplete(
  expectedCount: number,
  timeout = 60000,
): Promise<boolean> {
  if (expectedCount <= 0) return true;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (countXhsUploadedImages() >= expectedCount) return true;
    await sleep(500);
  }
  return false;
}

/**
 * 移除发布页可能出现的引导/提示遮罩（参考官方实现 removePopCover）。
 * 这些 d-popover 遮罩会挡住“上传图文”tab 或底部发布按钮，导致点击落空。
 */
function removePopCover(): void {
  for (const sel of xhsSelectors.popCover) {
    deepQueryAll<HTMLElement>(sel).forEach((el) => {
      try {
        el.remove();
      } catch {
        // 遮罩可能由框架托管，移除失败时忽略，后续靠点击空白处兜底。
      }
    });
  }
  clickEmptyPosition();
}

/** 切换到“上传图文”页签（参考官方 mustClickPublishTab） */
export async function ensureXhsImageTextTab(): Promise<ActionResult> {
  return clickUploadImageTab();
}

/**
 * 逐张上传图片（参考官方 uploadImages）。
 * 首张使用 .upload-input，后续使用 input[type="file"]，每张上传后等待预览出现。
 */
export async function uploadXhsImagesSequentially(files: File[]): Promise<UploadResult> {
  if (!files.length) {
    return { success: true, uploadedCount: 0, message: '无素材需要上传' };
  }

  const tabResult = await ensureXhsImageTextTab();
  if (!tabResult.success) {
    return {
      success: false,
      uploadedCount: 0,
      errorCode: 'PLATFORM_PAGE_CHANGED',
      message: tabResult.message ?? '未能切换到上传图文页签',
    };
  }

  // 入口态需先点“上传图片”，否则隐藏 file input 存在但页面不会进入编辑态
  await clickByText(['上传图片', '上传图文'], {
    exactText: false,
    tags: 'button,div[role="button"],span,.d-button',
    timeout: 8000,
  });

  let uploadedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const selectors =
      i === 0
        ? xhsSelectors.firstUploadInput
        : ['input[type="file"]', ...xhsSelectors.fileInput];

    const input = await waitForCandidate({ selectors, visible: false }, 12000);
    if (!input || !(input instanceof HTMLInputElement)) {
      return {
        success: false,
        uploadedCount,
        errorCode: 'INPUT_FIELD_NOT_FOUND',
        message: `未找到第 ${i + 1} 张图片的上传输入框`,
      };
    }

    const beforeCount = countXhsUploadedImages();
    injectFiles(input, [files[i]]);
    const expectedCount = beforeCount + 1;
    const completed = await waitForXhsUploadComplete(expectedCount, 60000);
    if (!completed) {
      const current = countXhsUploadedImages();
      if (current === 0 && i === 0) {
        // 部分版本无预览节点，短暂等待后按已注入处理
        await sleep(3000);
        uploadedCount += 1;
        continue;
      }
      return {
        success: false,
        uploadedCount: current,
        errorCode: 'UPLOAD_NOT_FINISHED',
        message: `第 ${i + 1} 张图片上传超时：期望 ${expectedCount} 张预览，当前 ${current} 张`,
      };
    }
    uploadedCount += 1;
    await sleep(1000);
  }

  return {
    success: true,
    uploadedCount,
    message: `已逐张上传 ${uploadedCount} 个文件并确认预览完成`,
  };
}

/** 收起话题/用户/表情候选层，避免候选列表遮挡底部发布按钮 */
async function dismissSuggestionPanels(): Promise<void> {
  const active = document.activeElement;
  for (const target of [active, document.body, window]) {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    target?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  }
  if (active instanceof HTMLElement) active.blur();
  await sleep(200);
}

/** unknown 态：全页已有发布信号时短等待并重检，避免 SPA 未渲染完即失败 */
async function handleUnknownPublishState(): Promise<ActionResult> {
  if (hasPublishPageSignalText(bodyText())) {
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      const state = detectXhsPublishState();
      if (state !== 'unknown') {
        return { success: true, message: `重检后识别为 ${state}` };
      }
    }
  }
  return fail('unknown', '无法识别小红书发布页状态');
}

/** 识别当前小红书发布页状态（基于 publish-page SPA 阶段，不依赖 URL 变化） */
export function detectXhsPublishState(): XhsPublishState {
  const text = publishPageText();
  if (isLoginWall()) return 'login_wall';
  if (/发布成功|已发布|发布审核中/.test(bodyText()) || /发布成功|已发布|发布审核中/.test(text)) {
    return 'success';
  }
  if (/验证码|安全验证|违规|不可发布|生成失败|上传失败/.test(text)) return 'blocked';
  if (/图片生成中|生成中|上传中|处理中/.test(text)) return 'image_generating';

  // 文字配图草稿优先于终态，避免草稿编辑器被误判为最终表单
  if (isTextImageDraftActive()) {
    if (/选择一个喜欢的卡片|换配色/.test(text) && /下一步/.test(text)) return 'image_preview';
    if (findTextImageDraftEditor()) return 'text_image_editor';
  }

  if (/选择一个喜欢的卡片|换配色|下一步/.test(text) && !isTextImageDraftActive()) {
    return 'image_preview';
  }
  if (isImageEditingPage(text)) {
    if (hasFinalFormFields()) return 'final_form';
    return 'image_editing';
  }

  const uploadedCount = countXhsUploadedImages();
  if (uploadedCount > 0 && hasFinalFormFields()) {
    return isReadyToSubmit() ? 'publish_button_ready' : 'final_form';
  }

  if (isReadyToSubmit()) return 'publish_button_ready';
  if (hasFinalFormFields()) return 'final_form';

  if (/上传图片|文字配图/.test(text)) return 'image_entry';
  if (/上传视频/.test(text) && /上传图文/.test(text)) return 'video_tab';
  return 'unknown';
}

function fail(state: XhsPublishState, message: string): ActionResult {
  const diagnostics = collectDiagnostics(state);
  return {
    success: false,
    errorCode: 'PLATFORM_PAGE_CHANGED',
    message: `${message}\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

/**
 * 等待发布页就绪：上传组件容器出现，或“上传图文”页签已可见即可（参考官方实现等待 upload-content）。
 * 任一条件满足即返回，避免容器选择器缺失时长时间空等。
 */
async function waitForUploadTabReady(timeout = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const containerReady = queryCandidates({
      selectors: xhsSelectors.uploadContentArea,
      visible: true,
    })[0];
    const tabReady = queryCandidates({
      selectors: xhsSelectors.imageTextTab,
      texts: ['上传图文'],
      visible: true,
    })[0];
    if (containerReady || tabReady) return;
    await sleep(300);
  }
}

async function clickUploadImageTab(): Promise<ActionResult> {
  // 参考官方实现：先等待发布页就绪，再移除可能存在的引导遮罩，最后点击“上传图文”页签。
  await waitForUploadTabReady(10000);
  removePopCover();
  const res = await clickByText(['上传图文'], {
    exactText: true,
    tags: 'div.creator-tab,.creator-tab,button,div[role="button"],span',
    timeout: 8000,
  });
  if (!res.success) {
    // 可能被遮罩挡住，移除遮罩后再试一次。
    removePopCover();
    const retry = await clickByText(['上传图文'], {
      exactText: true,
      tags: 'div.creator-tab,.creator-tab,button,div[role="button"],span',
      timeout: 6000,
    });
    if (!retry.success) return fail('video_tab', '未能点击“上传图文”页签');
  }
  await waitForText(['上传图片', '文字配图'], 12000);
  return { success: true, message: '已切换到图文入口' };
}

async function clickTextImageEntry(): Promise<ActionResult> {
  const res = await clickByText(['文字配图'], {
    exactText: true,
    tags: 'button,div[role="button"],span,.d-button',
    timeout: 12000,
  });
  if (!res.success) return fail('image_entry', '未能点击“文字配图”');
  const editor = await waitForCandidate({ selectors: xhsSelectors.textImageDraftEditor, visible: true }, 12000);
  if (!editor) return fail('image_entry', '点击“文字配图”后未出现文字编辑器');
  return { success: true, message: '已进入文字配图编辑器' };
}

/** 有图片素材时跳过文字配图，等待上传后的最终表单 */
async function handleImageEntryWithUpload(ctx: XhsPublishContext): Promise<ActionResult> {
  if (ctx.preferImageUpload || ctx.publishMode === 'image_upload') {
    const title = await waitForCandidate({ selectors: xhsSelectors.titleInput, visible: true }, 8000);
    const body = await waitForCandidate({ selectors: xhsSelectors.finalBodyEditor, visible: true }, 8000);
    if (title && body) return { success: true, message: '图文上传后已进入发布表单' };

    if (countXhsUploadedImages() > 0) {
      return fail('image_entry', '图片已上传但未出现标题/正文编辑区');
    }

    await clickByText(['上传图片', '上传图文'], {
      exactText: false,
      tags: 'button,div[role="button"],span,.d-button',
      timeout: 8000,
    });
    const retryTitle = await waitForCandidate({ selectors: xhsSelectors.titleInput, visible: true }, 12000);
    const retryBody = await waitForCandidate({ selectors: xhsSelectors.finalBodyEditor, visible: true }, 12000);
    if (retryTitle && retryBody) return { success: true, message: '点击上传图片后已进入发布表单' };
    return fail('image_entry', '图文上传模式下未进入发布表单');
  }

  return clickTextImageEntry();
}

/** 等待离开文字配图草稿态（生成中 / 卡片预览 / 最终表单） */
async function waitForTextImageProgress(timeout = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = detectXhsPublishState();
    if (
      state === 'image_generating' ||
      state === 'image_preview' ||
      state === 'final_form' ||
      state === 'publish_button_ready' ||
      state === 'image_editing'
    ) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function fillDraftAndGenerate(ctx: XhsPublishContext): Promise<ActionResult> {
  const editor =
    findTextImageDraftEditor() ??
    (await waitForCandidate({ selectors: xhsSelectors.textImageDraftEditor, visible: true }, 12000));
  if (!editor) return fail('text_image_editor', '未找到文字配图编辑器');

  const draftText = buildBodyText(ctx.content, true, false);
  await fillElement(editor, draftText);
  await sleep(500);

  if (!verifyEditableContains(editor, draftText)) {
    return {
      success: false,
      errorCode: 'FORM_NOT_READY',
      message: `文字配图草稿未写入成功，编辑器当前内容为空或不匹配。\n${formatDiagnostics(collectDiagnostics('text_image_editor'))}`,
    };
  }

  const generate = await clickByText(['生成图片'], {
    exactText: true,
    tags: 'button,div[role="button"],span,.d-button',
    timeout: 12000,
  });
  if (!generate.success) return fail('text_image_editor', '未找到“生成图片”按钮');

  const progressed = await waitForTextImageProgress(60000);
  if (!progressed) {
    return {
      success: false,
      errorCode: 'FORM_NOT_READY',
      message: '点击“生成图片”后页面未进入生成/预览/最终表单阶段，可能点击未生效或生成失败',
    };
  }
  return { success: true, message: '文字配图已提交生成并进入下一阶段' };
}

async function waitPreviewAndNext(): Promise<ActionResult> {
  const ok = await waitForText(['下一步', '选择一个喜欢的卡片'], 60000);
  if (!ok) return fail('image_generating', '等待图片生成完成超时');

  if (detectXhsPublishState() === 'text_image_editor') {
    return fail('image_generating', '仍在文字配图草稿页，图片尚未生成');
  }

  const next = await clickByText(['下一步'], {
    exactText: true,
    tags: 'button,div[role="button"],span,.d-button',
    timeout: 12000,
  });
  if (!next.success) return fail('image_preview', '未能点击“下一步”');

  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (hasFinalFormFields()) {
      return { success: true, message: '已进入最终发布表单' };
    }
    await sleep(500);
  }
  return fail('image_preview', '点击“下一步”后未进入最终发布表单');
}

async function waitImageEditingForm(): Promise<ActionResult> {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (hasFinalFormFields()) return { success: true, message: '图片编辑页已出现最终发布表单' };
    await scrollPublishPageToBottom();
    await sleep(500);
  }
  return fail('image_editing', '图片编辑页未出现标题和正文编辑区');
}

/**
 * 检查标题/正文是否超过平台长度上限（参考官方实现 checkTitleMaxLength / checkContentMaxLength）。
 * 小红书在超长时会渲染 div.max_suffix / div.length-error 提示元素，文本形如 "1024/1000"。
 * @returns 超长时返回错误描述，未超长返回 null。
 */
function checkXhsLengthErrors(): string | null {
  const pageRoot = getPublishPageRoot();
  const parseError = (selectors: string[], label: string): string | null => {
    for (const sel of selectors) {
      const el = pageRoot.querySelector<HTMLElement>(sel) ??
        (pageRoot === document.body ? deepQueryAll<HTMLElement>(sel)[0] : null);
      if (!el || !isInsidePublishPage(el)) continue;
      const text = (el.textContent ?? '').trim();
      const parts = text.split('/');
      if (parts.length === 2) {
        return `${label}超长：当前 ${parts[0].trim()} 字，上限 ${parts[1].trim()} 字`;
      }
      return `${label}超长：${text || '已超过平台长度限制'}`;
    }
    return null;
  };
  return (
    parseError(xhsSelectors.titleLengthError, '标题') ??
    parseError(xhsSelectors.contentLengthError, '正文')
  );
}

async function fillFinalForm(ctx: XhsPublishContext): Promise<ActionResult> {
  if (ctx.finalFormFilled) {
    await dismissSuggestionPanels();
    return { success: true, message: '最终表单已填写，已跳过重复填写' };
  }

  let titleEl: HTMLElement | null = null;
  if (ctx.content.title) {
    titleEl = findFinalTitleInput() ??
      (await waitForCandidate({ selectors: xhsSelectors.titleInput, visible: true }, 10000));
    if (titleEl) await fillElement(titleEl, ctx.content.title);
    await sleep(500);
    const titleLengthError = checkXhsLengthErrors();
    if (titleLengthError?.startsWith('标题')) {
      return { success: false, errorCode: 'FORM_NOT_READY', message: titleLengthError };
    }
  }

  const body = buildBodyText(ctx.content, false, false);
  let contentEl: HTMLElement | null = null;
  if (body) {
    contentEl =
      findFinalBodyEditor() ??
      (await waitForCandidate({ selectors: xhsSelectors.finalBodyEditor, visible: true }, 10000));
    if (!contentEl) return fail('final_form', '未找到最终正文编辑器');
    await fillElement(contentEl, body);
    await sleep(1000);
    if (!verifyEditableContains(contentEl, body)) {
      return {
        success: false,
        errorCode: 'FORM_NOT_READY',
        message: '最终正文未写入成功，编辑器内容与预期不符',
      };
    }
  }

  // 参考官方：填写正文后回点标题，增强后续标签输入稳定性
  if (titleEl) {
    simulateClick(titleEl);
    await sleep(500);
  }

  if (contentEl && ctx.content.hashtags?.length) {
    const tagResult = await inputXhsTags(contentEl, ctx.content.hashtags);
    if (!tagResult.success) return tagResult;
    await sleep(1000);
  }

  const lengthError = checkXhsLengthErrors();
  if (lengthError) {
    return { success: false, errorCode: 'FORM_NOT_READY', message: lengthError };
  }

  ctx.finalFormFilled = true;
  await dismissSuggestionPanels();
  return { success: true, message: '最终表单已填写' };
}

async function scrollAndWaitPublishReady(timeout = 60000): Promise<ActionResult> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await scrollPublishPageToBottom();
    if (isReadyToSubmit()) return { success: true, message: '发布按钮已就绪' };
    const state = detectXhsPublishState();
    if (state === 'blocked') return fail(state, '发布表单被平台提示阻塞');
    if (state === 'text_image_editor') {
      return fail(state, '仍在文字配图草稿页，尚未生成图片');
    }
    await sleep(1000);
  }
  return fail('final_form', '等待发布按钮就绪超时');
}

async function fillFinalFormAndWaitPublishReady(ctx: XhsPublishContext): Promise<ActionResult> {
  const filled = await fillFinalForm(ctx);
  if (!filled.success) return filled;
  return scrollAndWaitPublishReady();
}

async function finishFillFlow(ctx: XhsPublishContext): Promise<ActionResult> {
  const stateBefore = detectXhsPublishState();
  if (stateBefore === 'text_image_editor') {
    return fail(stateBefore, '填写流程结束时仍在文字配图草稿页，图片未生成');
  }

  const filled = await fillFinalForm(ctx);
  if (!filled.success) return filled;

  const ready = await scrollAndWaitPublishReady(8000);
  if (ready.success) {
    return {
      ...ready,
      data: getXhsPublishFlowDiagnostics(),
    };
  }

  if (isReadyToSubmit()) return ready;

  return {
    success: false,
    errorCode: 'FORM_NOT_READY',
    message: `${ready.message ?? '发布表单未就绪'}\n${formatDiagnostics(collectDiagnostics(detectXhsPublishState()))}`,
    data: getXhsPublishFlowDiagnostics(),
  };
}

/** 运行小红书内容填写状态机，保证最终进入可发布表单并完成填写 */
export async function runXhsFillContentFlow(
  content: GeneratedContent,
  options: XhsFillContentOptions = {},
): Promise<ActionResult> {
  const publishMode: XhsPublishMode =
    options.publishMode ?? (options.preferImageUpload ? 'image_upload' : 'text_image');
  const ctx: XhsPublishContext = {
    content,
    preferImageUpload: options.preferImageUpload ?? publishMode === 'image_upload',
    publishMode,
  };
  return runStateMachine<XhsPublishState, XhsPublishContext>({
    name: '小红书发布填写流程',
    ctx,
    detect: detectXhsPublishState,
    terminalStates: ['publish_button_ready', 'final_form'],
    blockedStates: ['login_wall', 'blocked'],
    maxTransitions: 20,
    steps: {
      video_tab: { state: 'video_tab', description: '切换图文页签', run: clickUploadImageTab },
      image_entry: {
        state: 'image_entry',
        description: '进入图文发布入口',
        run: handleImageEntryWithUpload,
      },
      text_image_editor: {
        state: 'text_image_editor',
        description: '填写文字并生成图片',
        run: fillDraftAndGenerate,
      },
      image_generating: {
        state: 'image_generating',
        description: '等待生成并点击下一步',
        run: waitPreviewAndNext,
      },
      image_preview: {
        state: 'image_preview',
        description: '点击下一步进入最终表单',
        run: waitPreviewAndNext,
      },
      image_editing: {
        state: 'image_editing',
        description: '等待图片编辑页表单',
        run: waitImageEditingForm,
      },
      final_form: {
        state: 'final_form',
        description: '填写最终表单并等待发布',
        run: fillFinalFormAndWaitPublishReady,
      },
      unknown: {
        state: 'unknown',
        description: '未知状态下采集诊断',
        run: handleUnknownPublishState,
      },
      submit_confirm: { state: 'submit_confirm', description: '确认提交', run: async () => undefined },
      submitting: { state: 'submitting', description: '提交中', run: async () => undefined },
      success: { state: 'success', description: '成功', run: async () => undefined },
      publish_button_ready: { state: 'publish_button_ready', description: '就绪', run: async () => undefined },
      login_wall: { state: 'login_wall', description: '登录墙', run: async () => undefined },
      blocked: { state: 'blocked', description: '阻塞', run: async () => undefined },
    },
  }).then(async (machineResult) => {
    if (!machineResult.success) {
      return {
        ...machineResult,
        data: { ...(machineResult.data as object), diagnostics: getXhsPublishFlowDiagnostics() },
      };
    }
    const finished = await finishFillFlow(ctx);
    return {
      ...finished,
      data: {
        ...(finished.data as object),
        visited: (machineResult.data as { visited?: string[] })?.visited,
        diagnostics: getXhsPublishFlowDiagnostics(),
      },
    };
  });
}

/** 运行小红书最终发布状态机并验证提交 */
export async function runXhsSubmitPublishFlow(): Promise<PublishResult> {
  const ready = await scrollAndWaitPublishReady(12000);
  if (!ready.success) {
    return {
      success: false,
      errorCode: hasFinalFormFields() ? 'FORM_NOT_READY' : ready.errorCode,
      message: ready.message,
    };
  }

  const scan = scanXhsPublishButtons();
  if (scan.blockers.length) {
    return {
      success: false,
      errorCode: 'BLOCKED_BY_DIALOG',
      message: `页面存在阻塞项：${scan.blockers.join('、')}`,
      resultUrl: location.href,
    };
  }
  if (scan.disabledButtons.length && !scan.enabledButtons.length) {
    return {
      success: false,
      errorCode: 'BUTTON_DISABLED',
      message: '发布按钮存在但不可点击，可能是上传未完成或表单校验未通过',
      resultUrl: location.href,
    };
  }
  const button = findRealPublishButton();
  if (!button || !isElementVisibleInOwnFrame(button)) {
    const diagnostics = collectDiagnostics(detectXhsPublishState());
    return {
      success: false,
      errorCode: hasFinalFormFields() ? 'BUTTON_NOT_FOUND' : 'FORM_NOT_READY',
      message: `表单字段已填写，但当前 frame 未找到可点击发布按钮。\n${formatDiagnostics(diagnostics)}`,
      resultUrl: location.href,
    };
  }

  button.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(200);
  clickXhsPublishElement(button);

  const submitted = await verifyXhsPublishSuccess(45000);
  if (submitted.success) {
    return { success: true, resultUrl: location.href, message: '发布已提交' };
  }

  // 必须检测到明确成功信号，不再因 URL/按钮变化乐观判成功
  return {
    success: false,
    errorCode: 'CLICKED_BUT_NOT_PUBLISHED',
    message: submitted.message,
    resultUrl: location.href,
  };
}

/** frame 定向点击发布按钮（配合 background all-frames fallback） */
export async function runXhsFramePublishClickFlow(): Promise<PublishResult> {
  const scan = scanXhsPublishButtons();
  if (scan.blockers.length) {
    return {
      success: false,
      errorCode: 'BLOCKED_BY_DIALOG',
      message: `页面存在阻塞项：${scan.blockers.join('、')}`,
      resultUrl: location.href,
    };
  }
  if (scan.disabledButtons.length && !scan.enabledButtons.length) {
    return {
      success: false,
      errorCode: 'BUTTON_DISABLED',
      message: '当前 frame 的发布按钮不可点击',
      resultUrl: location.href,
    };
  }
  const button = scan.enabledButtons[0]?.el;
  if (!button) {
    return {
      success: false,
      errorCode: 'BUTTON_NOT_FOUND',
      message: '当前 frame 未发现可点击发布按钮',
      resultUrl: location.href,
    };
  }
  button.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(200);
  clickXhsPublishElement(button);
  const submitted = await verifyXhsPublishSuccess(15000);
  if (submitted.success) {
    return { success: true, resultUrl: location.href, message: 'frame 内点击发布成功' };
  }
  return {
    success: false,
    errorCode: 'CLICKED_BUT_NOT_PUBLISHED',
    message: submitted.message,
    resultUrl: location.href,
  };
}

