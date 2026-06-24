import { describe, it, expect } from 'vitest';
import { extractJson, ModelError } from '@/core/model';

// 校验从模型输出文本中提取 JSON 的容错能力。

describe('extractJson', () => {
  it('应解析纯 JSON', () => {
    const obj = extractJson<{ a: number }>('{"a": 1}');
    expect(obj.a).toBe(1);
  });

  it('应解析被 markdown 代码块包裹的 JSON', () => {
    const text = '```json\n{"taskType": "publish"}\n```';
    const obj = extractJson<{ taskType: string }>(text);
    expect(obj.taskType).toBe('publish');
  });

  it('应从带说明文字的输出中截取 JSON', () => {
    const text = '好的，这是计划：{"platform": "xiaohongshu"} 希望有帮助';
    const obj = extractJson<{ platform: string }>(text);
    expect(obj.platform).toBe('xiaohongshu');
  });

  it('无法解析时抛出 ModelError', () => {
    expect(() => extractJson('这不是 JSON')).toThrow(ModelError);
  });
});
