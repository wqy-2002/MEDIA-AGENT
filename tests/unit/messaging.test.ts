import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendToTab } from '@/core/messaging';

describe('sendToTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应默认向主 frame (frameId:0) 发送消息', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: { success: true } }));
    (globalThis as unknown as { chrome: { tabs: { sendMessage: typeof sendMessage } } }).chrome = {
      tabs: { sendMessage },
    };

    await sendToTab(42, { type: 'PING' });

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PING' }, { frameId: 0 });
  });

  it('应支持指定子 frame', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: { success: true } }));
    (globalThis as unknown as { chrome: { tabs: { sendMessage: typeof sendMessage } } }).chrome = {
      tabs: { sendMessage },
    };

    await sendToTab(42, { type: 'CONTENT_EXECUTE_ACTION', payload: {} as never }, { frameId: 3 });

    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'CONTENT_EXECUTE_ACTION', payload: {} },
      { frameId: 3 },
    );
  });
});
