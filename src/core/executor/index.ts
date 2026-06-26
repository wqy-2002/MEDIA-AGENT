import type {
  ActionName,
  ActionResult,
  AppSettings,
  GeneratedContent,
  MediaFile,
  ModelConfig,
  TaskPlan,
  TaskRecord,
  TaskStatus,
} from '@/types';
import type { LoggerLike } from '@/core/logger';
import type { ContentCommand } from '@/adapters/types';
import { updateTask, getMaterials, putDraft } from '@/core/storage/db';
import { generateContent } from '@/core/planner';
import { locatePointInScreenshot } from '@/core/model';
import { getPlatformUrls, PLATFORM_LABELS } from '@/adapters/registry';
import { sendToTab } from '@/core/messaging';
import { isSohuBackendUrl } from '@/adapters/sohu/readiness';
import { bindPlatformSessionTab } from '@/core/storage/platform-session';
import {
  openTab,
  navigateTab,
  reloadTab,
  waitForContentReady,
  pingFrame,
  captureTab,
  scanReadyFrame,
} from './tab-manager';
import type { ContentReadyResult, WaitForContentReadyOptions } from './tab-manager';
import { humanStepGap } from '@/core/automation/human-pacing';

/** 执行上下文：在单次任务执行过程中传递的共享状态 */
interface ExecContext {
  record: TaskRecord;
  plan: TaskPlan;
  settings: AppSettings;
  modelConfig: ModelConfig;
  logger: LoggerLike;
  tabId?: number;
  windowId?: number;
  /** Content Script 就绪的目标 frame（微前端/iframe 场景） */
  contentFrameId?: number;
  /** navigate/reload 后需重新扫描 frame */
  contentFrameInvalidated?: boolean;
  content?: GeneratedContent;
  filledContent?: boolean;
  materials: MediaFile[];
  /** 发布任务是否已成功提交（用于 verify_result 校验） */
  publishSubmitted?: boolean;
  /** 搜狐 check_login 已通过，open_publish_page 可跳过 dashboard */
  sohuLoginVerified?: boolean;
}

/** 只保留用户明确要求的话题，避免模型默认话题触发平台候选层 */
function normalizeContentForPlan(content: GeneratedContent, plan: TaskPlan): GeneratedContent {
  const requestedHashtags = plan.requirements?.hashtags;
  if (requestedHashtags == null) {
    return content.hashtags?.length ? { ...content, hashtags: undefined } : content;
  }
  if (Array.isArray(requestedHashtags)) {
    return { ...content, hashtags: requestedHashtags };
  }
  return content;
}

/** 评论任务优先使用 comment，兼容模型误放到其他文本字段的情况 */
function getCommentText(content?: GeneratedContent): string | undefined {
  const text = content?.comment ?? content?.body ?? content?.description ?? content?.title;
  const trimmed = text?.trim();
  return trimmed || undefined;
}

function shouldTryVisualPublishFallback(ctx: ExecContext, res: ActionResult): boolean {
  if (ctx.plan.platform !== 'xiaohongshu' || ctx.plan.taskType !== 'publish') return false;
  const blockedCodes = new Set([
    'BUTTON_DISABLED',
    'UPLOAD_NOT_FINISHED',
    'FORM_NOT_READY',
    'BLOCKED_BY_DIALOG',
    'LOGIN_REQUIRED',
    'VERIFY_REQUIRED',
  ]);
  return !blockedCodes.has(String(res.errorCode ?? ''));
}

async function sendContentCommandToFrame(
  tabId: number,
  frameId: number,
  payload: { taskId: string; platform: TaskPlan['platform']; command: ContentCommand; args?: Record<string, unknown> },
): Promise<ActionResult> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        type: 'CONTENT_EXECUTE_ACTION',
        payload,
      },
      { frameId },
      (response: { ok?: boolean; data?: ActionResult; errorMessage?: string } | undefined) => {
        const err = chrome.runtime.lastError?.message;
        if (err) {
          resolve({
            success: false,
            errorCode: 'FRAME_MESSAGE_FAILED',
            message: err,
          });
          return;
        }
        if (!response?.ok || !response.data) {
          resolve({
            success: false,
            errorCode: 'FRAME_MESSAGE_FAILED',
            message: response?.errorMessage ?? 'frame 消息无响应',
          });
          return;
        }
        resolve(response.data);
      },
    );
  });
}

async function runAllFramesPublishFallback(ctx: ExecContext, previous: ActionResult): Promise<ActionResult> {
  if (ctx.tabId == null || ctx.plan.platform !== 'xiaohongshu') return previous;
  if (previous.errorCode !== 'BUTTON_NOT_FOUND') return previous;
  if (!chrome.webNavigation?.getAllFrames) return previous;

  await ctx.logger.info('主 frame 未找到发布按钮，开始扫描所有 frame');
  let frames: chrome.webNavigation.GetAllFrameResultDetails[] = [];
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId: ctx.tabId })) ?? [];
  } catch (err) {
    await ctx.logger.warn(`获取 frame 列表失败: ${err instanceof Error ? err.message : String(err)}`);
    return previous;
  }

  const scanResults: Array<Record<string, unknown>> = [];
  for (const frame of frames) {
    const scan = await sendContentCommandToFrame(ctx.tabId, frame.frameId, {
      taskId: ctx.record.id,
      platform: ctx.plan.platform,
      command: 'scan_publish_button',
    });
    scanResults.push({
      frameId: frame.frameId,
      url: frame.url,
      success: scan.success,
      errorCode: scan.errorCode,
      data: scan.data,
    });
    if (!scan.success) continue;
    const hasEnabled = Boolean((scan.data as { hasEnabledPublishButton?: boolean })?.hasEnabledPublishButton);
    if (!hasEnabled) continue;

    await ctx.logger.info(`在 frame ${frame.frameId} 发现可点击发布按钮`, { frameId: frame.frameId, url: frame.url });
    const clicked = await sendContentCommandToFrame(ctx.tabId, frame.frameId, {
      taskId: ctx.record.id,
      platform: ctx.plan.platform,
      command: 'click_publish_button',
    });
    if (clicked.success) return clicked;
    await ctx.logger.warn(`frame ${frame.frameId} 点击发布失败`, clicked);
  }

  await ctx.logger.warn('所有 frame 均未完成发布点击，准备进入视觉兜底', { scanResults });
  return {
    success: false,
    errorCode: 'BUTTON_NOT_FOUND',
    message: '所有 frame 均未找到可点击发布按钮，准备进入视觉兜底',
    data: { previous, scanResults },
  };
}

async function runVisualPublishFallback(
  ctx: ExecContext,
  original: ActionResult,
): Promise<ActionResult> {
  if (!shouldTryVisualPublishFallback(ctx, original)) return original;

  await ctx.logger.warn('DOM 发布按钮未找到，开始截图定位发布按钮');
  const screenshot = await captureTab(ctx.windowId);
  if (!screenshot) {
    await ctx.logger.warn('截图定位失败：无法截取当前标签页');
    return original;
  }

  let point;
  try {
    point = await locatePointInScreenshot(ctx.modelConfig, {
      imageDataUrl: screenshot,
      instruction:
        '请在这张小红书创作者发布页面截图中定位真正用于提交笔记的“发布”按钮中心点。不要选择左侧菜单、顶部导航、返回按钮或图片编辑工具。若截图中没有最终发布按钮，found 返回 false。',
    });
  } catch (err) {
    await ctx.logger.warn(`截图定位失败：${err instanceof Error ? err.message : String(err)}`);
    return original;
  }

  if (!point.found || point.confidence < 0.35) {
    await ctx.logger.warn('截图定位未找到可信发布按钮', point);
    return original;
  }

  await ctx.logger.info('截图定位到发布按钮，尝试按坐标点击', point);
  const clicked = await runContentCommand(ctx, 'click_viewport_point', {
    xRatio: point.x,
    yRatio: point.y,
    verifyTexts: ['发布成功', '已发布', '发布审核中', '笔记管理'],
    verifyTimeout: 45000,
  });
  if (clicked.success) {
    await ctx.logger.info(clicked.message ?? '截图定位点击发布成功');
    return clicked;
  }

  await ctx.logger.warn('截图定位点击未确认发布成功', clicked);
  return {
    ...original,
    message: `${original.message ?? '发布按钮识别失败'}\n截图定位点击失败：${clicked.message ?? '未知错误'}`,
    diagnostics: original.diagnostics ?? clicked.diagnostics,
  };
}

async function generateAndStoreContent(ctx: ExecContext): Promise<GeneratedContent> {
  const content = normalizeContentForPlan(
    await generateContent(ctx.modelConfig, ctx.settings, ctx.plan),
    ctx.plan,
  );
  ctx.content = content;
  await updateTask(ctx.record.id, { generatedContent: content });
  await putDraft({
    id: `${ctx.record.id}-draft`,
    taskId: ctx.record.id,
    platform: ctx.plan.platform,
    content,
    createdAt: Date.now(),
  });
  return content;
}

/** 需要暂停等待用户处理的信号 */
export class PauseSignal extends Error {
  constructor(
    public status: Extract<TaskStatus, 'waiting_login' | 'waiting_verification' | 'paused'>,
    message: string,
  ) {
    super(message);
    this.name = 'PauseSignal';
  }
}

/** 执行失败信号，携带错误码 */
export class ExecError extends Error {
  constructor(
    public code: NonNullable<TaskRecord['errorCode']>,
    message: string,
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

async function setStatus(ctx: ExecContext, status: TaskStatus, message: string): Promise<void> {
  await updateTask(ctx.record.id, { status });
  await ctx.logger.status(status, message);
}

function getInitialOpenUrl(plan: TaskPlan): string {
  const urls = getPlatformUrls(plan.platform);
  if (plan.platform === 'sohu' && plan.taskType === 'publish' && urls.dashboardUrl) {
    return urls.dashboardUrl;
  }
  return urls.publishUrl;
}

function formatPingDiagnostics(result: ContentReadyResult, tabUrl?: string): string {
  const lines = [`tabUrl=${tabUrl ?? 'unknown'}`];
  if (result.frameUrls?.length) {
    lines.push(`frames=${result.frameUrls.join(' | ')}`);
  }
  for (const item of result.pingResults ?? []) {
    lines.push(
      `frame ${item.frameId} (${item.url || 'empty'}): ${item.ok ? 'PING ok' : `fail ${item.error ?? ''}`}`,
    );
  }
  return lines.join('\n');
}

function invalidateContentFrame(ctx: ExecContext): void {
  ctx.contentFrameInvalidated = true;
}

function defaultResolveOpts(ctx: ExecContext): WaitForContentReadyOptions {
  if (ctx.plan.platform === 'sohu') {
    return { platform: 'sohu', preferEditorFrame: true, retries: 45 };
  }
  return { platform: ctx.plan.platform };
}

function resolveOptsForCommand(ctx: ExecContext, command: ContentCommand): WaitForContentReadyOptions {
  if (ctx.plan.platform === 'sohu' && command === 'check_login') {
    return {
      platform: 'sohu',
      preferEditorFrame: false,
      preferLoggedInFrame: true,
      retries: 12,
    };
  }
  return defaultResolveOpts(ctx);
}

/** 搜狐首次打开：PING 成功则跳过 reload，失败才刷新 */
async function ensureSohuScriptOrReload(ctx: ExecContext): Promise<void> {
  if (ctx.tabId == null) return;
  const result = await scanReadyFrame(ctx.tabId, { platform: 'sohu', preferEditorFrame: false });
  if (result.ready) {
    ctx.contentFrameId = result.frameId ?? 0;
    ctx.contentFrameInvalidated = false;
    return;
  }
  await ctx.logger.info('搜狐页面脚本未响应 PING，刷新页面后重试');
  await reloadTab(ctx.tabId);
  invalidateContentFrame(ctx);
}

/** 等待 Content Script 就绪并记录目标 frameId */
async function resolveContentFrame(
  ctx: ExecContext,
  allowReload = true,
  force = false,
  opts?: WaitForContentReadyOptions,
): Promise<void> {
  if (ctx.tabId == null) {
    throw new ExecError('PLATFORM_PAGE_CHANGED', '尚未打开目标页面');
  }

  if (!force && ctx.contentFrameId != null && !ctx.contentFrameInvalidated) {
    const stillAlive = await pingFrame(ctx.tabId, ctx.contentFrameId);
    if (stillAlive) return;
    invalidateContentFrame(ctx);
  }

  const waitOpts = opts ?? defaultResolveOpts(ctx);
  let result = await waitForContentReady(ctx.tabId, waitOpts);
  if (!result.ready && allowReload) {
    await ctx.logger.warn('页面脚本未就绪，刷新目标页面后重试', {
      frameUrls: result.frameUrls,
      pingResults: result.pingResults,
    });
    await reloadTab(ctx.tabId);
    invalidateContentFrame(ctx);
    result = await waitForContentReady(ctx.tabId, {
      ...waitOpts,
      retries: ctx.plan.platform === 'sohu' ? 20 : 10,
    });
  }
  if (!result.ready) {
    const tab = await chrome.tabs.get(ctx.tabId).catch(() => null);
    const detail = formatPingDiagnostics(result, tab?.url);
    throw new ExecError(
      'PLATFORM_PAGE_CHANGED',
      `页面脚本未就绪，可能不是受支持的平台页面\n${detail}`,
    );
  }
  ctx.contentFrameId = result.frameId ?? 0;
  ctx.contentFrameInvalidated = false;
  const tab = await chrome.tabs.get(ctx.tabId).catch(() => null);
  await ctx.logger.info(`frameId=${ctx.contentFrameId} PING 成功`, {
    tabUrl: tab?.url,
    frameUrls: result.frameUrls,
  });
}

/** 搜狐两段式导航：列表页验证登录 → 编辑器 deep link */
async function openSohuPublishPage(ctx: ExecContext): Promise<void> {
  const urls = getPlatformUrls('sohu');
  const dashUrl = urls.dashboardUrl ?? urls.homeUrl;

  if (!ctx.sohuLoginVerified) {
    await setStatus(ctx, 'opening_page', '打开搜狐号内容管理页');
    await openTargetUrl(ctx, dashUrl);
    await resolveContentFrame(ctx, true, false, {
      platform: 'sohu',
      preferEditorFrame: false,
      retries: 12,
    });

    const tab = await chrome.tabs.get(ctx.tabId!);
    if (tab.url && /passport|login/i.test(tab.url)) {
      throw new PauseSignal(
        'waiting_login',
        `未登录 ${PLATFORM_LABELS.sohu}，请在打开的页面完成登录后点击「继续」`,
      );
    }
  } else {
    await ctx.logger.info('登录已在 check_login 验证，跳过重复打开 dashboard');
    if (ctx.tabId == null) {
      await openTargetUrl(ctx, dashUrl);
    }
  }

  await ctx.logger.info(`导航至搜狐发文页: ${urls.publishUrl}`);
  await navigateTab(ctx.tabId!, urls.publishUrl);
  invalidateContentFrame(ctx);
  await resolveContentFrame(ctx, true, false, {
    platform: 'sohu',
    preferEditorFrame: true,
    retries: 45,
  });

  let res = await runContentCommand(ctx, 'ensure_publish_page', {
    skipEnsureTab: true,
    skipResolve: true,
  }).catch(() => ({ success: false }) as ActionResult);

  if (!res.success && urls.publishUrlAlt) {
    await ctx.logger.warn('主发文 URL 未就绪，尝试备用链接', { alt: urls.publishUrlAlt });
    await navigateTab(ctx.tabId!, urls.publishUrlAlt);
    invalidateContentFrame(ctx);
    await resolveContentFrame(ctx, true, false, {
      platform: 'sohu',
      preferEditorFrame: true,
      retries: 45,
    });
    res = await runContentCommand(ctx, 'ensure_publish_page', {
      skipEnsureTab: true,
      skipResolve: true,
    }).catch(() => ({ success: false }) as ActionResult);
  }

  if (res.success) {
    await ctx.logger.info(res.message ?? '已进入搜狐号发文编辑页');
  } else {
    await ctx.logger.warn('未确认发布页组件，继续尝试后续步骤', res);
  }
}

function needsTargetPage(plan: TaskPlan): boolean {
  return (
    plan.taskType === 'comment' ||
    plan.taskType === 'like' ||
    plan.taskType === 'favorite' ||
    plan.taskType === 'follow' ||
    plan.actions.some((action) =>
      ['open_target_page', 'submit_comment', 'execute_like', 'execute_favorite', 'execute_follow'].includes(action),
    )
  );
}

/**
 * 确保已打开目标平台页面。
 * 若计划里 check_login 等命令排在 open_*_page 之前，此处会按任务类型自动先打开页面：
 * - 含 targetUrl（评论/点赞/收藏/关注）：打开目标页面；
 * - 其余（发布类）：打开该平台发布页。
 */
async function ensureTabOpen(ctx: ExecContext): Promise<void> {
  if (ctx.tabId != null) {
    if (ctx.plan.platform === 'sohu' && ctx.plan.taskType === 'publish') {
      try {
        const tab = await chrome.tabs.get(ctx.tabId);
        if (tab.url && isSohuBackendUrl(tab.url) && !/passport/i.test(tab.url)) {
          return;
        }
      } catch {
        // tab 可能已关闭，继续走打开逻辑
      }
    }
    return;
  }
  if (needsTargetPage(ctx.plan) && !ctx.plan.targetUrl) {
    throw new ExecError(
      'PLATFORM_PAGE_CHANGED',
      '评论/点赞/收藏/关注任务缺少目标页面 URL。请在目标帖子页执行任务，或填写目标页面 URL。',
    );
  }
  const url = ctx.plan.targetUrl ?? getInitialOpenUrl(ctx.plan);
  await ctx.logger.info(`自动打开页面: ${url}`);
  await openTargetUrl(ctx, url);
}

/** 向 content script 发送一个 DOM 命令，并返回结果 */
async function runContentCommand(
  ctx: ExecContext,
  command: ContentCommand,
  args?: Record<string, unknown> & { skipEnsureTab?: boolean; skipResolve?: boolean },
): Promise<ActionResult> {
  const skipEnsureTab = Boolean(args?.skipEnsureTab);
  const skipResolve = Boolean(args?.skipResolve);
  const commandArgs = args ? { ...args } : undefined;
  if (commandArgs) {
    delete commandArgs.skipEnsureTab;
    delete commandArgs.skipResolve;
  }

  if (!skipEnsureTab) {
    await ensureTabOpen(ctx);
  }
  if (ctx.tabId == null) {
    throw new ExecError('PLATFORM_PAGE_CHANGED', '尚未打开目标页面');
  }
  if (!skipResolve) {
    await resolveContentFrame(ctx, true, false, resolveOptsForCommand(ctx, command));
  }
  const res = await sendToTab<ActionResult>(
    ctx.tabId,
    {
      type: 'CONTENT_EXECUTE_ACTION',
      payload: {
        taskId: ctx.record.id,
        platform: ctx.plan.platform,
        command,
        args: commandArgs,
      },
    },
    { frameId: ctx.contentFrameId ?? 0 },
  );
  if (!res.ok || !res.data) {
    throw new ExecError('PLATFORM_PAGE_CHANGED', res.errorMessage ?? '页面动作无响应');
  }
  if (res.data.diagnostics) {
    await ctx.logger.info(`页面诊断：${command}`, res.data.diagnostics);
  }
  return res.data;
}

const XHS_PUBLISH_GAP_ACTIONS = new Set<ActionName>([
  'upload_media',
  'fill_title',
  'fill_body',
  'fill_description',
  'fill_hashtags',
  'submit_publish',
]);

/** 小红书发布大步骤间随机停顿 */
async function maybeHumanPublishStepGap(ctx: ExecContext, action: ActionName): Promise<void> {
  if (ctx.plan.platform !== 'xiaohongshu' || ctx.plan.taskType !== 'publish') return;
  if (!XHS_PUBLISH_GAP_ACTIONS.has(action)) return;
  const ms = await humanStepGap(ctx.settings);
  if (ms > 0) {
    await ctx.logger.info(`防风控：步骤间等待 ${(ms / 1000).toFixed(1)}s`);
  }
}

/** 频率限制/验证码 → 暂停任务，不自动重试 */
function throwIfRiskPause(res: ActionResult): void {
  if (res.errorCode === 'RATE_LIMITED') {
    throw new PauseSignal(
      'waiting_verification',
      res.message ?? '平台提示操作频繁，请稍后人工处理后再继续',
    );
  }
  if (res.errorCode === 'CAPTCHA_REQUIRED') {
    throw new PauseSignal(
      'waiting_verification',
      res.message ?? '检测到安全验证，请人工处理后继续',
    );
  }
}

/** 单个动作的执行处理 */
async function handleAction(ctx: ExecContext, action: ActionName): Promise<void> {
  await maybeHumanPublishStepGap(ctx, action);
  switch (action) {
    case 'check_login': {
      const t0 = Date.now();
      await setStatus(ctx, 'checking_login', '检测登录状态');
      const res = await runContentCommand(ctx, 'check_login');
      const loginData = res.data as {
        loggedIn?: boolean;
        needVerification?: boolean;
        message?: string;
        verificationMatch?: string;
        loginWall?: boolean;
        onBackend?: boolean;
        url?: string;
      };
      const loggedIn = loginData?.loggedIn ?? res.success;
      const needVerification = loginData?.needVerification;
      const elapsed = Date.now() - t0;

      if (ctx.plan.platform === 'sohu') {
        if (loggedIn) ctx.sohuLoginVerified = true;
        await ctx.logger.info('搜狐登录探测完成', {
          elapsedMs: elapsed,
          frameId: ctx.contentFrameId,
          frameUrl: loginData?.url,
          loggedIn,
          needVerification,
          verificationMatch: loginData?.verificationMatch,
          loginWall: loginData?.loginWall,
          onBackend: loginData?.onBackend,
          message: loginData?.message ?? res.message,
        });
        if (needVerification) {
          await ctx.logger.warn('误报排查：验证码探测命中', {
            verificationMatch: loginData?.verificationMatch,
            frameUrl: loginData?.url,
            frameId: ctx.contentFrameId,
          });
        }
        if (elapsed > 5000) {
          await ctx.logger.warn('check_login 耗时较长', { elapsedMs: elapsed });
        }
      }

      if (!loggedIn) {
        if (needVerification) {
          throw new PauseSignal(
            'waiting_verification',
            loginData?.message ?? '检测到验证码/安全验证，请人工处理后继续',
          );
        }
        throw new PauseSignal(
          'waiting_login',
          `未登录 ${PLATFORM_LABELS[ctx.plan.platform]}，请在打开的页面完成登录后点击「继续」`,
        );
      }
      await ctx.logger.info('登录状态正常');
      break;
    }

    case 'generate_content': {
      if (ctx.content) {
        await setStatus(ctx, 'generating_content', '使用用户自备文案');
        await updateTask(ctx.record.id, { generatedContent: ctx.content });
        await putDraft({
          id: `${ctx.record.id}-draft`,
          taskId: ctx.record.id,
          platform: ctx.plan.platform,
          content: ctx.content,
          createdAt: Date.now(),
        });
        await ctx.logger.info('使用用户自备文案', ctx.content);
        break;
      }
      await setStatus(ctx, 'generating_content', '调用模型生成内容');
      const content = await generateAndStoreContent(ctx);
      await ctx.logger.info('内容生成完成', content);
      break;
    }

    case 'open_publish_page': {
      if (ctx.plan.platform === 'sohu') {
        await openSohuPublishPage(ctx);
        break;
      }
      await setStatus(ctx, 'opening_page', '打开发布页');
      const { publishUrl } = getPlatformUrls(ctx.plan.platform);
      await openTargetUrl(ctx, publishUrl);
      const res = await runContentCommand(ctx, 'ensure_publish_page').catch(
        () => ({ success: false }) as ActionResult,
      );
      if (!res.success) {
        await ctx.logger.warn('未确认发布页组件，继续尝试后续步骤');
      }
      break;
    }

    case 'open_target_page': {
      await setStatus(ctx, 'opening_page', '打开目标页面');
      const url = ctx.plan.targetUrl;
      if (!url) throw new ExecError('PLATFORM_PAGE_CHANGED', '缺少目标页面 URL');
      await openTargetUrl(ctx, url);
      break;
    }

    case 'upload_media': {
      await setStatus(ctx, 'uploading_media', '上传素材');
      const res = await runContentCommand(ctx, 'upload_media', {
        files: ctx.materials,
      });
      if (!res.success) {
        throwIfRiskPause(res);
        throw new ExecError(
          (res.errorCode as ExecError['code']) ?? 'MEDIA_UPLOAD_FAILED',
          res.message ?? '素材上传失败',
        );
      }
      await ctx.logger.info(res.message ?? '素材上传完成');
      break;
    }

    case 'fill_title':
    case 'fill_body':
    case 'fill_description':
    case 'fill_hashtags': {
      // 这四个动作统一在 fill_content 中完成一次填写，避免重复
      if (ctx.filledContent) {
        await ctx.logger.info('内容已填写，跳过重复填写动作');
        break;
      }
      await setStatus(ctx, 'filling_content', '填写内容');
      if (!ctx.content) {
        await ctx.logger.warn('无生成内容可填写，跳过');
        break;
      }
      const publishMode = ctx.materials.length > 0 ? 'image_upload' : 'text_image';
      const res = await runContentCommand(ctx, 'fill_content', {
        content: ctx.content,
        publishMode,
        preferImageUpload: publishMode === 'image_upload',
      });
      if (!res.success) {
        throwIfRiskPause(res);
        throw new ExecError(
          (res.errorCode as ExecError['code']) ?? 'INPUT_FIELD_NOT_FOUND',
          res.message ?? '内容填写失败',
        );
      }
      ctx.filledContent = true;
      await ctx.logger.info('内容填写完成', (res.data as Record<string, unknown>)?.diagnostics ?? res.data);
      break;
    }

    case 'submit_publish': {
      await setStatus(ctx, 'submitting', '提交发布');
      let res = await runContentCommand(ctx, 'submit_publish');
      if (!res.success && res.errorCode === 'BUTTON_NOT_FOUND') {
        res = await runAllFramesPublishFallback(ctx, res);
      }
      if (!res.success) {
        res = await runVisualPublishFallback(ctx, res);
      }
      if (!res.success) {
        throwIfRiskPause(res);
        throw new ExecError(
          (res.errorCode as ExecError['code']) ?? 'SUBMIT_FAILED',
          res.message ?? '发布失败',
        );
      }
      ctx.publishSubmitted = true;
      const resultUrl = (res.data as { resultUrl?: string })?.resultUrl;
      if (resultUrl) await updateTask(ctx.record.id, { resultUrl });
      await ctx.logger.info(res.message ?? '发布成功');
      break;
    }

    case 'fill_comment':
    case 'submit_comment': {
      if (action === 'fill_comment') break; // 评论填写与提交合并在 submit_comment
      await setStatus(ctx, 'submitting', '提交评论');
      if (!getCommentText(ctx.content)) {
        await ctx.logger.info('评论内容缺失，重新生成评论内容');
        await generateAndStoreContent(ctx);
      }
      const comment = getCommentText(ctx.content);
      if (!comment) {
        throw new ExecError('TASK_PARSE_FAILED', '缺少评论内容');
      }
      const res = await runContentCommand(ctx, 'execute_comment', {
        comment,
      });
      if (!res.success) {
        throw new ExecError(
          (res.errorCode as ExecError['code']) ?? 'SUBMIT_FAILED',
          res.message ?? '评论失败',
        );
      }
      await ctx.logger.info('评论已提交');
      break;
    }

    case 'execute_like': {
      const res = await runContentCommand(ctx, 'execute_like');
      if (!res.success) throw new ExecError((res.errorCode as ExecError['code']) ?? 'BUTTON_NOT_FOUND', res.message ?? '点赞失败');
      await ctx.logger.info('已点赞');
      break;
    }
    case 'execute_favorite': {
      const res = await runContentCommand(ctx, 'execute_favorite');
      if (!res.success) throw new ExecError((res.errorCode as ExecError['code']) ?? 'BUTTON_NOT_FOUND', res.message ?? '收藏失败');
      await ctx.logger.info('已收藏');
      break;
    }
    case 'execute_follow': {
      const res = await runContentCommand(ctx, 'execute_follow');
      if (!res.success) throw new ExecError((res.errorCode as ExecError['code']) ?? 'BUTTON_NOT_FOUND', res.message ?? '关注失败');
      await ctx.logger.info('已关注');
      break;
    }

    case 'verify_result': {
      await setStatus(ctx, 'verifying_result', '校验执行结果');
      if (ctx.plan.taskType === 'publish' && (ctx.plan.platform === 'xiaohongshu' || ctx.plan.platform === 'sohu')) {
        const res = await runContentCommand(ctx, 'verify_result', {
          expectPublishSuccess: true,
        });
        if (!res.success) {
          throw new ExecError(
            (res.errorCode as ExecError['code']) ?? 'SUBMIT_FAILED',
            res.message ?? '发布结果校验失败',
          );
        }
        const resultUrl = (res.data as { resultUrl?: string })?.resultUrl;
        if (resultUrl) await updateTask(ctx.record.id, { resultUrl });
        await ctx.logger.info('发布结果校验通过');
        break;
      }
      const res = await runContentCommand(ctx, 'capture_result').catch(
        () => ({ success: true }) as ActionResult,
      );
      const resultUrl = (res.data as { resultUrl?: string })?.resultUrl;
      if (resultUrl) await updateTask(ctx.record.id, { resultUrl });
      await ctx.logger.info('结果已记录');
      break;
    }

    case 'take_screenshot':
      break;

    case 'save_record': {
      await ctx.logger.info('任务记录已保存');
      break;
    }

    case 'pause_for_login': {
      throw new PauseSignal('waiting_login', '请在打开的页面完成登录后继续');
    }
    case 'pause_for_verification': {
      throw new PauseSignal('waiting_verification', '检测到验证码/安全验证，请人工处理后继续');
    }

    default: {
      await ctx.logger.warn(`未知动作已跳过: ${action}`);
    }
  }
}

/** 打开或复用 tab 导航到目标 URL */
async function openTargetUrl(ctx: ExecContext, url: string): Promise<void> {
  const platform = ctx.plan.platform;
  if (ctx.tabId == null) {
    ctx.tabId = await openTab(url, { platform });
    const tab = await chrome.tabs.get(ctx.tabId);
    ctx.windowId = tab.windowId;
    if (platform === 'sohu') {
      invalidateContentFrame(ctx);
      await ensureSohuScriptOrReload(ctx);
    }
    return;
  }
  try {
    const tab = await chrome.tabs.get(ctx.tabId);
    if (tab.url && sameTarget(tab.url, url)) {
      await chrome.tabs.update(ctx.tabId, { active: true });
      await bindPlatformSessionTab(platform, ctx.tabId);
      return;
    }
  } catch {
    // tab 可能已关闭，下面重新导航
  }
  await navigateTab(ctx.tabId, url, { platform });
  await bindPlatformSessionTab(platform, ctx.tabId);
  if (ctx.plan.platform === 'sohu') {
    invalidateContentFrame(ctx);
  }
}

/** 比较两个 URL 是否指向同一页面（忽略 query / hash 差异） */
function sameTarget(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

/**
 * 执行整个任务计划。
 * 从 startIndex 开始执行（用于暂停后恢复）。
 * @returns 完成时的最终状态
 */
export async function executePlan(
  params: {
    record: TaskRecord;
    plan: TaskPlan;
    settings: AppSettings;
    modelConfig: ModelConfig;
    logger: LoggerLike;
    existingTabId?: number;
    content?: GeneratedContent;
  },
  startIndex = 0,
): Promise<{ status: TaskStatus; pausedAt?: number }> {
  const materialRecords = params.plan.materials?.images?.length || params.plan.materials?.videos?.length
    ? await loadMaterials(params)
    : [];

  const ctx: ExecContext = {
    record: params.record,
    plan: params.plan,
    settings: params.settings,
    modelConfig: params.modelConfig,
    logger: params.logger,
    tabId: params.existingTabId,
    content: params.content ? normalizeContentForPlan(params.content, params.plan) : undefined,
    materials: materialRecords,
  };

  if (params.existingTabId != null) {
    await bindPlatformSessionTab(params.plan.platform, params.existingTabId);
  }

  const actions = params.plan.actions;
  for (let i = startIndex; i < actions.length; i++) {
    const action = actions[i];
    try {
      await handleAction(ctx, action);
    } catch (err) {
      if (err instanceof PauseSignal) {
        await setStatus(ctx, err.status, err.message);
        return { status: err.status, pausedAt: i };
      }
      const code = err instanceof ExecError ? err.code : 'SUBMIT_FAILED';
      const message = err instanceof Error ? err.message : String(err);
      await updateTask(ctx.record.id, {
        status: 'failed',
        errorCode: code,
        errorMessage: message,
        finishedAt: Date.now(),
      });
      await ctx.logger.error(`执行失败 [${code}]: ${message}`);
      return { status: 'failed' };
    }
  }

  await updateTask(ctx.record.id, { status: 'success', finishedAt: Date.now() });
  await ctx.logger.status('success', '任务完成');
  return { status: 'success' };
}

/** 把素材记录从 IndexedDB 读出并转为 MediaFile（携带 dataUrl） */
async function loadMaterials(params: {
  plan: TaskPlan;
  record: TaskRecord;
}): Promise<MediaFile[]> {
  const ids = [
    ...(params.plan.materials?.images ?? []),
    ...(params.plan.materials?.videos ?? []),
  ];
  if (!ids.length) return [];
  const records = await getMaterials(ids);
  return records.map((m) => ({
    id: m.id,
    name: m.name,
    mimeType: m.mimeType,
    dataUrl: m.dataUrl,
    size: m.size,
  }));
}
