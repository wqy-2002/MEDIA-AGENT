import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings, GeneratedContent, ModelConfig, TaskPlan, TaskRecord } from '@/types';

// 执行器集成测试：用 mock 替换存储、模型、tab 管理与消息通道，
// 验证动作链路（含「check_login 在 open_page 之前需自动打开页面」的修复）。

// ---- mock 依赖 ----
const updateTask = vi.fn(async (..._a: unknown[]) => undefined);
const getMaterials = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const putDraft = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/core/storage/db', () => ({
  updateTask: (...a: unknown[]) => updateTask(...a),
  getMaterials: (...a: unknown[]) => getMaterials(...a),
  putDraft: (...a: unknown[]) => putDraft(...a),
}));

const generateContent = vi.fn(async (..._a: unknown[]): Promise<GeneratedContent> => ({
  title: '标题',
  body: '正文',
  hashtags: ['话题'],
}));
vi.mock('@/core/planner', () => ({
  generateContent: (...a: unknown[]) => generateContent(...a),
}));

const locatePointInScreenshot = vi.fn(async (..._a: unknown[]) => ({
  found: true,
  x: 0.82,
  y: 0.9,
  confidence: 0.92,
}));
vi.mock('@/core/model', () => ({
  locatePointInScreenshot: (...a: unknown[]) => locatePointInScreenshot(...a),
}));

const tabManagerMocks = vi.hoisted(() => ({
  openTab: vi.fn(async () => 1),
  navigateTab: vi.fn(async () => undefined),
  reloadTab: vi.fn(async () => undefined),
  waitForContentReady: vi.fn(async () => ({ ready: true, frameId: 0 })),
  scanReadyFrame: vi.fn(async () => ({ ready: true, frameId: 456 })),
  pingFrame: vi.fn(async () => true),
  captureTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
}));
const {
  openTab,
  navigateTab,
  reloadTab,
  waitForContentReady,
  scanReadyFrame,
  pingFrame,
  captureTab,
} = tabManagerMocks;
vi.mock('@/core/executor/tab-manager', () => tabManagerMocks);

// 模拟 content script 的响应：根据命令返回结果
type TabReply = { ok: boolean; data?: unknown; errorMessage?: string };
let loginResult = true;
const sentCommands: string[] = [];
const sentArgs: Record<string, unknown>[] = [];
const sendToTab = vi.fn(
  async (_tabId: number, msg: { payload: { command: string; args?: Record<string, unknown> } }): Promise<TabReply> => {
    const command = msg.payload.command;
    sentCommands.push(command);
    sentArgs.push(msg.payload.args ?? {});
    if (command === 'check_login') {
      return { ok: true, data: { success: loginResult, data: { loggedIn: loginResult } } };
    }
    return { ok: true, data: { success: true, data: { resultUrl: 'https://x.com/note/1' } } };
  },
);
vi.mock('@/core/messaging', () => ({
  sendToTab: (...a: unknown[]) =>
    sendToTab(...(a as [number, { payload: { command: string; args?: Record<string, unknown> } }])),
}));

import { executePlan } from '@/core/executor';

function makeLogger() {
  return {
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
  };
}

const settings = {} as AppSettings;
const modelConfig = {} as ModelConfig;

function makeRecord(): TaskRecord {
  return {
    id: 't1',
    taskType: 'publish',
    platform: 'xiaohongshu',
    userInput: '发一篇好物分享',
    status: 'created',
    startedAt: Date.now(),
    retryCount: 0,
  };
}

beforeEach(() => {
  sentCommands.length = 0;
  sentArgs.length = 0;
  loginResult = true;
  vi.clearAllMocks();
  locatePointInScreenshot.mockResolvedValue({
    found: true,
    x: 0.82,
    y: 0.9,
    confidence: 0.92,
  });
});

describe('executePlan', () => {
  it('check_login 在 open_publish_page 之前时应自动打开页面并完成发布', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      contentType: 'note',
      actions: [
        'check_login',
        'generate_content',
        'open_publish_page',
        'fill_title',
        'fill_body',
        'fill_hashtags',
        'submit_publish',
        'verify_result',
        'take_screenshot',
        'save_record',
      ],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: makeRecord(),
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('success');
    // 关键断言：check_login 之前没有 open 动作，执行器应自动 openTab
    expect(openTab).toHaveBeenCalled();
    // 登录检测命令已下发
    expect(sentCommands).toContain('check_login');
    expect(sentCommands).toContain('submit_publish');
    // fill_title / fill_body / fill_hashtags 应只合并执行一次 fill_content
    expect(sentCommands.filter((c) => c === 'fill_content')).toHaveLength(1);
    // 内容已生成
    expect(generateContent).toHaveBeenCalled();
  });

  it('未登录时应暂停并返回 waiting_login，pausedAt 指向 check_login', async () => {
    loginResult = false;
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['check_login', 'generate_content', 'open_publish_page', 'submit_publish'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: makeRecord(),
      plan,
      settings,
      modelConfig,
      logger,
    });
    expect(result.status).toBe('waiting_login');
    expect(result.pausedAt).toBe(0);
  });

  it('页面命令失败应返回 failed 状态', async () => {
    sendToTab.mockImplementationOnce(async () => ({ ok: false, errorMessage: '无响应' }));
    const plan: TaskPlan = {
      taskType: 'like',
      platform: 'xiaohongshu',
      targetUrl: 'https://www.xiaohongshu.com/explore/abc',
      actions: ['check_login', 'execute_like'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: { ...makeRecord(), taskType: 'like' },
      plan,
      settings,
      modelConfig,
      logger,
    });
    expect(result.status).toBe('failed');
    expect(logger.error).toHaveBeenCalled();
  });

  it('页面脚本未就绪时应刷新页面并重试', async () => {
    waitForContentReady
      .mockResolvedValueOnce({ ready: false, frameUrls: [] } as unknown as Awaited<
        ReturnType<typeof waitForContentReady>
      >)
      .mockResolvedValueOnce({ ready: true, frameId: 0 });
    const plan: TaskPlan = {
      taskType: 'like',
      platform: 'xiaohongshu',
      targetUrl: 'https://www.xiaohongshu.com/explore/abc',
      actions: ['execute_like'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: { ...makeRecord(), taskType: 'like' },
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('success');
    expect(reloadTab).toHaveBeenCalled();
    expect(sentCommands).toContain('execute_like');
  });

  it('互动任务缺少目标 URL 时不应打开发布页兜底', async () => {
    const plan: TaskPlan = {
      taskType: 'follow',
      platform: 'xiaohongshu',
      actions: ['execute_follow'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: { ...makeRecord(), taskType: 'follow' },
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('failed');
    expect(openTab).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('缺少目标页面 URL'));
  });

  it('评论任务缺少 generate_content 时应在提交前生成评论', async () => {
    generateContent.mockResolvedValueOnce({ comment: '很有帮助，感谢分享！' });
    const plan: TaskPlan = {
      taskType: 'comment',
      platform: 'xiaohongshu',
      targetUrl: 'https://www.xiaohongshu.com/explore/abc',
      actions: ['check_login', 'open_target_page', 'submit_comment', 'verify_result', 'save_record'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: { ...makeRecord(), taskType: 'comment' },
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('success');
    expect(generateContent).toHaveBeenCalled();
    expect(sentCommands).toContain('execute_comment');
    const commentIndex = sentCommands.indexOf('execute_comment');
    expect(sentArgs[commentIndex]).toEqual({ comment: '很有帮助，感谢分享！' });
  });

  it('评论内容被模型放入正文时应兜底作为评论提交', async () => {
    generateContent.mockResolvedValueOnce({ body: '这个观点很实用，学习了。' });
    const plan: TaskPlan = {
      taskType: 'comment',
      platform: 'xiaohongshu',
      targetUrl: 'https://www.xiaohongshu.com/explore/abc',
      actions: ['check_login', 'generate_content', 'open_target_page', 'submit_comment'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: { ...makeRecord(), taskType: 'comment' },
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('success');
    const commentIndex = sentCommands.indexOf('execute_comment');
    expect(sentArgs[commentIndex]).toEqual({ comment: '这个观点很实用，学习了。' });
  });

  it('小红书发布按钮 DOM 识别失败时应截图定位并点击坐标', async () => {
    sendToTab.mockImplementation(
      async (_tabId: number, msg: { payload: { command: string; args?: Record<string, unknown> } }): Promise<TabReply> => {
        const command = msg.payload.command;
        sentCommands.push(command);
        sentArgs.push(msg.payload.args ?? {});
        if (command === 'submit_publish') {
          return {
            ok: true,
            data: {
              success: false,
              errorCode: 'BUTTON_NOT_FOUND',
              message: '发布按钮就绪后丢失',
            },
          };
        }
        if (command === 'click_viewport_point') {
          return {
            ok: true,
            data: {
              success: true,
              data: { resultUrl: 'https://www.xiaohongshu.com/note/1' },
              message: '视觉点击后检测到发布结果',
            },
          };
        }
        return { ok: true, data: { success: true } };
      },
    );
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: makeRecord(),
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('success');
    expect(captureTab).toHaveBeenCalled();
    expect(locatePointInScreenshot).toHaveBeenCalled();
    expect(sentCommands).toEqual(['submit_publish', 'click_viewport_point']);
    expect(sentArgs[1]).toMatchObject({ xRatio: 0.82, yRatio: 0.9 });
    expect(updateTask).toHaveBeenCalledWith('t1', {
      resultUrl: 'https://www.xiaohongshu.com/note/1',
    });
  });

  it('截图定位未找到按钮时应保留原始失败路径', async () => {
    locatePointInScreenshot.mockResolvedValueOnce({
      found: false,
      x: 0,
      y: 0,
      confidence: 0,
    });
    sendToTab.mockImplementation(
      async (_tabId: number, msg: { payload: { command: string; args?: Record<string, unknown> } }): Promise<TabReply> => {
        const command = msg.payload.command;
        sentCommands.push(command);
        sentArgs.push(msg.payload.args ?? {});
        if (command === 'submit_publish') {
          return {
            ok: true,
            data: {
              success: false,
              errorCode: 'BUTTON_NOT_FOUND',
              message: '发布按钮就绪后丢失',
            },
          };
        }
        return { ok: true, data: { success: true } };
      },
    );
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: makeRecord(),
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('failed');
    expect(captureTab).toHaveBeenCalled();
    expect(locatePointInScreenshot).toHaveBeenCalled();
    expect(sentCommands).toEqual(['submit_publish']);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('发布按钮就绪后丢失'));
  });

  it('搜狐 check_login PING 成功时不应 reload', async () => {
    scanReadyFrame.mockResolvedValueOnce({ ready: true, frameId: 456 });
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'sohu',
      contentType: 'article',
      actions: ['check_login'],
    };
    const logger = makeLogger();
    await executePlan({
      record: { ...makeRecord(), platform: 'sohu', taskType: 'publish' },
      plan,
      settings,
      modelConfig,
      logger,
    });
    expect(reloadTab).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '搜狐登录探测完成',
      expect.objectContaining({ loggedIn: true, frameId: 456 }),
    );
  });

  it('搜狐 check_login 后 open_publish_page 应跳过重复 dashboard', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'sohu',
      contentType: 'article',
      actions: ['check_login', 'open_publish_page'],
    };
    const logger = makeLogger();
    await executePlan({
      record: { ...makeRecord(), platform: 'sohu', taskType: 'publish' },
      plan,
      settings,
      modelConfig,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('登录已在 check_login 验证，跳过重复打开 dashboard');
    expect(navigateTab).toHaveBeenCalledWith(
      1,
      'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
    );
  });

  it('搜狐发布应两段式导航：列表页 → 编辑器', async () => {
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'sohu',
      contentType: 'article',
      actions: ['open_publish_page'],
    };
    const logger = makeLogger();
    await executePlan({
      record: { ...makeRecord(), platform: 'sohu', taskType: 'publish' },
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(openTab).toHaveBeenCalled();
    expect(navigateTab).toHaveBeenCalledWith(
      1,
      'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
    );
    expect(sentCommands).toContain('ensure_publish_page');
  });

  it('发布按钮为 disabled 时不应进入视觉兜底', async () => {
    sendToTab.mockImplementation(
      async (_tabId: number, msg: { payload: { command: string; args?: Record<string, unknown> } }): Promise<TabReply> => {
        const command = msg.payload.command;
        sentCommands.push(command);
        sentArgs.push(msg.payload.args ?? {});
        if (command === 'submit_publish') {
          return {
            ok: true,
            data: {
              success: false,
              errorCode: 'BUTTON_DISABLED',
              message: '发布按钮存在但不可点击',
            },
          };
        }
        return { ok: true, data: { success: true } };
      },
    );
    const plan: TaskPlan = {
      taskType: 'publish',
      platform: 'xiaohongshu',
      actions: ['submit_publish'],
    };
    const logger = makeLogger();
    const result = await executePlan({
      record: makeRecord(),
      plan,
      settings,
      modelConfig,
      logger,
    });

    expect(result.status).toBe('failed');
    expect(captureTab).not.toHaveBeenCalled();
    expect(locatePointInScreenshot).not.toHaveBeenCalled();
    expect(sentCommands).toEqual(['submit_publish']);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('发布按钮存在但不可点击'));
  });
});
