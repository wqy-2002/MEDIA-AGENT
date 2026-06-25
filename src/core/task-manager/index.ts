import type {
  AppSettings,
  GeneratedContent,
  ModelConfig,
  TaskPlan,
  TaskRecord,
} from '@/types';
import type { CreateTaskPayload } from '@/core/messaging';
import { createTaskLogger } from '@/core/logger';
import { getSettings, getModelConfig } from '@/core/storage/settings';
import { putTask, updateTask, getTask } from '@/core/storage/db';
import { parseTaskPlan } from '@/core/planner';
import { checkPolicy } from '@/core/executor/policy-guard';
import { executePlan } from '@/core/executor';
import { ModelError } from '@/core/model';
import { platformFromUrl } from '@/adapters/registry';
import { resolvePlatformTabForTask } from '@/core/storage/platform-session';

/** 运行时任务上下文（内存态，用于暂停恢复） */
interface RuntimeTask {
  record: TaskRecord;
  plan: TaskPlan;
  settings: AppSettings;
  modelConfig: ModelConfig;
  content?: GeneratedContent;
  tabId?: number;
  pausedAt?: number;
  cancelled?: boolean;
}

const runtime = new Map<string, RuntimeTask>();

function genId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function looksLikeEngagementTask(input: string): boolean {
  return /(评论|留言|回复|点赞|赞一下|点个赞|收藏|关注)/.test(input.replace(/\s+/g, ''));
}

function isUsableTargetUrl(url: string | undefined, platform: TaskRecord['platform']): url is string {
  if (!url || platformFromUrl(url) !== platform) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (platform !== 'xiaohongshu') return true;
    // 小红书互动只复用笔记详情页，避免把创作者中心当作评论/点赞目标页。
    if (parsed.hostname !== 'www.xiaohongshu.com') return false;
    return /^\/(explore\/[^/]+|discovery\/item\/[^/]+|note\/[^/]+)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * 评论/点赞等互动任务默认作用于当前活动标签页。
 * 同时返回该标签页 id，便于直接复用（避免重新打开/重载页面导致 content script 失活）。
 */
async function inferActiveEngagementTab(
  payload: CreateTaskPayload,
  platform: TaskRecord['platform'],
): Promise<{ targetUrl?: string; tabId?: number }> {
  // 用户已显式填写目标 URL，或不是互动任务时，保持原行为，不复用当前标签页
  if (payload.targetUrl || !looksLikeEngagementTask(payload.userInput)) {
    return { targetUrl: payload.targetUrl };
  }
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isUsableTargetUrl(active?.url, platform)) {
      return { targetUrl: active.url, tabId: active.id };
    }
  } catch {
    // 无法读取活动标签页时回退为无目标
  }
  return {};
}

/**
 * 创建并启动任务。
 * 流程：创建记录 → 解析计划 → 策略校验 → 执行计划。
 */
export async function createTask(payload: CreateTaskPayload): Promise<TaskRecord> {
  const id = genId();
  const settings = await getSettings();
  const modelConfig = await getModelConfig();

  const record: TaskRecord = {
    id,
    taskType: 'publish',
    platform: payload.platform ?? settings.defaultPlatform,
    userInput: payload.userInput,
    status: 'created',
    startedAt: Date.now(),
    retryCount: 0,
  };
  await putTask(record);

  const logger = createTaskLogger(id);
  await logger.status('created', '任务已创建');

  void runTaskPipeline(id, payload, settings, modelConfig);
  return record;
}

/** 任务主流程 */
async function runTaskPipeline(
  id: string,
  payload: CreateTaskPayload,
  settings: AppSettings,
  modelConfig: ModelConfig,
): Promise<void> {
  const logger = createTaskLogger(id);
  try {
    const activeTab = await inferActiveEngagementTab(
      payload,
      payload.platform ?? settings.defaultPlatform,
    );
    const platform = payload.platform ?? settings.defaultPlatform;
    const sessionTabId = await resolvePlatformTabForTask(platform);
    const existingTabId = activeTab.tabId ?? sessionTabId;
    await updateTask(id, { status: 'parsing' });
    await logger.status('parsing', '正在调用模型解析任务');

    const plan = await parseTaskPlan(modelConfig, settings, {
      userInput: payload.userInput,
      platform: payload.platform,
      targetUrl: activeTab.targetUrl,
      hasImages: Boolean(payload.materialIds?.length),
      hasVideos: false,
    });

    if (payload.materialIds?.length) {
      plan.materials = plan.materials ?? {};
      if (plan.contentType === 'video') {
        plan.materials.videos = payload.materialIds;
      } else {
        plan.materials.images = payload.materialIds;
      }
    }

    await updateTask(id, {
      status: 'planning',
      plan,
      taskType: plan.taskType,
      platform: plan.platform,
      targetUrl: plan.targetUrl,
    });
    await logger.status('planning', '执行计划已生成');
    await logger.info('TaskPlan', plan);

    const policy = await checkPolicy(plan, settings);
    if (!policy.allowed) {
      await updateTask(id, {
        status: 'failed',
        errorCode: 'PERMISSION_DENIED',
        errorMessage: policy.reason,
        finishedAt: Date.now(),
      });
      await logger.error(`策略拦截: ${policy.reason}`);
      return;
    }

    const record = (await getTask(id))!;
    // 互动任务复用当前活动标签页；发布任务复用持久化平台标签页，避免每次像新设备登录
    const rt: RuntimeTask = { record, plan, settings, modelConfig, tabId: existingTabId };
    runtime.set(id, rt);

    const result = await executePlan({
      record,
      plan,
      settings,
      modelConfig,
      logger,
      existingTabId,
    });

    if (result.status === 'waiting_login' || result.status === 'waiting_verification') {
      rt.pausedAt = result.pausedAt;
      rt.record = (await getTask(id))!;
    }
  } catch (err) {
    const code = err instanceof ModelError ? err.code : 'TASK_PARSE_FAILED';
    const message = err instanceof Error ? err.message : String(err);
    await updateTask(id, {
      status: 'failed',
      errorCode: code,
      errorMessage: message,
      finishedAt: Date.now(),
    });
    await logger.error(`任务失败 [${code}]: ${message}`);
  }
}

/** 恢复一个处于等待状态的任务（用户处理完登录/验证后） */
export async function resumeTask(taskId: string): Promise<void> {
  const rt = runtime.get(taskId);
  const logger = createTaskLogger(taskId);
  if (!rt) {
    await logger.error('无法恢复：任务运行态已丢失（Service Worker 可能被回收），请重试任务');
    return;
  }
  await logger.status('retrying', '继续执行任务');
  const result = await executePlan(
    {
      record: rt.record,
      plan: rt.plan,
      settings: rt.settings,
      modelConfig: rt.modelConfig,
      logger,
      existingTabId: rt.tabId,
      content: rt.content,
    },
    rt.pausedAt ?? 0,
  );
  if (result.status === 'waiting_login' || result.status === 'waiting_verification') {
    rt.pausedAt = result.pausedAt;
  }
}

/** 重试失败任务（从头开始） */
export async function retryTask(taskId: string): Promise<void> {
  const record = await getTask(taskId);
  if (!record) return;
  await updateTask(taskId, {
    status: 'retrying',
    retryCount: record.retryCount + 1,
    errorCode: undefined,
    errorMessage: undefined,
  });
  const settings = await getSettings();
  const modelConfig = await getModelConfig();
  void runTaskPipeline(
    taskId,
    {
      userInput: record.userInput,
      platform: record.platform,
      targetUrl: record.targetUrl,
      materialIds: [
        ...(record.plan?.materials?.images ?? []),
        ...(record.plan?.materials?.videos ?? []),
      ],
    },
    settings,
    modelConfig,
  );
}

/** 取消任务 */
export async function cancelTask(taskId: string): Promise<void> {
  const rt = runtime.get(taskId);
  if (rt) rt.cancelled = true;
  await updateTask(taskId, {
    status: 'cancelled',
    finishedAt: Date.now(),
  });
  const logger = createTaskLogger(taskId);
  await logger.status('cancelled', '任务已取消');
}
