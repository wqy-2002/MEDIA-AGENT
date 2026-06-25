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
import { initPlatformSessionListeners } from '@/core/storage/platform-session';
import { openTab } from '@/core/executor/tab-manager';

export default defineBackground(() => {
  initPlatformSessionListeners();
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
      // 复用已登录的平台标签页，避免每次检测都打开新 tab
      const platform = message.payload.platform;
      const adapter = getAdapter(platform);
      if (!adapter) return { ok: false, errorMessage: '不支持的平台' };
      const { homeUrl } = getPlatformUrls(platform);
      const tabId = await openTab(homeUrl, { platform });
      return { ok: true, data: { tabId } };
    }

    default:
      return { ok: false, errorMessage: `未处理的消息类型: ${(message as { type: string }).type}` };
  }
}
