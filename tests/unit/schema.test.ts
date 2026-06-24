import { describe, it, expect } from 'vitest';
import { taskPlanSchema, generatedContentSchema } from '@/schemas/task-plan';

// 校验 TaskPlan 的 Zod schema：合法计划通过、非法计划被拦截。

describe('taskPlanSchema', () => {
  it('应接受合法的发布计划', () => {
    const plan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      contentType: 'note',
      requirements: { topic: '露营好物', hashtags: 3 },
      actions: ['check_login', 'generate_content', 'open_publish_page', 'submit_publish'],
    };
    const result = taskPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('应拒绝非法的 taskType', () => {
    const plan = {
      taskType: 'hack',
      platform: 'xiaohongshu',
      actions: ['check_login'],
    };
    expect(taskPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('应拒绝白名单外的 action', () => {
    const plan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['run_arbitrary_js'],
    };
    expect(taskPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('应拒绝空的 actions 数组', () => {
    const plan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: [],
    };
    expect(taskPlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe('generatedContentSchema', () => {
  it('应接受合法的生成内容', () => {
    const content = {
      title: '露营好物分享',
      body: '今天推荐几款...',
      hashtags: ['露营', '好物'],
    };
    expect(generatedContentSchema.safeParse(content).success).toBe(true);
  });
});
