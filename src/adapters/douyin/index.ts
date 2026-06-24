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

// 抖音适配器：视频发布、评论、点赞、关注（开发文档 Phase 4）。
// 发布走创作者平台 creator.douyin.com/creator-micro/content/upload。

export const DOUYIN_URLS = {
  publishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
  homeUrl: 'https://www.douyin.com',
};

const sel = {
  loggedInFlags: ['.avatar', '[class*="avatar"]', '.user-info', '.semi-avatar'],
  fileInput: ['input[type="file"]', '.upload-btn input[type="file"]'],
  titleInput: [
    'input[placeholder*="标题"]',
    '.title-input input',
    'input.semi-input',
  ],
  descEditor: [
    '.zone-container[contenteditable="true"]',
    'div[contenteditable="true"]',
    '.editor-kit-container [contenteditable="true"]',
  ],
  submitButton: ['button[class*="submit"]', '.content-confirm-container button'],
  successFlags: ['[class*="success"]', '.publish-success'],
  likeButton: ['[class*="like"]', 'xg-icon[class*="like"]'],
  followButton: ['[class*="follow"] button', 'button[class*="follow"]'],
  commentInput: ['.comment-input [contenteditable="true"]', 'textarea[placeholder*="评论"]'],
  commentSubmit: ['button[class*="submit"]', '.submit-btn'],
};

export const douyinAdapter: PlatformAdapter = {
  platform: 'douyin',

  async detectLoginStatus(): Promise<LoginStatus> {
    const loggedIn = Boolean(queryFirst(sel.loggedInFlags));
    return {
      platform: 'douyin',
      loggedIn,
      message: loggedIn ? '已登录' : '未检测到登录状态，请先登录抖音',
    };
  },

  async ensurePublishPage(): Promise<ActionResult> {
    const input = await waitForElement(sel.fileInput, { timeout: 8000, visible: false });
    return input
      ? { success: true, message: '已进入发布页' }
      : {
          success: false,
          errorCode: 'PLATFORM_PAGE_CHANGED',
          message: '未找到视频上传组件',
        };
  },

  async uploadMedia(files: MediaFile[]): Promise<UploadResult> {
    if (!files.length) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: '抖音发布需要至少一个视频文件',
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
      // 视频上传较慢，等待较长时间让页面进入编辑态
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
      const titleEl = await waitForElement<HTMLInputElement>(sel.titleInput, {
        timeout: 10000,
      });
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
      if (descEl) setContentEditable(descEl, descParts.join(''));
    }
    return { success: true, message: '内容填写完成' };
  },

  async submitPublish(): Promise<PublishResult> {
    const btn =
      queryFirst<HTMLElement>(sel.submitButton) ?? findByText('button', '发布');
    if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到发布按钮' };
    simulateClick(btn);
    const success = await waitForElement(sel.successFlags, { timeout: 20000 });
    return success
      ? { success: true, resultUrl: location.href, message: '发布成功' }
      : {
          success: false,
          errorCode: 'RESULT_VERIFY_FAILED',
          message: '已点击发布，请人工确认结果',
        };
  },

  async readPageContent(): Promise<PageContent> {
    return { title: document.title, text: '', url: location.href };
  },

  async executeComment(comment: string): Promise<ActionResult> {
    const input = await waitForElement<HTMLElement>(sel.commentInput, { timeout: 8000 });
    if (!input) return { success: false, errorCode: 'INPUT_FIELD_NOT_FOUND', message: '未找到评论框' };
    simulateClick(input);
    await sleep(300);
    if (input instanceof HTMLTextAreaElement) setNativeValue(input, comment);
    else setContentEditable(input, comment);
    await sleep(400);
    const submit = queryFirst<HTMLElement>(sel.commentSubmit) ?? findByText('button', '发送');
    if (!submit) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到评论提交按钮' };
    simulateClick(submit);
    await sleep(800);
    return { success: true, message: '评论已提交' };
  },

  async executeLike(): Promise<ActionResult> {
    const btn = queryFirst<HTMLElement>(sel.likeButton);
    if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到点赞按钮' };
    simulateClick(btn);
    await sleep(500);
    return { success: true, message: '已点赞' };
  },

  async executeFavorite(): Promise<ActionResult> {
    // 抖音 MVP 不做收藏
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '抖音 MVP 暂不支持收藏' };
  },

  async executeFollow(): Promise<ActionResult> {
    const btn = queryFirst<HTMLElement>(sel.followButton) ?? findByText('button', '关注');
    if (!btn) return { success: false, errorCode: 'BUTTON_NOT_FOUND', message: '未找到关注按钮' };
    simulateClick(btn);
    await sleep(500);
    return { success: true, message: '已关注' };
  },

  async captureResult(): Promise<ResultEvidence> {
    return { resultUrl: location.href, capturedAt: Date.now() };
  },
};
