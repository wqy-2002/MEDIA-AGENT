import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings, TaskPlan } from '@/types';

// 策略守卫测试：验证平台开关、自动化开关与频率限制的拦截逻辑。

let todayCount = 0;
vi.mock('@/core/storage/db', () => ({
  countTodayByType: vi.fn(async () => todayCount),
}));

import { checkPolicy } from '@/core/executor/policy-guard';
import { DEFAULT_SETTINGS } from '@/core/storage/settings';

function settingsWith(patch: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    automation: { ...DEFAULT_SETTINGS.automation, ...patch.automation },
    rateLimit: { ...DEFAULT_SETTINGS.rateLimit, ...patch.rateLimit },
    platformSwitch: { ...DEFAULT_SETTINGS.platformSwitch, ...patch.platformSwitch },
  };
}

beforeEach(() => {
  todayCount = 0;
});

describe('checkPolicy', () => {
  it('平台关闭时应拦截', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const settings = settingsWith({ platformSwitch: { xiaohongshu: false } as never });
    const res = await checkPolicy(plan, settings);
    expect(res.allowed).toBe(false);
  });

  it('自动发布开关关闭时应拦截 submit_publish', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const res = await checkPolicy(plan, settingsWith({}));
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('自动发布');
  });

  it('开启自动发布后应放行', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const settings = settingsWith({ automation: { autoPublish: true } as never });
    const res = await checkPolicy(plan, settings);
    expect(res.allowed).toBe(true);
  });

  it('评论超出单日上限时应拦截', async () => {
    todayCount = 999;
    const plan: TaskPlan = {
      taskType: 'comment',
      platform: 'xiaohongshu',
      targetUrl: 'https://www.xiaohongshu.com/explore/abc',
      actions: ['submit_comment'],
    };
    const settings = settingsWith({ automation: { autoComment: true } as never });
    const res = await checkPolicy(plan, settings);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('上限');
  });
});
