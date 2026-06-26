import { describe, it, expect } from 'vitest';
import { createTaskPayloadSchema } from '@/schemas/messages';

describe('createTaskPayloadSchema', () => {
  it('AI 模式应要求非空 userInput', () => {
    const empty = createTaskPayloadSchema.safeParse({
      userInput: '',
      contentSource: 'ai',
    });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues.some((i) => i.path.includes('userInput'))).toBe(true);
    }
  });

  it('AI 模式应接受合法 payload 并默认 contentSource 为 ai', () => {
    const result = createTaskPayloadSchema.safeParse({
      userInput: '发一篇露营好物笔记',
      platform: 'xiaohongshu',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentSource).toBe('ai');
      expect(result.data.userInput).toBe('发一篇露营好物笔记');
    }
  });

  it('手动模式应保留 contentSource 与 manualContent', () => {
    const result = createTaskPayloadSchema.safeParse({
      contentSource: 'manual',
      userInput: '手动发布',
      manualContent: { title: '标题', body: '正文', hashtags: ['露营'] },
      platform: 'sohu',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentSource).toBe('manual');
      expect(result.data.manualContent).toEqual({
        title: '标题',
        body: '正文',
        hashtags: ['露营'],
      });
    }
  });

  it('手动模式缺少 manualContent 时应失败', () => {
    const result = createTaskPayloadSchema.safeParse({
      contentSource: 'manual',
      userInput: '手动发布',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('manualContent'))).toBe(true);
    }
  });

  it('手动模式文案无效时应失败', () => {
    const result = createTaskPayloadSchema.safeParse({
      contentSource: 'manual',
      userInput: '手动发布',
      manualContent: { title: '', body: '' },
    });
    expect(result.success).toBe(false);
  });
});
