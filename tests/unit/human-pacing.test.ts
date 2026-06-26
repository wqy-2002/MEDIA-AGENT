import { describe, expect, it, afterEach } from 'vitest';
import { applyTypingSafetyLevel } from '@/core/automation/typing-safety-presets';
import {
  chunkText,
  humanDelayRange,
  humanStepGap,
  randomInt,
  setPublishPacingOverride,
  DEFAULT_PUBLISH_PACING,
  typeHuman,
} from '@/core/automation/human-pacing';
describe('human-pacing', () => {
  afterEach(() => {
    setPublishPacingOverride(null);
  });

  it('randomInt 落在闭区间', () => {
    for (let i = 0; i < 50; i++) {
      const n = randomInt(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('chunkText 覆盖全文且无空块', () => {
    const text = '小红书发布防风控测试文本';
    const chunks = chunkText(text, 2, 4);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('节奏关闭时 humanDelayRange 为 0', () => {
    setPublishPacingOverride({ ...DEFAULT_PUBLISH_PACING, enabled: false });
    expect(humanDelayRange(1000, 5000)).toBe(0);
  });

  it('节奏开启时 humanDelayRange 在区间内', () => {
    setPublishPacingOverride({ ...DEFAULT_PUBLISH_PACING, enabled: true });
    const ms = humanDelayRange(100, 200);
    expect(ms).toBeGreaterThanOrEqual(100);
    expect(ms).toBeLessThanOrEqual(200);
  });

  it('humanStepGap 关闭时不等待', async () => {
    setPublishPacingOverride({ ...DEFAULT_PUBLISH_PACING, enabled: false });
    const ms = await humanStepGap({ publishPacing: { ...DEFAULT_PUBLISH_PACING, enabled: false } });
    expect(ms).toBe(0);
  });

  it('typeHuman 在 char 模式下逐字写入', async () => {
    const pacing = applyTypingSafetyLevel('ultra_safe', {
      ...DEFAULT_PUBLISH_PACING,
      enabled: true,
      charDelayMinMs: 0,
      charDelayMaxMs: 0,
      thinkingPauseEveryMinChars: 0,
      thinkingPauseEveryMaxChars: 0,
      thinkingPauseMinMs: 0,
      thinkingPauseMaxMs: 0,
    });
    setPublishPacingOverride(pacing);

    const input = document.createElement('input');
    document.body.appendChild(input);
    await typeHuman(input, '测');
    expect(input.value).toBe('测');
    document.body.removeChild(input);
  });

  it('typeHuman 应清空 contenteditable 占位后再写入', async () => {
    const pacing = applyTypingSafetyLevel('ultra_safe', {
      ...DEFAULT_PUBLISH_PACING,
      enabled: true,
      charDelayMinMs: 0,
      charDelayMaxMs: 0,
      thinkingPauseEveryMinChars: 0,
      thinkingPauseEveryMaxChars: 0,
      thinkingPauseMinMs: 0,
      thinkingPauseMaxMs: 0,
    });
    setPublishPacingOverride(pacing);

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = '写文字';
    document.body.appendChild(editor);
    await typeHuman(editor, '好物正文');
    expect(editor.textContent).toBe('好物正文');
    document.body.removeChild(editor);
  });
});
