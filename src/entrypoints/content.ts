import type { ActionResult, GeneratedContent, MediaFile } from '@/types';
import type { ContentCommand, PlatformAdapter } from '@/adapters/types';
import type { ExecuteActionPayload, MessageResponse } from '@/core/messaging';
import { getAdapter, platformFromUrl } from '@/adapters/registry';
import { collectDiagnostics } from '@/core/automation/diagnostics';
import { verifyTextAppears } from '@/core/automation/verifier';
import { isVisible, simulateClick } from '@/utils/dom';
import {
  runXhsFramePublishClickFlow,
  scanXhsPublishButtons,
  verifyXhsPublishSuccess,
} from '@/adapters/xiaohongshu/publish-machine';
import { verifySohuPublishSuccess } from '@/adapters/sohu/publish';
import { shouldIgnoreContentMessage, getTopFrameHostname } from '@/adapters/sohu/content-frame';

export default defineContentScript({
  matches: [
    '*://*.xiaohongshu.com/*',
    '*://*.sohu.com/*',
    '*://mp.sohu.com/*',
  ],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_start',
  main() {
    chrome.runtime.onMessage.addListener(
      (
        message: { type: string; payload?: ExecuteActionPayload },
        _sender,
        sendResponse: (res: MessageResponse<ActionResult>) => void,
      ) => {
        if (shouldIgnoreContentMessage()) return false;

        if (message.type === 'PING') {
          sendResponse({ ok: true, data: { success: true } });
          return true;
        }

        if (message.type === 'CONTENT_EXECUTE_ACTION' && message.payload) {
          dispatchCommand(message.payload)
            .then((data) => sendResponse({ ok: true, data }))
            .catch((err) =>
              sendResponse({
                ok: false,
                errorMessage: err instanceof Error ? err.message : String(err),
              }),
            );
          return true;
        }
        return false;
      },
    );

    console.info('[MediaFlow] Content Script 已注入:', {
      host: location.host,
      href: location.href,
      topHost: getTopFrameHostname(),
    });
  },
});

/** 根据命令分发到平台 Adapter */
async function dispatchCommand(payload: ExecuteActionPayload): Promise<ActionResult> {
  const platform = payload.platform ?? platformFromUrl(location.href);
  if (!platform) {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '当前页面不属于受支持平台' };
  }
  const adapter = getAdapter(platform);
  if (!adapter) {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: `未实现平台适配器: ${platform}` };
  }
  return executeCommand(adapter, payload.command, payload.args ?? {});
}

/** 按视口归一化坐标点击，用于 DOM 无法识别按钮时的视觉定位兜底 */
async function clickViewportPoint(args: Record<string, unknown>): Promise<ActionResult> {
  const xRatio = Number(args.xRatio);
  const yRatio = Number(args.yRatio);
  if (
    !Number.isFinite(xRatio) ||
    !Number.isFinite(yRatio) ||
    xRatio < 0 ||
    xRatio > 1 ||
    yRatio < 0 ||
    yRatio > 1
  ) {
    return {
      success: false,
      errorCode: 'BUTTON_NOT_FOUND',
      message: '视口点击坐标无效',
    };
  }

  const x = Math.round(window.innerWidth * xRatio);
  const y = Math.round(window.innerHeight * yRatio);
  const target = document.elementFromPoint(x, y);
  const el = target instanceof HTMLElement ? target : target?.parentElement;
  if (!el || !isVisible(el)) {
    return {
      success: false,
      errorCode: 'BUTTON_NOT_FOUND',
      message: `坐标 (${x}, ${y}) 未命中可见元素`,
      diagnostics: collectDiagnostics('visual_click_miss'),
    };
  }

  const beforeUrl = location.href;
  simulateClick(el);

  const verifyTexts = Array.isArray(args.verifyTexts)
    ? args.verifyTexts.filter((x): x is string => typeof x === 'string')
    : [];
  if (!verifyTexts.length) {
    return { success: true, message: `已点击视口坐标 (${x}, ${y})` };
  }

  const verified = await verifyTextAppears(verifyTexts, {
    timeout: Number(args.verifyTimeout) || 45000,
    state: 'visual_submitting',
  });
  if (verified.success) {
    return { success: true, data: { resultUrl: location.href }, message: '视觉点击后检测到发布结果' };
  }

  const diagnostics = collectDiagnostics('visual_submitting');
  const hasFailure = diagnostics.blockers.some((item) => /失败|阻塞|必填|验证/.test(item));
  if (!hasFailure && location.href !== beforeUrl) {
    return {
      success: true,
      data: { resultUrl: location.href },
      message: '视觉点击后页面状态已变化，按已提交处理',
      diagnostics,
    };
  }
  return {
    ...verified,
    diagnostics: verified.diagnostics ?? diagnostics,
  };
}

/** 把 ContentCommand 映射到 Adapter 方法 */
async function executeCommand(
  adapter: PlatformAdapter,
  command: ContentCommand,
  args: Record<string, unknown>,
): Promise<ActionResult> {
  switch (command) {
    case 'check_login': {
      const status = await adapter.detectLoginStatus();
      return { success: status.loggedIn, data: status, message: status.message };
    }
    case 'detect_state':
      return adapter.detectState
        ? adapter.detectState()
        : { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '当前平台未实现状态检测' };
    case 'get_diagnostics': {
      if (!adapter.getDiagnostics) {
        return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '当前平台未实现诊断采集' };
      }
      const diagnostics = await adapter.getDiagnostics();
      return { success: true, data: diagnostics, diagnostics };
    }
    case 'ensure_publish_page':
      return adapter.ensurePublishPage();
    case 'upload_media':
      return adapter.uploadMedia((args.files as MediaFile[]) ?? []);
    case 'fill_content': {
      const publishMode = args.publishMode as 'image_upload' | 'text_image' | undefined;
      const preferImageUpload = Boolean(args.preferImageUpload);
      if (adapter.platform === 'xiaohongshu') {
        return adapter.fillContent((args.content as GeneratedContent) ?? {}, {
          publishMode,
          preferImageUpload,
        });
      }
      return adapter.fillContent((args.content as GeneratedContent) ?? {});
    }
    case 'submit_publish': {
      const r = await adapter.submitPublish();
      return { success: r.success, data: r, errorCode: r.errorCode, message: r.message };
    }
    case 'run_publish_flow': {
      if (!adapter.runPublishFlow) {
        return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '当前平台未实现完整发布流程' };
      }
      const r = await adapter.runPublishFlow(
        (args.content as GeneratedContent) ?? {},
        (args.files as MediaFile[]) ?? [],
      );
      return { success: r.success, data: r, errorCode: r.errorCode, message: r.message };
    }
    case 'run_engagement_flow': {
      if (!adapter.runEngagementFlow) {
        return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '当前平台未实现完整互动流程' };
      }
      const action = args.action as 'comment' | 'like' | 'favorite' | 'follow';
      return adapter.runEngagementFlow(action, args);
    }
    case 'read_page': {
      const p = await adapter.readPageContent();
      return { success: true, data: p };
    }
    case 'execute_comment':
      return adapter.executeComment((args.comment as string) ?? '');
    case 'execute_like':
      return adapter.executeLike();
    case 'execute_favorite':
      return adapter.executeFavorite();
    case 'execute_follow':
      return adapter.executeFollow();
    case 'verify_result': {
      if (args.expectPublishSuccess && adapter.platform === 'xiaohongshu') {
        const verified = await verifyXhsPublishSuccess(15000);
        const evidence = await adapter.captureResult();
        if (!verified.success) {
          return {
            success: false,
            errorCode: 'SUBMIT_FAILED',
            message: `发布结果校验失败：${verified.message ?? '未检测到成功提示'}`,
            data: evidence,
          };
        }
        return { success: true, data: evidence, message: '发布结果校验通过' };
      }
      if (args.expectPublishSuccess && adapter.platform === 'sohu') {
        const verified = await verifySohuPublishSuccess(15000);
        const evidence = await adapter.captureResult();
        if (!verified.success) {
          return {
            success: false,
            errorCode: 'SUBMIT_FAILED',
            message: `发布结果校验失败：${verified.message ?? '未检测到成功提示'}`,
            data: evidence,
          };
        }
        return { success: true, data: evidence, message: '发布结果校验通过' };
      }
      return adapter.captureResult().then((e) => ({ success: true, data: e }));
    }
    case 'capture_result': {
      const e = await adapter.captureResult();
      return { success: true, data: e };
    }
    case 'click_viewport_point':
      return clickViewportPoint(args);
    case 'scan_publish_button': {
      if (adapter.platform !== 'xiaohongshu') {
        return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '仅小红书支持发布按钮扫描' };
      }
      const scan = scanXhsPublishButtons();
      return {
        success: true,
        data: {
          hasEnabledPublishButton: scan.enabledButtons.length > 0,
          hasDisabledPublishButton: scan.disabledButtons.length > 0,
          scan: scan.safeData,
        },
        diagnostics: collectDiagnostics('scan_publish_button'),
      };
    }
    case 'click_publish_button': {
      if (adapter.platform !== 'xiaohongshu') {
        return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '仅小红书支持发布按钮点击' };
      }
      const r = await runXhsFramePublishClickFlow();
      return { success: r.success, data: r, errorCode: r.errorCode, message: r.message };
    }
    default:
      return { success: false, message: `未知命令: ${command}` };
  }
}
