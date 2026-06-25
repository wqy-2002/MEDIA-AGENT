import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings, ModelConfig } from '@/types';
import { parseTaskPlan, generateContent } from '@/core/planner';
import { DEFAULT_SETTINGS } from '@/core/storage/settings';

// 解析器测试：mock 全局 fetch 模拟模型返回，验证 TaskPlan 解析 + Zod 校验 + 内容生成。

const modelConfig: ModelConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

const settings: AppSettings = { ...DEFAULT_SETTINGS };

function mockFetchReply(content: string) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseTaskPlan', () => {
  it('应把模型返回的合法 JSON 解析为 TaskPlan', async () => {
    const planJson = JSON.stringify({
      taskType: 'publish',
      platform: 'xiaohongshu',
      contentType: 'note',
      requirements: { topic: '好物分享', hashtags: 3 },
      actions: ['check_login', 'generate_content', 'open_publish_page', 'submit_publish'],
    });
    globalThis.fetch = mockFetchReply(planJson);

    const plan = await parseTaskPlan(modelConfig, settings, {
      userInput: '帮我在小红书发一篇好物分享',
      hasImages: false,
      hasVideos: false,
    });
    expect(plan.taskType).toBe('publish');
    expect(plan.platform).toBe('xiaohongshu');
    expect(plan.actions).toContain('submit_publish');
  });

  it('用户显式指定平台时应覆盖模型结果', async () => {
    const planJson = JSON.stringify({
      taskType: 'publish',
      platform: 'sohu',
      actions: ['check_login', 'submit_publish'],
    });
    globalThis.fetch = mockFetchReply(planJson);

    const plan = await parseTaskPlan(modelConfig, settings, {
      userInput: '发布',
      platform: 'xiaohongshu',
      hasImages: false,
      hasVideos: false,
    });
    expect(plan.platform).toBe('xiaohongshu');
  });

  it('模型持续返回非法 JSON 时应抛出解析失败', async () => {
    globalThis.fetch = mockFetchReply('这不是 JSON');
    await expect(
      parseTaskPlan(modelConfig, settings, {
        userInput: '发布',
        hasImages: false,
        hasVideos: false,
      }),
    ).rejects.toThrow();
  });
});

describe('generateContent', () => {
  it('应解析模型返回的内容 JSON', async () => {
    const contentJson = JSON.stringify({
      title: '露营好物分享',
      body: '今天推荐几款好物',
      hashtags: ['露营', '好物'],
    });
    globalThis.fetch = mockFetchReply(contentJson);

    const content = await generateContent(modelConfig, settings, {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['generate_content'],
    });
    expect(content.title).toBe('露营好物分享');
    expect(content.hashtags).toEqual(['露营', '好物']);
  });
});
