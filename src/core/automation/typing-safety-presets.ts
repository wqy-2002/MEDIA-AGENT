import type { PublishPacingConfig, TypingSafetyLevel } from '@/types';

/** 各安全等级对应的文本填入参数（仅覆盖输入相关字段） */
export const TYPING_SAFETY_PRESETS: Record<TypingSafetyLevel, Partial<PublishPacingConfig>> = {
  fast: {
    typingMode: 'chunked',
    chunkMinChars: 4,
    chunkMaxChars: 10,
    chunkDelayMinMs: 40,
    chunkDelayMaxMs: 100,
    charDelayMinMs: 30,
    charDelayMaxMs: 80,
    fieldGapMinMs: 300,
    fieldGapMaxMs: 600,
    thinkingPauseEveryMinChars: 0,
    thinkingPauseEveryMaxChars: 0,
    thinkingPauseMinMs: 0,
    thinkingPauseMaxMs: 0,
  },
  balanced: {
    typingMode: 'chunked',
    chunkMinChars: 2,
    chunkMaxChars: 6,
    chunkDelayMinMs: 80,
    chunkDelayMaxMs: 220,
    charDelayMinMs: 40,
    charDelayMaxMs: 120,
    fieldGapMinMs: 500,
    fieldGapMaxMs: 1000,
    thinkingPauseEveryMinChars: 0,
    thinkingPauseEveryMaxChars: 0,
    thinkingPauseMinMs: 0,
    thinkingPauseMaxMs: 0,
  },
  safe: {
    typingMode: 'chunked',
    chunkMinChars: 1,
    chunkMaxChars: 2,
    chunkDelayMinMs: 150,
    chunkDelayMaxMs: 350,
    charDelayMinMs: 80,
    charDelayMaxMs: 180,
    fieldGapMinMs: 1000,
    fieldGapMaxMs: 2500,
    thinkingPauseEveryMinChars: 0,
    thinkingPauseEveryMaxChars: 0,
    thinkingPauseMinMs: 0,
    thinkingPauseMaxMs: 0,
  },
  ultra_safe: {
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
};

const TYPING_SAFETY_LABELS: Record<TypingSafetyLevel, string> = {
  fast: '快速',
  balanced: '平衡',
  safe: '安全',
  ultra_safe: '极安全',
};

export function getTypingSafetyLabel(level: TypingSafetyLevel): string {
  return TYPING_SAFETY_LABELS[level];
}

/** 将安全等级预设合并到 pacing，保留非输入类字段 */
export function applyTypingSafetyLevel(
  level: TypingSafetyLevel,
  base: PublishPacingConfig,
): PublishPacingConfig {
  const preset = TYPING_SAFETY_PRESETS[level];
  return {
    ...base,
    ...preset,
    typingSafetyLevel: level,
  };
}
