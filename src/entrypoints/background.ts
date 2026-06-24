import { onMessage } from '@/core/messaging';
import type { ExtensionMessage, MessageResponse } from '@/core/messaging';
import {
  createTaskPayloadSchema,
  modelConfigSchema,
} from '@/schemas/messages';
import {
  createTask,
  cancelTask,
  retryTask,
  resumeTask,
} from '@/core/task-manager';
import { testModelConnection } from '@/core/model';
import { getAdapter, getPlatformUrls } from '@/adapters/registry';

// Background Service Worker：任务中枢（参见开发文档第 7.3 节）。
// 职责：接收 Side Panel 创建的任务、调用模型、生成计划、管理 tabs、
// 分发任务、接收结果、更新状态、保存日志、处理暂停/恢复/重试/取消。
// 注意：MV3 SW 可能被回收，关键状态写入 IndexedDB / chrome.storage。

export default defineBackground(() => {
  // 点击插件图标打开 Side Panel
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[MediaFlow] 设置 sidePanel 行为失败', err));

  onMessage((message, _sender, sendResponse) => {
    handleMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        } satisfies MessageResponse),
      );
    // 返回 true 表示异步响应
    return true;
  });

  console.info('[MediaFlow] Background 已启动');
});

/** 统一处理来自各页面的消息 */
async function handleMessage(message: ExtensionMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'TASK_CREATE': {
      const parsed = createTaskPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        return { ok: false, errorMessage: parsed.error.issues[0]?.message ?? '参数非法' };
      }
      const record = await createTask(parsed.data);
      return { ok: true, data: record };
    }

    case 'TASK_CANCEL': {
      await cancelTask(message.payload.taskId);
      return { ok: true };
    }

    case 'TASK_RETRY': {
      await retryTask(message.payload.taskId);
      return { ok: true };
    }

    case 'TASK_RESUME': {
      await resumeTask(message.payload.taskId);
      return { ok: true };
    }

    case 'MODEL_TEST': {
      const parsed = modelConfigSchema.safeParse(message.payload);
      if (!parsed.success) {
        return { ok: false, errorMessage: '模型配置不完整：' + (parsed.error.issues[0]?.message ?? '') };
      }
      const result = await testModelConnection(parsed.data);
      return { ok: result.ok, data: result, errorMessage: result.ok ? undefined : result.message };
    }

    case 'PLATFORM_CHECK_LOGIN': {
      // 打开平台主页并检测登录态
      const platform = message.payload.platform;
      const adapter = getAdapter(platform);
      if (!adapter) return { ok: false, errorMessage: '不支持的平台' };
      const { homeUrl } = getPlatformUrls(platform);
      const tab = await chrome.tabs.create({ url: homeUrl, active: true });
      return { ok: true, data: { tabId: tab.id } };
    }

    default:
      return { ok: false, errorMessage: `未处理的消息类型: ${(message as { type: string }).type}` };
  }
}
