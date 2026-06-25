import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanReadyFrame, scanFramePingMatrix } from '@/core/executor/tab-manager';

type ChromeGlobal = typeof globalThis & {
  chrome: {
    tabs: { sendMessage: ReturnType<typeof vi.fn> };
    webNavigation: { getAllFrames: ReturnType<typeof vi.fn> };
    runtime: { lastError?: { message: string } };
  };
};

beforeEach(() => {
  const g = globalThis as ChromeGlobal;
  g.chrome.runtime.lastError = undefined;
  (g.chrome as { webNavigation?: { getAllFrames: ReturnType<typeof vi.fn> } }).webNavigation = {
    getAllFrames: vi.fn(async () =>
      [
        {
          frameId: 0,
          url: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
          errorOccurred: false,
          parentFrameId: -1,
        },
        {
          frameId: 456,
          url: 'about:blank',
          errorOccurred: false,
          parentFrameId: 0,
        },
      ] as chrome.webNavigation.GetAllFrameResultDetails[],
    ),
  };
  g.chrome.tabs.sendMessage = vi.fn(async (_tabId: number, _msg: unknown, opts?: { frameId?: number }) => {
    if (opts?.frameId === 456) {
      return { ok: true, data: { success: true } };
    }
    throw new Error('Could not establish connection. Receiving end does not exist.');
  });
});

describe('scanFramePingMatrix sohu', () => {
  it('应对 about:blank 子 frame 发 PING', async () => {
    const results = await scanFramePingMatrix(1, { platform: 'sohu' });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.frameId === 456)?.ok).toBe(true);
    expect(results.find((r) => r.frameId === 0)?.ok).toBe(false);
  });
});

describe('scanReadyFrame sohu', () => {
  it('about:blank 响应时应返回 ready 且 frameId=456', async () => {
    const result = await scanReadyFrame(1, { platform: 'sohu', preferEditorFrame: false });
    expect(result.ready).toBe(true);
    expect(result.frameId).toBe(456);
  });
});
