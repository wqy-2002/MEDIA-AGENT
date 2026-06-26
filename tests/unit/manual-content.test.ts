import { describe, it, expect } from 'vitest';
import {
  MANUAL_BODY_MAX_LENGTH,
  MANUAL_HASHTAG_MAX_COUNT,
  MANUAL_TITLE_MAX_LENGTH,
  normalizeManualContent,
  parseHashtagInput,
  validateManualContent,
} from '@/schemas/manual-content';

describe('manual-content', () => {
  describe('validateManualContent', () => {
    it('标题或正文至少一项非空', () => {
      expect(() => validateManualContent({})).toThrow();
      expect(() => validateManualContent({ title: '  ', body: '' })).toThrow();
      expect(validateManualContent({ title: '标题' })).toEqual({ title: '标题' });
      expect(validateManualContent({ body: '正文' })).toEqual({ body: '正文' });
    });

    it('标题不超过 20 字', () => {
      const longTitle = 'a'.repeat(MANUAL_TITLE_MAX_LENGTH + 1);
      expect(() => validateManualContent({ title: longTitle })).toThrow(/标题不能超过/);
    });

    it('正文不超过 1000 字', () => {
      const longBody = 'b'.repeat(MANUAL_BODY_MAX_LENGTH + 1);
      expect(() => validateManualContent({ body: longBody })).toThrow(/正文不能超过/);
    });

    it('话题最多 10 个并去除 # 前缀', () => {
      const content = validateManualContent({
        body: '正文',
        hashtags: ['#露营', ' 好物 ', '#'],
      });
      expect(content.hashtags).toEqual(['露营', '好物']);
    });

    it('缺少 manualContent 时抛出错误', () => {
      expect(() => validateManualContent(undefined)).toThrow('缺少手动发布文案');
    });
  });

  describe('normalizeManualContent', () => {
    it('trim 空白并过滤空话题', () => {
      expect(
        normalizeManualContent({
          title: '  标题  ',
          body: '  正文  ',
          hashtags: ['#a', '', '  '],
        }),
      ).toEqual({ title: '标题', body: '正文', hashtags: ['a'] });
    });

    it('话题超过上限时截断', () => {
      const tags = Array.from({ length: MANUAL_HASHTAG_MAX_COUNT + 3 }, (_, i) => `t${i}`);
      const normalized = normalizeManualContent({ body: 'x', hashtags: tags });
      expect(normalized.hashtags).toHaveLength(MANUAL_HASHTAG_MAX_COUNT);
    });
  });

  describe('parseHashtagInput', () => {
    it('支持逗号、中文逗号与空格分隔', () => {
      expect(parseHashtagInput('露营,好物 分享，#日常')).toEqual([
        '露营',
        '好物',
        '分享',
        '日常',
      ]);
    });

    it('空输入返回空数组', () => {
      expect(parseHashtagInput('   ')).toEqual([]);
    });
  });
});
