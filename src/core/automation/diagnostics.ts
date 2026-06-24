import type { AutomationDiagnostics, ElementCandidate } from '@/types';
import { deepQueryAll, isVisible } from '@/utils/dom';

// 自动化诊断：失败时输出真实 DOM 候选、滚动容器、弹窗/Toast 与阻塞原因。

function cleanText(text: string | null | undefined, limit = 80): string | undefined {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function getRect(el: HTMLElement): ElementCandidate['rect'] {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** 生成便于日志阅读的元素诊断信息 */
export function describeElement(el: Element | null, selector?: string): ElementCandidate | undefined {
  if (!el || !(el instanceof HTMLElement)) return undefined;
  const anyEl = el as HTMLInputElement | HTMLTextAreaElement;
  return {
    tag: el.tagName.toLowerCase(),
    selector,
    id: el.id || undefined,
    className: typeof el.className === 'string' ? cleanText(el.className, 120) : undefined,
    role: el.getAttribute('role') || undefined,
    text: cleanText(el.textContent),
    placeholder: el.getAttribute('placeholder') || undefined,
    value: 'value' in anyEl ? cleanText(anyEl.value, 80) : undefined,
    disabled:
      (el instanceof HTMLButtonElement && el.disabled) ||
      el.getAttribute('aria-disabled') === 'true' ||
      /\b(disabled|is-disabled|--disabled)\b/i.test(String(el.className)),
    visible: isVisible(el),
    rect: getRect(el),
  };
}

function uniqueByRectAndText(candidates: ElementCandidate[]): ElementCandidate[] {
  const seen = new Set<string>();
  const result: ElementCandidate[] = [];
  for (const item of candidates) {
    const rect = item.rect;
    const key = `${item.tag}|${item.text ?? ''}|${item.placeholder ?? ''}|${rect?.x}:${rect?.y}:${rect?.width}:${rect?.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collect(selector: string, limit: number, visibleOnly = false): ElementCandidate[] {
  const items = deepQueryAll<HTMLElement>(selector)
    .map((el) => describeElement(el, selector))
    .filter((x): x is ElementCandidate => Boolean(x))
    .filter((x) => !visibleOnly || x.visible)
    .sort((a, b) => {
      const av = a.visible ? 0 : 1;
      const bv = b.visible ? 0 : 1;
      if (av !== bv) return av - bv;
      return (a.text?.length ?? 0) - (b.text?.length ?? 0);
    });
  return uniqueByRectAndText(items).slice(0, limit);
}

/** 收集可滚动容器，用于定位按钮是否在内部滚动区底部 */
function collectScrollContainers(): ElementCandidate[] {
  return deepQueryAll<HTMLElement>('*')
    .filter((el) => el.scrollHeight > el.clientHeight + 8 || el.scrollWidth > el.clientWidth + 8)
    .map((el) => describeElement(el, 'scrollable'))
    .filter((x): x is ElementCandidate => Boolean(x))
    .filter((x) => x.visible)
    .slice(0, 12);
}

/** 根据页面文本和候选元素推断阻塞原因 */
function detectBlockers(): string[] {
  const text = document.body.innerText || '';
  const blockers: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/验证码|安全验证|扫码|短信登录|发送验证码/, '需要登录或安全验证'],
    [/生成中|图片生成中|上传中|处理中|转码中/, '页面仍在生成或上传处理中'],
    [/请填写|不能为空|必填|请选择/, '表单存在未完成的必填项'],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) blockers.push(label);
  }
  const feedbackText = collect('[role="dialog"],.d-modal,.d-popover,.modal,.dialog,.toast,.d-toast,.message,.notification,[class*="toast"],[class*="message"]', 12, true)
    .map((x) => x.text ?? '')
    .join('\n');
  if (/失败|错误|不可发布|不可操作|操作频繁|请稍后|违规|审核不通过/.test(feedbackText)) {
    blockers.push('页面出现失败或合规阻塞提示');
  }
  const disabledButtons = collect('button,[role="button"],.d-button', 20, true).filter((x) => x.disabled);
  const blockingDisabled = disabledButtons.filter((x) => /发布|提交|确认|发送/.test(x.text ?? ''));
  // disabled 按钮常见于页面上的无关输入区，仅在同时出现表单/失败提示时才视为阻塞。
  if (blockingDisabled.length && /请填写|不能为空|必填|失败|错误|不可/.test(`${text}\n${feedbackText}`)) {
    blockers.push(`存在 ${blockingDisabled.length} 个关键 disabled 按钮`);
  }
  return blockers;
}

/** 采集当前页面的完整自动化诊断 */
export function collectDiagnostics(state = 'unknown'): AutomationDiagnostics {
  const activeElement = describeElement(document.activeElement);
  return {
    state,
    url: location.href,
    title: document.title,
    candidates: {
      inputs: collect('input,textarea', 12, true),
      editables: collect('[contenteditable="true"],[role="textbox"],.ProseMirror,.tiptap', 10, true),
      buttons: collect('button,[role="button"],.d-button,a', 24, true),
      scrollContainers: collectScrollContainers(),
      dialogs: collect('[role="dialog"],.d-modal,.d-popover,.modal,.dialog', 8, true),
      toasts: collect('.toast,.d-toast,.message,.notification,[class*="toast"],[class*="message"]', 8, true),
    },
    blockers: detectBlockers(),
    activeElement,
    rawText: cleanText(document.body.innerText, 1000),
    capturedAt: Date.now(),
  };
}

/** 将诊断压缩成适合任务日志的一段文本 */
export function formatDiagnostics(diag: AutomationDiagnostics): string {
  const list = (items: ElementCandidate[]) =>
    items
      .map((x) => {
        const cls = x.className ? `.${x.className.split(/\s+/).slice(0, 2).join('.')}` : '';
        const text = x.text ? ` "${x.text}"` : '';
        const ph = x.placeholder ? ` ph="${x.placeholder}"` : '';
        const role = x.role ? ` role=${x.role}` : '';
        const dis = x.disabled ? ' disabled' : '';
        const rect = x.rect ? ` @${x.rect.x},${x.rect.y},${x.rect.width}x${x.rect.height}` : '';
        return `${x.tag}${cls}${role}${ph}${text}${dis}${rect}`;
      })
      .join(' | ') || '无';

  return [
    `状态: ${diag.state}`,
    `URL: ${diag.url}`,
    `阻塞: ${diag.blockers.join('；') || '无'}`,
    `输入框(${diag.candidates.inputs.length}): ${list(diag.candidates.inputs)}`,
    `可编辑区(${diag.candidates.editables.length}): ${list(diag.candidates.editables)}`,
    `按钮(${diag.candidates.buttons.length}): ${list(diag.candidates.buttons)}`,
    `滚动容器(${diag.candidates.scrollContainers.length}): ${list(diag.candidates.scrollContainers)}`,
    `弹窗(${diag.candidates.dialogs.length}): ${list(diag.candidates.dialogs)}`,
    `Toast(${diag.candidates.toasts.length}): ${list(diag.candidates.toasts)}`,
  ].join('\n');
}

