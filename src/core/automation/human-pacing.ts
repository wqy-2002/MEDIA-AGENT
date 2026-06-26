import type { AppSettings, PublishPacingConfig } from '@/types';
import { applyTypingSafetyLevel } from '@/core/automation/typing-safety-presets';
import { clearEditableContent, setNativeValue, sleep } from '@/utils/dom';

/** 非文本填入类的基础节奏参数 */
const BASE_PUBLISH_PACING: Omit<
  PublishPacingConfig,
  | 'typingSafetyLevel'
  | 'typingMode'
  | 'charDelayMinMs'
  | 'charDelayMaxMs'
  | 'fieldGapMinMs'
  | 'fieldGapMaxMs'
  | 'thinkingPauseEveryMinChars'
  | 'thinkingPauseEveryMaxChars'
  | 'thinkingPauseMinMs'
  | 'thinkingPauseMaxMs'
  | 'chunkMinChars'
  | 'chunkMaxChars'
  | 'chunkDelayMinMs'
  | 'chunkDelayMaxMs'
> = {
  enabled: true,
  stepGapMinMs: 8000,
  stepGapMaxMs: 20000,
  stateTransitionMinMs: 1500,
  stateTransitionMaxMs: 4000,
  actionDelayMinMs: 400,
  actionDelayMaxMs: 1200,
  preSubmitMinMs: 4000,
  preSubmitMaxMs: 10000,
  imageUploadGapMinMs: 2500,
  imageUploadGapMaxMs: 6000,
};

/** 发布防风控节奏默认配置（极安全逐字输入） */
export const DEFAULT_PUBLISH_PACING: PublishPacingConfig = applyTypingSafetyLevel(
  'ultra_safe',
  {
    ...BASE_PUBLISH_PACING,
    typingSafetyLevel: 'ultra_safe',
    typingMode: 'char',
    chunkMinChars: 1,
    chunkMaxChars: 1,
    chunkDelayMinMs: 120,
    chunkDelayMaxMs: 280,
    charDelayMinMs: 120,
    charDelayMaxMs: 280,
    fieldGapMinMs: 2000,
    fieldGapMaxMs: 5000,
    thinkingPauseEveryMinChars: 20,
    thinkingPauseEveryMaxChars: 40,
    thinkingPauseMinMs: 800,
    thinkingPauseMaxMs: 2000,
  },
);

let pacingOverride: PublishPacingConfig | null = null;

/** 测试或调试时覆盖节奏配置 */
export function setPublishPacingOverride(pacing: PublishPacingConfig | null): void {
  pacingOverride = pacing;
}

export function getPublishPacing(): PublishPacingConfig {
  return pacingOverride ?? DEFAULT_PUBLISH_PACING;
}

/** 从 chrome.storage 加载用户设置中的节奏配置 */
export async function loadPublishPacingFromSettings(): Promise<PublishPacingConfig> {
  try {
    const { getSettings } = await import('@/core/storage/settings');
    const settings = await getSettings();
    const level = settings.publishPacing.typingSafetyLevel ?? 'ultra_safe';
    pacingOverride = applyTypingSafetyLevel(level, settings.publishPacing);
    return pacingOverride;
  } catch {
    return getPublishPacing();
  }
}

export function randomInt(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/** 在区间内取随机毫秒数；节奏关闭时返回 0 */
export function humanDelayRange(minMs: number, maxMs: number): number {
  if (!getPublishPacing().enabled) return 0;
  return randomInt(minMs, maxMs);
}

export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = humanDelayRange(minMs, maxMs);
  if (ms > 0) await sleep(ms);
}

/** Executor 大步骤间停顿 */
export async function humanStepGap(settings?: Pick<AppSettings, 'publishPacing'>): Promise<number> {
  const pacing = settings?.publishPacing ?? getPublishPacing();
  if (!pacing.enabled) return 0;
  const ms = randomInt(pacing.stepGapMinMs, pacing.stepGapMaxMs);
  if (ms > 0) await sleep(ms);
  return ms;
}

/** 标题/正文/标签字段切换间停顿 */
export async function humanFieldGap(): Promise<number> {
  const pacing = getPublishPacing();
  if (!pacing.enabled) return 0;
  const ms = humanDelayRange(pacing.fieldGapMinMs, pacing.fieldGapMaxMs);
  if (ms > 0) await sleep(ms);
  return ms;
}

/** 将文本切成随机长度块，用于分块输入 */
export function chunkText(text: string, minChunk: number, maxChunk: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const size = randomInt(minChunk, maxChunk);
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

function thinkingPauseEnabled(pacing: PublishPacingConfig): boolean {
  return (
    pacing.thinkingPauseEveryMinChars > 0 &&
    pacing.thinkingPauseEveryMaxChars > 0 &&
    pacing.thinkingPauseMinMs > 0
  );
}

function insertTextFragment(el: HTMLElement, fragment: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, `${el.value}${fragment}`);
  } else {
    try {
      document.execCommand('insertText', false, fragment);
    } catch {
      el.textContent = `${el.textContent ?? ''}${fragment}`;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: fragment }));
  }
}

function isEditableField(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true'
  );
}

/** 防风控输入前清空占位/旧文，避免逐字追加到「写文字」等默认文案上 */
async function prepareEditableForTyping(el: HTMLElement): Promise<void> {
  if (!isEditableField(el)) return;
  clearEditableContent(el);
  await sleep(40);
}

/** 逐字输入，含可选思考停顿 */
export async function typeCharByCharHuman(el: HTMLElement, text: string): Promise<void> {
  const pacing = getPublishPacing();
  await prepareEditableForTyping(el);
  el.focus();

  const useThinking = thinkingPauseEnabled(pacing);
  let charsSincePause = 0;
  let nextPauseAt = useThinking
    ? randomInt(pacing.thinkingPauseEveryMinChars, pacing.thinkingPauseEveryMaxChars)
    : 0;

  for (const char of text) {
    insertTextFragment(el, char);
    await humanDelay(pacing.charDelayMinMs, pacing.charDelayMaxMs);

    if (useThinking) {
      charsSincePause += 1;
      if (charsSincePause >= nextPauseAt) {
        await humanDelay(pacing.thinkingPauseMinMs, pacing.thinkingPauseMaxMs);
        charsSincePause = 0;
        nextPauseAt = randomInt(
          pacing.thinkingPauseEveryMinChars,
          pacing.thinkingPauseEveryMaxChars,
        );
      }
    }
  }
}

export interface TypeChunkedOptions {
  chunkMinChars?: number;
  chunkMaxChars?: number;
  chunkDelayMinMs?: number;
  chunkDelayMaxMs?: number;
}

/** 分块输入文本，块间随机停顿 */
export async function typeChunked(
  el: HTMLElement,
  text: string,
  opts: TypeChunkedOptions = {},
): Promise<void> {
  const pacing = getPublishPacing();
  if (!pacing.enabled) {
    const { fillElement } = await import('@/core/automation/dom-driver');
    await fillElement(el, text);
    return;
  }

  const chunkMin = opts.chunkMinChars ?? pacing.chunkMinChars;
  const chunkMax = opts.chunkMaxChars ?? pacing.chunkMaxChars;
  const delayMin = opts.chunkDelayMinMs ?? pacing.chunkDelayMinMs;
  const delayMax = opts.chunkDelayMaxMs ?? pacing.chunkDelayMaxMs;

  await prepareEditableForTyping(el);
  el.focus();
  const chunks = chunkText(text, chunkMin, chunkMax);
  for (let i = 0; i < chunks.length; i++) {
    insertTextFragment(el, chunks[i]);
    if (i < chunks.length - 1) {
      await humanDelay(delayMin, delayMax);
    }
  }
}

/** 按安全等级选择分块或逐字输入 */
export async function typeHuman(el: HTMLElement, text: string): Promise<void> {
  const pacing = getPublishPacing();
  if (!pacing.enabled) {
    const { fillElement } = await import('@/core/automation/dom-driver');
    await fillElement(el, text);
    return;
  }
  if (pacing.typingMode === 'char') {
    await typeCharByCharHuman(el, text);
  } else {
    await typeChunked(el, text);
  }
}

/** 话题标签等短文本逐字输入的单字延时 */
export function getCharDelayMs(): number {
  const pacing = getPublishPacing();
  if (!pacing.enabled) return 50;
  return randomInt(pacing.charDelayMinMs, pacing.charDelayMaxMs);
}

export async function humanActionDelay(): Promise<void> {
  const pacing = getPublishPacing();
  await humanDelay(pacing.actionDelayMinMs, pacing.actionDelayMaxMs);
}

/** 状态机步间延迟毫秒数（不含 sleep，由 state-machine 统一 sleep） */
export function humanStateTransitionDelayMs(): number {
  const pacing = getPublishPacing();
  if (!pacing.enabled) return 300;
  return randomInt(pacing.stateTransitionMinMs, pacing.stateTransitionMaxMs);
}

export async function humanPreSubmitDwell(): Promise<number> {
  const pacing = getPublishPacing();
  const ms = humanDelayRange(pacing.preSubmitMinMs, pacing.preSubmitMaxMs);
  if (ms > 0) await sleep(ms);
  return ms;
}

export async function humanImageUploadGap(): Promise<void> {
  const pacing = getPublishPacing();
  await humanDelay(pacing.imageUploadGapMinMs, pacing.imageUploadGapMaxMs);
}
