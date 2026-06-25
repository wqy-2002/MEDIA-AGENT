import type { ActionResult } from '@/types';
import { collectDiagnostics, formatDiagnostics } from './diagnostics';
import { sleep } from '@/utils/dom';

export interface VerifyOptions {
  timeout?: number;
  interval?: number;
  state?: string;
}

/** 等待条件成立 */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: VerifyOptions = {},
): Promise<boolean> {
  const timeout = options.timeout ?? 15000;
  const interval = options.interval ?? 500;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return true;
    await sleep(interval);
  }
  return false;
}

/** 等待页面出现任一文本 */
export async function verifyTextAppears(texts: string[], options: VerifyOptions = {}): Promise<ActionResult> {
  const ok = await waitUntil(
    () => {
      const text = document.body.innerText || '';
      return texts.some((target) => text.includes(target));
    },
    options,
  );
  if (ok) return { success: true, message: `检测到文本: ${texts.join(' / ')}` };
  const diagnostics = collectDiagnostics(options.state ?? 'verify_text_timeout');
  return {
    success: false,
    errorCode: 'RESULT_VERIFY_FAILED',
    message: `未检测到预期文本: ${texts.join(' / ')}\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

/** 验证元素 class/aria/text 是否发生变化 */
export async function verifyElementChanged(
  before: string,
  getAfter: () => string | undefined,
  options: VerifyOptions = {},
): Promise<ActionResult> {
  const ok = await waitUntil(() => {
    const after = getAfter();
    return Boolean(after && after !== before);
  }, options);
  if (ok) return { success: true, message: '元素状态已变化' };
  const diagnostics = collectDiagnostics(options.state ?? 'verify_element_change_timeout');
  return {
    success: false,
    errorCode: 'RESULT_VERIFY_FAILED',
    message: `元素状态未变化。\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

/** 等待 URL 变化 */
export async function verifyUrlChanged(before: string, options: VerifyOptions = {}): Promise<ActionResult> {
  const ok = await waitUntil(() => location.href !== before, options);
  if (ok) return { success: true, message: `URL 已变化: ${location.href}`, data: { url: location.href } };
  const diagnostics = collectDiagnostics(options.state ?? 'verify_url_timeout');
  return {
    success: false,
    errorCode: 'RESULT_VERIFY_FAILED',
    message: `URL 未变化。\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  };
}

