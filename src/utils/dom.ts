/** 延时 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断元素是否真正可见。
 * 注意：不能用 offsetParent，因为 position:fixed 的元素 offsetParent 恒为 null 却可见。
 * 这里用 getComputedStyle + getBoundingClientRect 综合判断。
 */
export function isVisible(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity !== '' && Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // 小红书等平台会保留离屏克隆节点（如 x/y 为 -9999 的 tab），不能视作可点击元素
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  return true;
}

/**
 * 深度查询：在 document 及所有「开放的 Shadow DOM」中查找匹配 selector 的元素。
 * 很多平台用 Web Component / Shadow DOM，普通 querySelector 查不到。
 */
export function deepQueryAll<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  const results: T[] = [];
  const visit = (root: Document | ShadowRoot) => {
    root.querySelectorAll<T>(selector).forEach((el) => results.push(el));
    // 递归进入所有带 shadowRoot 的元素
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) visit(sr);
    });
  };
  try {
    visit(document);
  } catch {
    // 某些节点访问受限，忽略
  }
  return results;
}

/** 深度查询第一个元素（含 Shadow DOM） */
export function deepQuery<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  // 优先走原生查询（快），不行再深度查询
  const direct = document.querySelector<T>(selector);
  if (direct) return direct;
  return deepQueryAll<T>(selector)[0] ?? null;
}

/**
 * 等待匹配 selectors 任意一个的元素出现。
 * @param selectors 选择器列表（按优先级）
 * @param options.timeout 超时毫秒
 * @param options.visible 是否要求元素可见（默认 true；查找隐藏的 file input 时传 false）
 * @param options.deep 是否深入 Shadow DOM 查找（默认 true）
 */
export async function waitForElement<T extends HTMLElement = HTMLElement>(
  selectors: string[],
  options: { timeout?: number; visible?: boolean; deep?: boolean } = {},
): Promise<T | null> {
  const { timeout = 15000, visible = true, deep = true } = options;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const candidates = deep
        ? deepQueryAll<T>(sel)
        : Array.from(document.querySelectorAll<T>(sel));
      for (const el of candidates) {
        if (!visible || isVisible(el)) return el;
      }
    }
    await sleep(300);
  }
  return null;
}

/** 在多个选择器中查找第一个元素（不等待，含 Shadow DOM） */
export function queryFirst<T extends HTMLElement = HTMLElement>(
  selectors: string[],
  options: { visible?: boolean } = {},
): T | null {
  for (const sel of selectors) {
    const candidates = deepQueryAll<T>(sel);
    for (const el of candidates) {
      if (!options.visible || isVisible(el)) return el;
    }
  }
  return null;
}

/**
 * 设置 input / textarea 的值并触发 React 等框架监听的事件。
 * 直接赋值 value 不会触发 React 的 onChange，需要用原生 setter。
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 读取可编辑元素的文本内容 */
export function getEditableText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return (el.innerText || el.textContent || '').trim();
}

/**
 * 向 contenteditable 元素输入文本（小红书等正文常用富文本编辑器）。
 */
export function setContentEditable(el: HTMLElement, text: string): void {
  el.focus();
  // 优先使用 execCommand 模拟真实输入，兼容富文本编辑器
  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('insertText', false, text);
  } catch {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}

/**
 * 兼容 Tiptap/ProseMirror：先尝试粘贴，再 execCommand，最后逐字符写入。
 */
export async function fillRichTextEditor(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  await sleep(80);

  const probe = text.trim().slice(0, Math.min(12, text.trim().length));
  const containsProbe = (value: string) => Boolean(probe && value.includes(probe));

  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
    await sleep(120);
    if (containsProbe(getEditableText(el))) return;
  } catch {
    // 部分环境不支持构造 ClipboardEvent，继续走后续策略。
  }

  setContentEditable(el, text);
  await sleep(120);
  if (containsProbe(getEditableText(el))) return;

  for (const char of text) {
    try {
      document.execCommand('insertText', false, char);
    } catch {
      el.textContent = (el.textContent ?? '') + char;
    }
    await sleep(8);
  }
}

/** Quill 编辑器填写：优先 paste 事件，回退 execCommand */
export async function fillQuillEditor(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  await sleep(80);

  const probe = text.trim().slice(0, Math.min(12, text.trim().length));
  const containsProbe = (value: string) => Boolean(probe && value.includes(probe));

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // 选区失败时继续尝试粘贴
  }

  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    dt.setData('text/html', `<p>${text.replace(/\n/g, '</p><p>')}</p>`);
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
    await sleep(150);
    if (containsProbe(getEditableText(el))) return;
  } catch {
    // 部分环境不支持 ClipboardEvent
  }

  setContentEditable(el, text);
  await sleep(120);
  if (containsProbe(getEditableText(el))) return;

  for (const char of text) {
    try {
      document.execCommand('insertText', false, char);
    } catch {
      el.textContent = `${el.textContent ?? ''}${char}`;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
    await sleep(20);
  }
}

/** 更可靠的点击：合成事件 + 原生 click + 元素中心坐标兜底 */
export function reliableClick(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  simulateClick(el);
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  if (target && target !== el && !el.contains(target)) {
    simulateClick(target);
  }
}

/** 模拟一次完整的鼠标点击 */
export function simulateClick(el: HTMLElement): void {
  const opts = { bubbles: true, cancelable: true, view: window } as MouseEventInit;
  const pointerOpts = { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true } as PointerEventInit;
  if (typeof PointerEvent !== 'undefined') {
    el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  }
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  if (typeof PointerEvent !== 'undefined') {
    el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
  }
  // 部分站点只监听 HTMLElement.click 触发的 click 路径。
  el.click();
}

/**
 * 通过文本内容匹配元素（找不到稳定 selector 时的兜底）。
 * 支持传入多个 tag（如 'button,a,div[role=button]'），并优先返回可见元素。
 */
export function findByText<T extends HTMLElement = HTMLElement>(
  tag: string,
  text: string,
): T | null {
  const target = text.replace(/\s/g, '');
  const nodes = tag.split(',').flatMap((t) => deepQueryAll<T>(t.trim()));
  const matched = nodes.filter((n) =>
    (n.textContent ?? '').replace(/\s/g, '').includes(target),
  );
  // 优先可见、且文本最短（更可能是按钮本身而非容器）的元素
  matched.sort((a, b) => {
    const va = isVisible(a) ? 0 : 1;
    const vb = isVisible(b) ? 0 : 1;
    if (va !== vb) return va - vb;
    return (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0);
  });
  return matched[0] ?? null;
}

/**
 * 诊断：汇总页面上的候选输入框 / 可编辑区 / 按钮，便于排查选择器失配。
 * 返回精简字符串，会写入任务日志供人工查看。
 */
export function describePageCandidates(): string {
  const trunc = (s: string, n = 30) => (s.length > n ? s.slice(0, n) + '…' : s);
  const describe = (el: HTMLElement): string => {
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const ph = el.getAttribute('placeholder');
    const role = el.getAttribute('role');
    const txt = (el.textContent ?? '').trim();
    const parts = [tag + cls];
    if (ph) parts.push(`ph="${trunc(ph)}"`);
    if (role) parts.push(`role=${role}`);
    if (!ph && txt && (tag === 'button' || tag === 'a' || role === 'button')) {
      parts.push(`"${trunc(txt)}"`);
    }
    return parts.join(' ');
  };

  const inputs = deepQueryAll('input,textarea').filter(isVisible).slice(0, 8);
  const editables = deepQueryAll('[contenteditable="true"]').filter(isVisible).slice(0, 5);
  const buttons = deepQueryAll('button,[role="button"]').filter(isVisible).slice(0, 12);
  const fileInputs = deepQueryAll('input[type="file"]');

  return [
    `URL: ${location.href}`,
    `输入框(${inputs.length}): ${inputs.map(describe).join(' | ') || '无'}`,
    `可编辑区(${editables.length}): ${editables.map(describe).join(' | ') || '无'}`,
    `文件框(${fileInputs.length}): ${fileInputs.length ? '存在' : '无'}`,
    `按钮(${buttons.length}): ${buttons.map(describe).join(' | ') || '无'}`,
  ].join('\n');
}

/** 将 base64 dataUrl 转为 File 对象 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, base64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/**
 * 把文件注入到 <input type="file"> 并触发 change 事件，
 * 用于模拟用户选择文件上传。
 */
export function injectFiles(input: HTMLInputElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
