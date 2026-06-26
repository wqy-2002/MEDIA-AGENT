import type { ActionResult, GeneratedContent, PublishResult, UploadResult } from '@/types';
import {
  clickByText,
  queryCandidates,
  verifyEditableContains,
  waitForCandidate,
  waitForText,
} from '@/core/automation/dom-driver';
import { collectDiagnostics, formatDiagnostics } from '@/core/automation/diagnostics';
import { runStateMachine } from '@/core/automation/state-machine';
import {
  humanActionDelay,
  humanImageUploadGap,
  humanPreSubmitDwell,
  humanStateTransitionDelayMs,
  humanFieldGap,
  getCharDelayMs,
  loadPublishPacingFromSettings,
  typeHuman,
  typeCharByCharHuman,
} from '@/core/automation/human-pacing';
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
import { XHS_URLS, xhsSelectors } from './selectors';
import type { XhsPublishState } from './states';

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

/** 在 publish-page 内滚动到底部，使底部发布按钮进入视口（优先增量滚动内部容器） */
async function scrollXhsPublishContainersToBottom(): Promise<void> {
  const prioritySelectors = [
    '.publish-page-content',
    '.microapp-container',
    ...xhsSelectors.publishScrollContainers,
  ];
  const seen = new Set<HTMLElement>();

  for (const sel of prioritySelectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      try {
        for (let i = 0; i < 5; i++) {
          const step = node.clientHeight > 0 ? node.clientHeight : 400;
          node.scrollTop += step;
          if (node.scrollTop + node.clientHeight >= node.scrollHeight - 8) break;
        }
        node.scrollTop = node.scrollHeight;
        node.scrollLeft = node.scrollWidth;
      } catch {
        // 部分节点不可滚动，忽略
      }
    });
    await sleep(300);
  }

  window.scrollTo(0, document.body.scrollHeight);
  await sleep(500);
}

async function scrollPublishPageToBottom(): Promise<void> {
  await scrollXhsPublishContainersToBottom();
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

/** 点击空白区域收起引导遮罩 */
function clickEmptyPosition(): void {
  const x = 380 + Math.floor(Math.random() * 100);
  const y = 20 + Math.floor(Math.random() * 60);
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  if (target) simulateClick(target);
}

/** 逐字符输入，模拟真实键盘输入（用于话题标签联想） */
async function typeCharByChar(el: HTMLElement, text: string, delayMs?: number): Promise<void> {
  if (delayMs != null) {
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
    return;
  }
  await typeCharByCharHuman(el, text);
}

/** 先按方向键+回车收起编辑器浮层，再逐个输入 #话题 并点选联想项 */
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
    await sleep(getCharDelayMs() > 0 ? Math.min(200, getCharDelayMs()) : 200);
    await typeCharByChar(contentEl, tag);

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
      await typeCharByChar(contentEl, ' ', getCharDelayMs());
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

/** closed shadow Host 上可能暴露的发布/存草稿实例方法 */
const XHS_PUBLISH_METHOD_NAMES = ['_onPublish', '_onSubmit', 'onPublish', '_handlePublish'];
const XHS_DRAFT_METHOD_NAMES = ['_onSave', '_onSaveDraft', '_onDraft'];

export interface XhsPublishHostInvokeResult {
  invoked: boolean;
  method?: string;
}

/** 最近一次 xhs-publish-btn Host 方法调用结果，供诊断日志 */
let lastPublishHostInvoke: XhsPublishHostInvokeResult | null = null;

/** 直接调用 Host 上的发布/存草稿回调，穿透 closed shadow */
function invokeXhsPublishHost(host: HTMLElement, isDraft = false): XhsPublishHostInvokeResult {
  const names = isDraft ? XHS_DRAFT_METHOD_NAMES : XHS_PUBLISH_METHOD_NAMES;
  const el = host as HTMLElement & Record<string, unknown>;
  for (const name of names) {
    const fn = el[name];
    if (typeof fn === 'function') {
      (fn as () => void).call(el);
      return { invoked: true, method: name };
    }
  }
  return { invoked: false };
}

/**
 * 点击发布控件：xhs-publish-btn 优先 invoke Host 方法，否则 fallback 到 CustomEvent/坐标点击。
 * closed shadow 下外层 click 无效，见 OpenCLI #1606。
 */
function clickXhsPublishElement(button: HTMLElement, isDraft = false): XhsPublishHostInvokeResult | null {
  lastPublishHostInvoke = null;
  if (button.tagName.toLowerCase() === 'xhs-publish-btn') {
    if (isButtonUsable(button)) {
      const invoked = invokeXhsPublishHost(button, isDraft);
      lastPublishHostInvoke = invoked;
      if (invoked.invoked) return invoked;

      const doc = button.ownerDocument;
      button.dispatchEvent(
        new CustomEvent('publish', {
          bubbles: true,
          cancelable: true,
        }),
      );
      const rect = button.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      for (const ratio of [0.5, 0.65, 0.75]) {
        clickAtPoint(rect.left + rect.width * ratio, y, doc);
      }
      simulateClick(button);
      button.click();
    }
    return lastPublishHostInvoke;
  }
  reliableClick(button);
  return null;
}

/** 发布后可能出现的二次确认弹窗（短轮询点击） */
async function tryDismissPublishConfirmDialog(timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await clickByText(['确认发布', '确定', '继续发布'], {
      exactText: false,
      tags: 'button,div[role="button"],span,.d-button',
      timeout: 800,
    });
    if (res.success) return;
    await sleep(400);
  }
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
 * 从候选列表中选取第一个可点击发布按钮。
 * @param requirePublishText 为 true 时要求文本含「发布/立即发布」，并排除侧栏与误点项
 */
function pickClickableButton(
  elements: HTMLElement[],
  requirePublishText = false,
): HTMLElement | null {
  for (const el of elements) {
    if (requirePublishText && !isValidPublishButtonText(el)) continue;
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

/** 图片编辑 overlay 上的智能标题输入（4x22 小框，不是最终发布标题） */
function isImageOverlayTitleInput(el: HTMLElement): boolean {
  const cls = String(el.className ?? '');
  if (/--color-text-title|smart-title|image-title|cover-title/i.test(cls)) return true;
  if (el.closest('[class*="img-edit"], [class*="image-edit"], [class*="cover-edit"], .img-preview-area')) {
    return true;
  }
  const rect = el.getBoundingClientRect();
  // 真实标题框宽度通常 > 100px；overlay 智能标题常见 4~80px 宽
  if (rect.width > 0 && rect.width < 80) return true;
  return false;
}

/** 输入框尺寸是否达到可填写的主表单字段 */
function isMeaningfulFormFieldRect(el: HTMLElement, minWidth = 80, minHeight = 18): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= minWidth && rect.height >= minHeight;
}

/** 元素在 DOM 中布局存在（display/尺寸 OK），不要求在 window 视口内 */
function isLayoutPresent(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity !== '' && Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** 图片编辑阶段（顶部 图片编辑 N/M + 封面建议） */
function isImageEditingStage(text = publishPageText()): boolean {
  return (
    /图片编辑\s*\d+\s*\/\s*\d+/.test(text) ||
    (/图片编辑/.test(text) && /获取封面建议/.test(text))
  );
}

/** 最终表单区 UI 信号：话题/用户/表情 或 xhs-publish-btn Host */
function hasFinalFormChrome(): boolean {
  const pageRoot = getPublishPageRoot();
  for (const sel of ['xhs-publish-btn[is-publish="true"]', 'xhs-publish-btn']) {
    const host = pageRoot.querySelector<HTMLElement>(sel);
    if (host && isLayoutPresent(host) && isButtonUsable(host)) return true;
  }
  const text = publishPageText();
  return /话题/.test(text) && /用户/.test(text) && /表情/.test(text);
}

/** 是否为最终发布表单标题框（排除图片编辑 smart title overlay） */
function isFinalTitleInput(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (!isInsidePublishPage(el) || !isLayoutPresent(el)) return false;
  if (isImageOverlayTitleInput(el)) return false;

  const placeholder = el.getAttribute('placeholder') ?? '';
  if (/标题|填写/.test(placeholder)) {
    return isMeaningfulFormFieldRect(el, 60, 18);
  }

  if (el.closest('.d-input, .title-container, .title-input, .title-wrap')) {
    return isMeaningfulFormFieldRect(el, 60, 18);
  }

  return false;
}

/** 是否为最终发布正文编辑器（排除图片编辑区内的 contenteditable） */
function isFinalBodyEditor(el: HTMLElement): boolean {
  if (!isInsidePublishPage(el) || !isLayoutPresent(el)) return false;
  if (el.closest('.img-preview-area, [class*="img-edit"], [class*="image-edit"], [class*="cover-edit"]')) {
    return false;
  }

  const isEditor =
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox' ||
    el.matches?.('.tiptap, .ProseMirror, .ql-editor, [data-placeholder*="正文"]');
  if (!isEditor) return false;

  return isMeaningfulFormFieldRect(el, 120, 32);
}

/** 查找最终发布表单标题框（草稿阶段返回 null） */
function findFinalTitleInput(): HTMLElement | null {
  if (isTextImageDraftActive()) return null;
  return (
    queryCandidates({
      selectors: xhsSelectors.titleInput,
      visible: false,
      predicate: isFinalTitleInput,
    })[0] ?? null
  );
}

/** 是否存在标题输入框 */
function hasTitleInput(): boolean {
  return Boolean(findFinalTitleInput());
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
      visible: false,
      predicate: isFinalBodyEditor,
    })[0] ?? null
  );
}

/** 是否存在正文编辑器 */
function hasContentEditor(): boolean {
  return Boolean(findFinalBodyEditor());
}

/** 是否具备真实最终发布表单（标题 placeholder + 正文 + 图片编辑阶段需 chrome/Host） */
function hasRealFinalFormFields(): boolean {
  if (!hasTitleInput() || !hasContentEditor()) return false;
  const title = findFinalTitleInput();
  const ph = title?.getAttribute('placeholder') ?? '';
  if (!/填写标题|标题/.test(ph)) return false;
  if (isImageEditingStage() && !hasFinalFormChrome()) return false;
  return true;
}

/** 图片编辑页是否已推进到可填写的最终表单 */
function hasAdvancedFromImageEditing(): boolean {
  return hasRealFinalFormFields() && Boolean(findRealPublishButton() || hasFinalFormChrome());
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

/** 查找真正可点击的发布按钮：新版 Host → ce-btn → 旧版 → 文本兜底 */
function findRealPublishButton(): HTMLElement | null {
  for (const root of collectPublishButtonRoots()) {
    const scoped = (els: HTMLElement[]) => els.filter(isPublishButtonCandidate);

    // 1) xhs-publish-btn[is-publish="true"]
    const hosts = scoped(
      queryPublishButtonsBySelectors(root, [
        'xhs-publish-btn[is-publish="true"]',
        ...xhsSelectors.publishButtonNew,
      ]),
    );
    const hostBtn = pickClickableButton(hosts, false);
    if (hostBtn && isPublishHostClickable(hostBtn)) return hostBtn;

    // 2) button.ce-btn.bg-red（需文本二次过滤）
    const ceButtons = scoped(queryPublishButtonsBySelectors(root, xhsSelectors.publishButtonCe2026));
    const ceBtn = pickClickableButton(ceButtons, true);
    if (ceBtn && isPublishHostClickable(ceBtn)) return ceBtn;

    // 3) 旧版 .publish-page-publish-btn
    const legacy = scoped(
      queryPublishButtonsBySelectors(root, [
        ...xhsSelectors.publishButtonHost,
        ...xhsSelectors.publishButtonOld,
        ...xhsSelectors.submitButton,
      ]),
    );
    const legacyBtn = pickClickableButton(legacy, false);
    if (legacyBtn && isPublishHostClickable(legacyBtn)) return legacyBtn;

    // 4) 文本兜底：发布 / 立即发布
    const textFallback = scoped(
      queryPublishButtonsBySelectors(root, xhsSelectors.publishButtonTextFallback),
    ).filter((el) => isValidPublishButtonText(el) || isXhsPublishHost(el));
    const textBtn = pickClickableButton(textFallback, false);
    if (textBtn && isPublishHostClickable(textBtn)) return textBtn;
  }
  return null;
}

/** 是否达到可提交终态：最终表单 + 真正发布 Host + 不在文字配图草稿 */
function isReadyToSubmit(): boolean {
  if (isTextImageDraftActive()) return false;
  if (hasVisibleGenerateImageButton()) return false;
  return Boolean(findRealPublishButton() && hasRealFinalFormFields());
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
      hasFinalForm: hasRealFinalFormFields(),
      readyToSubmit: isReadyToSubmit(),
      hasGenerateButton: hasVisibleGenerateImageButton(),
    },
    editors: {
      draftTextLength: draftEditor ? getEditableText(draftEditor).length : 0,
      finalTextLength: finalEditor ? getEditableText(finalEditor).length : 0,
    },
    publishButtonHosts: collectPublishButtonHosts(),
    publishButtons: scanXhsPublishButtons().safeData,
    lastPublishHostInvoke,
  };
}

/** 发布成功强文案（不含易误判的裸「已发布」「笔记管理」） */
const PUBLISH_SUCCESS_STRONG_TEXT = /发布成功|笔记发布成功|发布审核中/;

/** 发布成功 URL 特征（含笔记管理页跳转） */
const PUBLISH_SUCCESS_URL_KEYWORDS = [
  'publish/success',
  'published=true',
  'content/manage',
  '/notes',
  'note/manage',
  'note-manager',
  '/success',
];

function currentPublishUrl(): string {
  return location.href.toLowerCase();
}

function isPublishSuccessUrl(url = currentPublishUrl()): boolean {
  return PUBLISH_SUCCESS_URL_KEYWORDS.some((kw) => url.includes(kw));
}

function hasStrongPublishSuccessText(scoped?: string, full?: string): boolean {
  const scopedText = scoped ?? publishPageText();
  const fullText = full ?? bodyText();
  return PUBLISH_SUCCESS_STRONG_TEXT.test(scopedText) || PUBLISH_SUCCESS_STRONG_TEXT.test(fullText);
}

/** 笔记管理列表页：URL 为 note-manager 且无最终发布表单 */
function isNoteManagerListPage(): boolean {
  const url = currentPublishUrl();
  if (!url.includes('note-manager')) return false;
  if (hasRealFinalFormFields()) return false;
  return true;
}

/** 综合判断是否处于发布成功态（排除列表页搜索框「已发布」子串误判） */
export function isPublishSuccessSignal(): boolean {
  if (isNoteManagerListPage()) return false;
  if (isPublishSuccessUrl()) {
    if (currentPublishUrl().includes('note-manager') && !hasStrongPublishSuccessText()) {
      return false;
    }
    return true;
  }
  return hasStrongPublishSuccessText();
}

/** 校验发布成功/失败（优先 publish-page 内文案，URL 跳转与 Toast 兜底） */
export async function verifyXhsPublishSuccess(timeout = 15000): Promise<ActionResult> {
  const failureTexts = ['发布失败', '提交失败', '内容违规', '请修改后再发布', '账号异常'];

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const scoped = publishPageText();
    const full = bodyText();
    const merged = `${scoped}\n${full}`;

    for (const failure of failureTexts) {
      if (merged.includes(failure)) {
        return {
          success: false,
          errorCode: 'SUBMIT_FAILED',
          message: `检测到发布失败信号：${failure}`,
        };
      }
    }

    if (isPublishSuccessSignal()) {
      if (isPublishSuccessUrl()) {
        return { success: true, message: '检测到 URL 跳转到作品管理页' };
      }
      return { success: true, message: '检测到发布成功信号' };
    }

    await sleep(500);
  }

  return {
    success: false,
    errorCode: 'SUBMIT_UNKNOWN',
    message: '点击发布后长时间未检测到成功或失败信号',
  };
}

/** 图片编辑/封面建议区域：仅在没有标题+正文编辑器时才算中间页 */
function isImageEditingPage(text: string): boolean {
  if (hasRealFinalFormFields()) return false;
  return isImageEditingStage(text);
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

/** 根据页面阻塞文案映射错误码 */
function errorCodeFromBlockers(blockers: string[]): ActionResult['errorCode'] {
  if (blockers.includes('频率限制')) return 'RATE_LIMITED';
  if (blockers.includes('安全验证')) return 'CAPTCHA_REQUIRED';
  return 'BLOCKED_BY_DIALOG';
}

/** 分块输入填写（防风控），替代整段粘贴 */
async function fillElementHuman(el: HTMLElement, text: string): Promise<void> {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await humanActionDelay();
  await typeHuman(el, text);
  await humanActionDelay();
}

/** 带节奏停顿的文本点击 */
async function humanClickByText(
  texts: string[],
  options: Parameters<typeof clickByText>[1] = {},
): Promise<ReturnType<typeof clickByText>> {
  await humanActionDelay();
  const res = await clickByText(texts, options);
  await humanActionDelay();
  return res;
}

function scorePublishCandidate(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const text = normalizeText(el.textContent ?? '');
  const tag = el.tagName.toLowerCase();
  let score = 0;
  // 新版 xhs-publish-btn 与旧版 .publish-page-publish-btn 是最可靠的发布按钮信号
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

/** 文本兜底匹配的发布按钮文案（严格排除定时发布、发布设置、侧栏菜单等） */
function isValidPublishButtonText(el: HTMLElement): boolean {
  if (isXhsPublishHost(el)) {
    return el.getAttribute('is-publish') === 'true';
  }
  const text = normalizeText(el.textContent ?? el.innerText ?? '');
  if (!text) return false;
  if (/定时发布|发布设置|发布失败|发布笔记/.test(text)) return false;
  if (/^(发布|立即发布|确认发布)$/.test(text)) return true;
  return text.includes('立即发布');
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

  // 3) 文本兜底：供诊断扫描
  pageRoot.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    if (!isValidPublishButtonText(el) && !isXhsPublishHost(el)) return;
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
 * 等待图片上传完成：预览数量达到期望值。
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
 * 移除发布页可能出现的引导/提示遮罩。
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

/** 切换到“上传图文”页签 */
export async function ensureXhsImageTextTab(): Promise<ActionResult> {
  return clickUploadImageTab();
}

/**
 * 逐张上传图片。首张使用 .upload-input，后续使用 input[type="file"]，每张上传后等待预览出现。
 */
export async function uploadXhsImagesSequentially(files: File[]): Promise<UploadResult> {
  await loadPublishPacingFromSettings();
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
  await humanClickByText(['上传图片', '上传图文'], {
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
    await humanImageUploadGap();
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
  if (isNoteManagerListPage()) return 'unknown';
  if (isPublishSuccessSignal()) return 'success';
  if (/发布失败|提交失败|内容违规|请修改后再发布|账号异常/.test(text)) return 'blocked';
  if (/验证码|安全验证|违规|不可发布|生成失败|上传失败/.test(text)) return 'blocked';
  if (/图片生成中|生成中|上传中|处理中|提交中/.test(text)) return 'image_generating';

  // 图片编辑视口：无真实最终表单时强制 image_editing
  if (isImageEditingStage(text) && !hasRealFinalFormFields()) {
    return 'image_editing';
  }

  // 真实最终表单：标题 placeholder + 正文 +（图片编辑阶段需 chrome/Host）
  if (hasRealFinalFormFields()) {
    return isReadyToSubmit() ? 'publish_button_ready' : 'final_form';
  }

  // 文字配图草稿优先于预览/编辑中间页
  if (isTextImageDraftActive()) {
    if (/选择一个喜欢的卡片|换配色/.test(text) && /下一步/.test(text)) return 'image_preview';
    if (findTextImageDraftEditor()) return 'text_image_editor';
  }

  // 卡片预览：无最终表单时才判定
  if (/选择一个喜欢的卡片|换配色/.test(text) && /下一步/.test(text)) {
    return 'image_preview';
  }

  // 图片编辑中间页兜底
  if (isImageEditingPage(text)) return 'image_editing';

  const uploadedCount = countXhsUploadedImages();
  if (uploadedCount > 0 && hasRealFinalFormFields()) {
    return isReadyToSubmit() ? 'publish_button_ready' : 'final_form';
  }

  if (isReadyToSubmit()) return 'publish_button_ready';
  if (hasRealFinalFormFields()) return 'final_form';

  if (/上传图片|文字配图/.test(text)) return 'image_entry';
  if (/上传视频/.test(text) && /上传图文/.test(text)) return 'video_tab';
  return 'unknown';
}

function fail(state: XhsPublishState, message: string, errorCode?: ActionResult['errorCode']): ActionResult {
  const diagnostics = collectDiagnostics(state);
  return {
    success: false,
    errorCode: errorCode ?? (state === 'blocked' ? errorCodeFromBlockers(detectXhsBlockers()) : 'PLATFORM_PAGE_CHANGED'),
    message: `${message}\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

/** 校验当前 content script 是否在可执行发布的主 frame（非 about:blank 子 frame） */
function ensureXhsPublishPageFrame(): PublishResult | null {
  if (location.href === 'about:blank' || location.protocol === 'about:') {
    return {
      success: false,
      errorCode: 'PLATFORM_PAGE_CHANGED',
      message:
        '当前运行在 about:blank 子 frame，无法识别发布页。请确保扩展在主 frame 执行 submit_publish（frameId:0）。',
      resultUrl: location.href,
    };
  }
  return null;
}

/** 笔记管理列表页无表单时导航回发布编辑页 */
async function navigateFromNoteManagerIfNeeded(): Promise<ActionResult | null> {
  if (!isNoteManagerListPage()) return null;
  window.location.href = XHS_URLS.publishUrl;
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await sleep(500);
    if (!isNoteManagerListPage()) return null;
    if (hasRealFinalFormFields() || detectXhsPublishState() !== 'unknown') return null;
  }
  return fail('unknown', '从笔记管理页导航至发布编辑页超时，请手动打开发布页后重试');
}

/**
 * 等待发布页就绪：上传组件容器出现，或“上传图文”页签已可见即可。
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
  await waitForUploadTabReady(10000);
  removePopCover();
  const res = await humanClickByText(['上传图文'], {
    exactText: true,
    tags: 'div.creator-tab,.creator-tab,button,div[role="button"],span',
    timeout: 8000,
  });
  if (!res.success) {
    // 可能被遮罩挡住，移除遮罩后再试一次。
    removePopCover();
    const retry = await humanClickByText(['上传图文'], {
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
  const res = await humanClickByText(['文字配图'], {
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

    await humanClickByText(['上传图片', '上传图文'], {
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

  const draftText = buildBodyText(ctx.content, false, false);
  editor.focus();
  await sleep(200);
  await fillElementHuman(editor, draftText);
  await humanFieldGap();
  await sleep(200);

  if (!verifyEditableContains(editor, draftText)) {
    const actual = getEditableText(editor);
    const normalizedProbe = draftText.trim().replace(/\s+/g, '').slice(0, 12);
    const lenOk = draftText.length > 0 && actual.length >= draftText.length * 0.8;
    const partialOk = normalizedProbe.length > 0 && actual.replace(/\s+/g, '').includes(normalizedProbe);
    if (!lenOk && !partialOk) {
      return {
        success: false,
        errorCode: 'FORM_NOT_READY',
        message: `文字配图草稿未写入成功，编辑器当前内容为空或不匹配。\n${formatDiagnostics(collectDiagnostics('text_image_editor'))}`,
      };
    }
  }

  const generate = await humanClickByText(['生成图片'], {
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

/** 点击「下一步」后等待标题框 + 正文编辑器出现 */
async function waitAfterClickNext(timeoutMs = 30000): Promise<ActionResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = detectXhsPublishState();
    if (state === 'final_form' || state === 'publish_button_ready') {
      return { success: true, message: '已进入最终发布表单' };
    }
    if (hasRealFinalFormFields()) {
      return { success: true, message: '已检测到标题框和正文编辑器' };
    }
    await sleep(800);
  }
  return fail('image_preview', '点击“下一步”后未检测到标题框和正文编辑器');
}

async function waitPreviewAndNext(): Promise<ActionResult> {
  const ok = await waitForText(['下一步', '选择一个喜欢的卡片'], 60000);
  if (!ok) return fail('image_generating', '等待图片生成完成超时');

  if (detectXhsPublishState() === 'text_image_editor') {
    return fail('image_generating', '仍在文字配图草稿页，图片尚未生成');
  }

  // 已在最终表单则无需再点下一步
  if (hasRealFinalFormFields()) {
    return { success: true, message: '当前已在最终发布表单' };
  }

  const next = await humanClickByText(['下一步'], {
    exactText: true,
    tags: 'button,div[role="button"],span,.d-button',
    timeout: 12000,
  });
  if (!next.success) return fail('image_preview', '未能点击“下一步”');

  return waitAfterClickNext(30000);
}

async function advanceFromImageEditingPage(): Promise<ActionResult> {
  const start = Date.now();
  const timeout = 60000;

  while (Date.now() - start < timeout) {
    if (hasAdvancedFromImageEditing()) {
      return { success: true, message: '图片编辑页已进入最终发布表单' };
    }

    await scrollXhsPublishContainersToBottom();

    const state = detectXhsPublishState();
    if (state === 'image_editing' || state === 'image_preview') {
      await humanClickByText(['下一步', '完成编辑', '继续'], {
        exactText: false,
        tags: 'button,div[role="button"],span,.d-button',
        timeout: 2000,
      });
    }

    await sleep(800);
  }

  return fail(
    'image_editing',
    '图片编辑页未出现真正的标题框和正文编辑器（请完成图片编辑或向下滚动）',
  );
}

/** 找不到发布按钮时 dump 全部候选，便于下次排错 */
function dumpPublishButtonCandidates(): Array<Record<string, unknown>> {
  const selectors = [
    'button',
    '[role="button"]',
    '[class*="btn"]',
    '[class*="button"]',
    '[class*="publish"]',
    '[class*="submit"]',
    '[class*="red"]',
    'xhs-publish-btn',
  ];
  const pageRoot = getPublishPageRoot();
  const seen = new Set<HTMLElement>();
  const items: Array<Record<string, unknown>> = [];

  for (const sel of selectors) {
    pageRoot.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      items.push({
        tagName: el.tagName.toLowerCase(),
        text: normalizeText(el.textContent ?? el.innerText ?? ''),
        className: String(el.className ?? ''),
        disabled: el instanceof HTMLButtonElement ? el.disabled : undefined,
        ariaDisabled: el.getAttribute('aria-disabled'),
        submitDisabled: el.getAttribute('submit-disabled'),
        isPublish: el.getAttribute('is-publish'),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visible: isElementVisibleInOwnFrame(el),
        usable: isButtonUsable(el),
      });
    });
  }

  return items.sort((a, b) => Number(b.visible) - Number(a.visible));
}

/**
 * 检查标题/正文是否超过平台长度上限。
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

  if (isImageEditingStage() && !hasRealFinalFormFields()) {
    return fail('image_editing', '仍在图片编辑页，尚未进入最终发布表单');
  }

  let titleEl: HTMLElement | null = null;
  if (ctx.content.title) {
    titleEl =
      findFinalTitleInput() ??
      (await waitForCandidate(
        { selectors: xhsSelectors.titleInput, visible: false, predicate: isFinalTitleInput },
        10000,
      ));
    if (!titleEl) {
      return fail('final_form', '未找到最终发布标题输入框（当前可能仍在图片编辑页）');
    }
    await fillElementHuman(titleEl, ctx.content.title);
    await humanFieldGap();
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
      (await waitForCandidate(
        { selectors: xhsSelectors.finalBodyEditor, visible: false, predicate: isFinalBodyEditor },
        10000,
      ));
    if (!contentEl) return fail('final_form', '未找到最终正文编辑器');
    await fillElementHuman(contentEl, body);
    await humanFieldGap();
    if (!verifyEditableContains(contentEl, body)) {
      return {
        success: false,
        errorCode: 'FORM_NOT_READY',
        message: '最终正文未写入成功，编辑器内容与预期不符',
      };
    }
  }

  // 填写正文后回点标题，增强后续标签输入稳定性
  if (titleEl) {
    simulateClick(titleEl);
    await humanFieldGap();
  }

  if (contentEl && ctx.content.hashtags?.length) {
    const tagResult = await inputXhsTags(contentEl, ctx.content.hashtags);
    if (!tagResult.success) return tagResult;
    await humanFieldGap();
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
  if (!hasRealFinalFormFields()) {
    const state = detectXhsPublishState();
    return fail(state, '尚未进入最终发布表单，无法等待发布按钮');
  }

  const start = Date.now();
  while (Date.now() - start < timeout) {
    await scrollXhsPublishContainersToBottom();
    if (isReadyToSubmit()) return { success: true, message: '发布按钮已就绪' };
    if (isImageEditingStage() && !hasRealFinalFormFields()) {
      return fail('image_editing', '滚动后仍在图片编辑视口，未找到最终表单');
    }
    if (!hasRealFinalFormFields()) {
      return fail(detectXhsPublishState(), '最终表单字段已消失');
    }
    const state = detectXhsPublishState();
    if (state === 'blocked') {
      return fail(state, '发布表单被平台提示阻塞', errorCodeFromBlockers(detectXhsBlockers()));
    }
    if (state === 'text_image_editor') {
      return fail(state, '仍在文字配图草稿页，尚未生成图片');
    }
    await sleep(1000);
  }
  return fail('final_form', '等待发布按钮就绪超时');
}

async function fillFinalFormAndWaitPublishReady(ctx: XhsPublishContext): Promise<ActionResult> {
  if (isImageEditingStage() && !hasRealFinalFormFields()) {
    const advanced = await advanceFromImageEditingPage();
    if (!advanced.success) return advanced;
  }
  const filled = await fillFinalForm(ctx);
  if (!filled.success) return filled;
  return scrollAndWaitPublishReady();
}

async function finishFillFlow(ctx: XhsPublishContext): Promise<ActionResult> {
  const stateBefore = detectXhsPublishState();
  if (stateBefore === 'success') {
    if (isPublishSuccessSignal()) {
      return {
        success: true,
        message: '已在发布成功或笔记管理页，跳过填写',
        data: getXhsPublishFlowDiagnostics(),
      };
    }
    return fail('unknown', '当前在笔记管理列表页，请重新打开发布页');
  }
  if (stateBefore === 'text_image_editor') {
    return fail(stateBefore, '填写流程结束时仍在文字配图草稿页，图片未生成');
  }
  if (stateBefore === 'image_editing') {
    const advanced = await advanceFromImageEditingPage();
    if (!advanced.success) return advanced;
  }
  if (!hasRealFinalFormFields()) {
    return fail(stateBefore, '填写流程结束时未检测到最终发布表单（标题+正文）');
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
  const frameError = ensureXhsPublishPageFrame();
  if (frameError) {
    return {
      success: false,
      errorCode: frameError.errorCode,
      message: frameError.message,
    };
  }

  const navError = await navigateFromNoteManagerIfNeeded();
  if (navError) return navError;

  await loadPublishPacingFromSettings();

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
    terminalStates: ['publish_button_ready', 'success'],
    blockedStates: ['login_wall', 'blocked'],
    maxTransitions: 20,
    getDelayMs: () => humanStateTransitionDelayMs(),
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
        description: '等待图片编辑页进入最终表单',
        run: advanceFromImageEditingPage,
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
  const frameError = ensureXhsPublishPageFrame();
  if (frameError) return frameError;

  await loadPublishPacingFromSettings();

  await scrollXhsPublishContainersToBottom();
  const ready = await scrollAndWaitPublishReady(12000);
  if (!ready.success) {
    return {
      success: false,
      errorCode: hasRealFinalFormFields() ? 'FORM_NOT_READY' : ready.errorCode,
      message: ready.message,
    };
  }

  const scan = scanXhsPublishButtons();
  if (scan.blockers.length) {
    return {
      success: false,
      errorCode: errorCodeFromBlockers(scan.blockers),
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
    const dumped = dumpPublishButtonCandidates();
    const diagnostics = collectDiagnostics(detectXhsPublishState());
    return {
      success: false,
      errorCode: hasRealFinalFormFields() ? 'BUTTON_NOT_FOUND' : 'FORM_NOT_READY',
      message: `表单字段已填写，但当前 frame 未找到可点击发布按钮。\n${formatDiagnostics(diagnostics)}\n候选按钮(${dumped.length}): ${JSON.stringify(dumped.slice(0, 30), null, 0)}`,
      resultUrl: location.href,
    };
  }

  button.scrollIntoView({ block: 'center', inline: 'center' });
  await scrollXhsPublishContainersToBottom();
  clickEmptyPosition();
  await humanPreSubmitDwell();
  clickXhsPublishElement(button);
  await tryDismissPublishConfirmDialog(3000);

  const submitted = await verifyXhsPublishSuccess(45000);
  if (submitted.success) {
    return {
      success: true,
      resultUrl: location.href,
      message: lastPublishHostInvoke?.invoked
        ? `发布已提交（Host.${lastPublishHostInvoke.method}）`
        : '发布已提交',
    };
  }

  const errorCode =
    submitted.errorCode === 'SUBMIT_FAILED'
      ? 'SUBMIT_FAILED'
      : submitted.errorCode === 'SUBMIT_UNKNOWN'
        ? 'SUBMIT_UNKNOWN'
        : 'CLICKED_BUT_NOT_PUBLISHED';

  return {
    success: false,
    errorCode,
    message: `${submitted.message ?? '发布未确认'}${lastPublishHostInvoke ? `\nHost调用: ${JSON.stringify(lastPublishHostInvoke)}` : ''}`,
    resultUrl: location.href,
  };
}

/** frame 定向点击发布按钮（配合 background all-frames fallback） */
export async function runXhsFramePublishClickFlow(): Promise<PublishResult> {
  await loadPublishPacingFromSettings();
  const scan = scanXhsPublishButtons();
  if (scan.blockers.length) {
    return {
      success: false,
      errorCode: errorCodeFromBlockers(scan.blockers),
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
  await scrollXhsPublishContainersToBottom();
  clickEmptyPosition();
  await humanPreSubmitDwell();
  clickXhsPublishElement(button);
  await tryDismissPublishConfirmDialog(3000);
  const submitted = await verifyXhsPublishSuccess(15000);
  if (submitted.success) {
    return { success: true, resultUrl: location.href, message: 'frame 内点击发布成功' };
  }
  const errorCode =
    submitted.errorCode === 'SUBMIT_FAILED'
      ? 'SUBMIT_FAILED'
      : submitted.errorCode === 'SUBMIT_UNKNOWN'
        ? 'SUBMIT_UNKNOWN'
        : 'CLICKED_BUT_NOT_PUBLISHED';
  return {
    success: false,
    errorCode,
    message: submitted.message,
    resultUrl: location.href,
  };
}

