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
  sleep,
} from '@/utils/dom';

// 微信公众号适配器：自动创建图文草稿并保存（开发文档 Phase 5）。
// 注意：MVP 只保存草稿，不直接群发。

export const WECHAT_OFFICIAL_URLS = {
  publishUrl: 'https://mp.weixin.qq.com',
  homeUrl: 'https://mp.weixin.qq.com',
};

const sel = {
  loggedInFlags: ['.weui-desktop-account', '.avatar', '[class*="account"]'],
  titleInput: [
    '#title',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
  ],
  authorInput: ['#author', 'input[placeholder*="作者"]'],
  bodyEditor: [
    '#ueditor_0',
    '.ProseMirror',
    'div[contenteditable="true"]',
    'iframe#ueditor_0',
  ],
  digestInput: ['#js_description', 'textarea[placeholder*="摘要"]'],
  saveDraftButton: ['#js_submit', 'button[class*="save"]'],
};

export const wechatOfficialAdapter: PlatformAdapter = {
  platform: 'wechat_official',

  async detectLoginStatus(): Promise<LoginStatus> {
    const loggedIn = Boolean(queryFirst(sel.loggedInFlags));
    return {
      platform: 'wechat_official',
      loggedIn,
      message: loggedIn ? '已登录' : '未检测到登录状态，请先登录公众号后台',
    };
  },

  async ensurePublishPage(): Promise<ActionResult> {
    const title = await waitForElement(sel.titleInput, { timeout: 8000 });
    return title
      ? { success: true, message: '已进入图文编辑页' }
      : {
          success: false,
          errorCode: 'PLATFORM_PAGE_CHANGED',
          message: '未找到图文编辑器，请进入「新建图文消息」页面',
        };
  },

  async uploadMedia(_files: MediaFile[]): Promise<UploadResult> {
    // 公众号封面上传依赖素材库弹窗，MVP 暂不自动化，提示人工处理
    return {
      success: true,
      uploadedCount: 0,
      message: '公众号封面上传需在素材库手动选择，MVP 暂不自动上传',
    };
  },

  async fillContent(content: GeneratedContent): Promise<ActionResult> {
    if (content.title) {
      const titleEl = queryFirst<HTMLInputElement | HTMLTextAreaElement>(sel.titleInput);
      if (titleEl) setNativeValue(titleEl, content.title);
    }
    if (content.body) {
      const bodyEl = await waitForElement<HTMLElement>(sel.bodyEditor, { timeout: 8000 });
      if (bodyEl && !(bodyEl instanceof HTMLIFrameElement)) {
        setContentEditable(bodyEl, content.body);
      }
    }
    if (content.description) {
      const digestEl = queryFirst<HTMLTextAreaElement>(sel.digestInput);
      if (digestEl) setNativeValue(digestEl, content.description);
    }
    return { success: true, message: '图文内容填写完成' };
  },

  async submitPublish(): Promise<PublishResult> {
    // 公众号 MVP 只保存草稿
    const btn =
      findByText('button', '保存为草稿') ??
      findByText('a', '保存为草稿') ??
      queryFirst<HTMLElement>(sel.saveDraftButton);
    if (!btn) {
      return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到「保存为草稿」按钮' };
    }
    simulateClick(btn);
    await sleep(2000);
    return { success: true, resultUrl: location.href, message: '草稿已保存' };
  },

  async readPageContent(): Promise<PageContent> {
    return { title: document.title, text: '', url: location.href };
  },

  async executeComment(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '公众号 MVP 仅支持图文草稿' };
  },
  async executeLike(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '公众号 MVP 仅支持图文草稿' };
  },
  async executeFavorite(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '公众号 MVP 仅支持图文草稿' };
  },
  async executeFollow(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '公众号 MVP 仅支持图文草稿' };
  },

  async captureResult(): Promise<ResultEvidence> {
    return { resultUrl: location.href, capturedAt: Date.now() };
  },
};
