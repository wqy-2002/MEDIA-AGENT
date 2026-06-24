import type { PlatformAdapter } from '@/adapters/types';
import type {
  ActionResult,
  GeneratedContent,
  LoginStatus,
  MediaFile,
  PageContent,
  PublishResult,
  ResultEvidence,
  UploadResult,
} from '@/types';
import {
  waitForElement,
  queryFirst,
  setNativeValue,
  setContentEditable,
  simulateClick,
  findByText,
  dataUrlToFile,
  injectFiles,
  sleep,
} from '@/utils/dom';

// 微信视频号适配器：视频发布（开发文档 Phase 4）。
// 发布走 channels.weixin.qq.com/platform/post/create。

export const WECHAT_CHANNEL_URLS = {
  publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
  homeUrl: 'https://channels.weixin.qq.com',
};

const sel = {
  loggedInFlags: ['.account-info', '.avatar', '[class*="avatar"]'],
  fileInput: ['input[type="file"]', '.upload-content input[type="file"]'],
  descEditor: [
    '.input-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="描述"]',
  ],
  titleInput: ['input[placeholder*="标题"]', '.short-title-wrap input'],
  submitButton: ['button.weui-desktop-btn_primary', 'button[class*="primary"]'],
  successFlags: ['[class*="success"]'],
};

export const wechatChannelAdapter: PlatformAdapter = {
  platform: 'wechat_channel',

  async detectLoginStatus(): Promise<LoginStatus> {
    const loggedIn = Boolean(queryFirst(sel.loggedInFlags));
    return {
      platform: 'wechat_channel',
      loggedIn,
      message: loggedIn ? '已登录' : '未检测到登录状态，请先登录视频号',
    };
  },

  async ensurePublishPage(): Promise<ActionResult> {
    const input = await waitForElement(sel.fileInput, { timeout: 8000, visible: false });
    return input
      ? { success: true, message: '已进入发布页' }
      : { success: false, errorCode: 'PLATFORM_PAGE_CHANGED', message: '未找到视频上传组件' };
  },

  async uploadMedia(files: MediaFile[]): Promise<UploadResult> {
    if (!files.length) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: '视频号发布需要一个视频文件',
      };
    }
    const input = await waitForElement<HTMLInputElement>(sel.fileInput, {
      timeout: 10000,
      visible: false,
    });
    if (!input) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'INPUT_FIELD_NOT_FOUND',
        message: '未找到视频上传输入框',
      };
    }
    try {
      const fileObjs = files
        .filter((f) => f.dataUrl)
        .map((f) => dataUrlToFile(f.dataUrl as string, f.name));
      injectFiles(input, fileObjs);
      await sleep(4000);
      return { success: true, uploadedCount: fileObjs.length, message: '视频已开始上传' };
    } catch (err) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fillContent(content: GeneratedContent): Promise<ActionResult> {
    if (content.title) {
      const titleEl = queryFirst<HTMLInputElement>(sel.titleInput);
      if (titleEl) setNativeValue(titleEl, content.title);
    }
    const descParts: string[] = [];
    if (content.description) descParts.push(content.description);
    else if (content.body) descParts.push(content.body);
    if (content.hashtags?.length) {
      descParts.push(' ' + content.hashtags.map((t) => `#${t}`).join(' '));
    }
    if (descParts.length) {
      const descEl = await waitForElement<HTMLElement>(sel.descEditor, { timeout: 8000 });
      if (descEl) {
        if (descEl instanceof HTMLTextAreaElement) setNativeValue(descEl, descParts.join(''));
        else setContentEditable(descEl, descParts.join(''));
      }
    }
    return { success: true, message: '内容填写完成' };
  },

  async submitPublish(): Promise<PublishResult> {
    const btn =
      findByText('button', '发表') ?? queryFirst<HTMLElement>(sel.submitButton);
    if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到发表按钮' };
    simulateClick(btn);
    const success = await waitForElement(sel.successFlags, { timeout: 20000 });
    return success
      ? { success: true, resultUrl: location.href, message: '发表成功' }
      : { success: false, errorCode: 'RESULT_VERIFY_FAILED', message: '已点击发表，请人工确认' };
  },

  async readPageContent(): Promise<PageContent> {
    return { title: document.title, text: '', url: location.href };
  },

  async executeComment(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '视频号 MVP 仅支持视频发布' };
  },
  async executeLike(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '视频号 MVP 仅支持视频发布' };
  },
  async executeFavorite(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '视频号 MVP 仅支持视频发布' };
  },
  async executeFollow(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '视频号 MVP 仅支持视频发布' };
  },

  async captureResult(): Promise<ResultEvidence> {
    return { resultUrl: location.href, capturedAt: Date.now() };
  },
};
