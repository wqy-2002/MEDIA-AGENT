import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLISH_PACING } from '@/core/automation/human-pacing';
import {
  applyTypingSafetyLevel,
  TYPING_SAFETY_PRESETS,
} from '@/core/automation/typing-safety-presets';
import type { TypingSafetyLevel } from '@/types';

describe('typing-safety-presets', () => {
  it('四档预设均含 typingMode', () => {
    const levels: TypingSafetyLevel[] = ['fast', 'balanced', 'safe', 'ultra_safe'];
    for (const level of levels) {
      expect(TYPING_SAFETY_PRESETS[level].typingMode).toBeDefined();
    }
  });

  it('ultra_safe 为逐字模式并启用思考停顿', () => {
    const preset = TYPING_SAFETY_PRESETS.ultra_safe;
    expect(preset.typingMode).toBe('char');
    expect(preset.thinkingPauseEveryMinChars).toBeGreaterThan(0);
    expect(preset.charDelayMinMs).toBe(120);
    expect(preset.charDelayMaxMs).toBe(280);
  });

  it('applyTypingSafetyLevel 保留非输入类字段', () => {
    const merged = applyTypingSafetyLevel('fast', DEFAULT_PUBLISH_PACING);
    expect(merged.typingSafetyLevel).toBe('fast');
    expect(merged.typingMode).toBe('chunked');
    expect(merged.stepGapMinMs).toBe(DEFAULT_PUBLISH_PACING.stepGapMinMs);
    expect(merged.chunkMinChars).toBe(4);
  });

  it('默认 pacing 为 ultra_safe', () => {
    expect(DEFAULT_PUBLISH_PACING.typingSafetyLevel).toBe('ultra_safe');
    expect(DEFAULT_PUBLISH_PACING.typingMode).toBe('char');
  });
});
