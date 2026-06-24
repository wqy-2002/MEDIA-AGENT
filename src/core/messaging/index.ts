import type { ExtensionMessage, MessageResponse, TaskStatusPayload } from './types';

// 消息通信工具：封装 chrome.runtime / chrome.tabs 的发送与监听，统一类型。

/** 向 Background 发送消息并等待响应 */
export async function sendToBackground<T = unknown>(
  message: ExtensionMessage,
): Promise<MessageResponse<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
    return res ?? { ok: false, errorMessage: '无响应' };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 向指定标签页的 Content Script 发送消息（默认主 frame，避免 about:blank 子 frame 抢答） */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage,
  options?: { frameId?: number },
): Promise<MessageResponse<T>> {
  const frameId = options?.frameId ?? 0;
  try {
    const res = (await chrome.tabs.sendMessage(tabId, message, { frameId })) as MessageResponse<T>;
    return res ?? { ok: false, errorMessage: '无响应' };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 监听扩展消息，返回取消监听的函数 */
export function onMessage(
  handler: (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => boolean | void,
): () => void {
  const listener = (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => handler(message, sender, sendResponse);
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** 广播任务状态更新到所有监听者（主要给 Side Panel） */
export function broadcastTaskStatus(payload: TaskStatusPayload): void {
  // sendMessage 在无接收方时会 reject，这里忽略错误
  chrome.runtime
    .sendMessage({ type: 'TASK_STATUS_UPDATE', payload } satisfies ExtensionMessage)
    .catch(() => void 0);
}

export * from './types';
