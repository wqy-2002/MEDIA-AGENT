import type { PlatformAdapter } from '@/adapters/types';
import type { FillContentOptions } from '@/adapters/types';
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
  describePageCandidates,
  sleep,
} from '@/utils/dom';
import { xhsSelectors, XHS_URLS } from './selectors';
import {
  detectXhsPublishState,
  runXhsFillContentFlow,
  runXhsSubmitPublishFlow,
  uploadXhsImagesSequentially,
} from './publish-machine';
import {
  detectXhsDetailState,
  runXhsCommentFlow,
  runXhsFavoriteFlow,
  runXhsFollowFlow,
  runXhsLikeFlow,
} from './engagement-machine';
import { collectDiagnostics } from '@/core/automation/diagnostics';

// 小红书适配器：实现图文/视频发布、评论、点赞、收藏、关注（开发文档 Phase 3）。
// 运行在 Content Script，对页面 DOM 进行受约束的自动化操作。

/** 当前页面是否处于"未登录/登录墙"状态 */
function isOnLoginWall(): boolean {
  const url = location.href.toLowerCase();
  if (xhsSelectors.loginUrlKeywords.some((k) => url.includes(k))) return true;
  // 登录墙/扫码弹层这类元素只在未登录时出现，按"是否存在"判断即可
  return Boolean(queryFirst(xhsSelectors.loginWallFlags));
}

/** 当前是否已经进入可编辑发布态（标题框或正文编辑器已出现） */
function hasPublishEditor(): boolean {
  return Boolean(
    queryFirst(xhsSelectors.titleInput, { visible: true }) ||
      queryFirst(xhsSelectors.bodyEditor, { visible: true }),
  );
}

/** 当前是否处于“文字配图”的文字输入/生成态 */
function isTextImageDraftStage(): boolean {
  return Boolean(
    findByText('button,div[role="button"],span', '生成图片') ||
      findByText('button,div[role="button"],span', '再写一张') ||
      (queryFirst(xhsSelectors.bodyEditor, { visible: true }) &&
        !queryFirst(xhsSelectors.titleInput, { visible: true })),
  );
}

/** 点击小红书发布页入口按钮，如“上传图片”“文字配图” */
async function clickPublishEntry(texts: string[]): Promise<boolean> {
  for (const text of texts) {
    const btn = findByText('button,div[role="button"],span', text);
    if (btn) {
      simulateClick(btn);
      await sleep(800);
      return true;
    }
  }
  return false;
}

/** 等待并点击指定文本按钮 */
async function waitAndClickText(texts: string[], timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await clickPublishEntry(texts)) return true;
    await sleep(500);
  }
  return false;
}

/** 无素材发布时，进入“文字配图”编辑态 */
async function ensureTextImageEditor(): Promise<boolean> {
  if (hasPublishEditor()) return true;
  await clickPublishEntry(['文字配图', '图文发布', '发布图文']);
  const editor = await waitForElement(
    [...xhsSelectors.titleInput, ...xhsSelectors.bodyEditor],
    { timeout: 12000 },
  );
  return Boolean(editor);
}

/** 生成小红书最终发布正文文本 */
function buildBodyText(content: GeneratedContent, includeTitle = false): string {
  const parts: string[] = [];
  if (includeTitle && content.title) parts.push(content.title);
  if (content.body) parts.push(content.body);
  if (content.description && content.description !== content.body) parts.push(content.description);
  if (content.hashtags?.length) {
    parts.push(content.hashtags.map((t) => `#${t.replace(/^#/, '')}`).join(' '));
  }
  return parts.filter(Boolean).join('\n');
}

/** 滚动小红书内部发布容器到底部，发布按钮经常在内部滚动区底部 */
async function scrollPublishContainersToBottom(): Promise<void> {
  const containers = [
    document.querySelector<HTMLElement>('.publish-page'),
    document.querySelector<HTMLElement>('.publish-page-content'),
    document.querySelector<HTMLElement>('.main-container'),
    document.scrollingElement as HTMLElement | null,
  ].filter((el): el is HTMLElement => Boolean(el));
  for (const el of containers) {
    el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(500);
}

/** 判断按钮是否处于可点击状态 */
function isUsableButton(el: HTMLElement): boolean {
  const disabled =
    (el instanceof HTMLButtonElement && el.disabled) ||
    el.getAttribute('aria-disabled') === 'true' ||
    /\b(disabled|is-disabled|--disabled)\b/i.test(String(el.className));
  return !disabled;
}

/** 查找最终发布按钮，避开左侧菜单“发布笔记”等非提交按钮 */
function findPublishButton(): HTMLElement | null {
  const candidates = [
    findByText<HTMLElement>('button,div[role="button"]', '发布'),
    queryFirst<HTMLElement>(xhsSelectors.submitButton, { visible: true }),
  ].filter((el): el is HTMLElement => Boolean(el));

  return (
    candidates.find((el) => {
      const text = (el.textContent ?? '').replace(/\s/g, '');
      return text === '发布' && isUsableButton(el);
    }) ??
    candidates.find((el) => isUsableButton(el)) ??
    null
  );
}

/** 等待小红书最终发布表单准备好：图片已生成、标题/正文已可见、发布按钮可点击 */
async function waitForPublishReady(timeout = 60000): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await scrollPublishContainersToBottom();
    const button = findPublishButton();
    const title = queryFirst<HTMLInputElement | HTMLTextAreaElement>(xhsSelectors.titleInput, {
      visible: true,
    });
    const body = queryFirst<HTMLElement>(xhsSelectors.bodyEditor, { visible: true });
    const generating =
      document.body.innerText.includes('图片生成中') ||
      document.body.innerText.includes('生成中') ||
      document.body.innerText.includes('上传中') ||
      document.body.innerText.includes('处理中');
    if (button && !generating && (title || body)) return button;
    await sleep(1000);
  }
  return null;
}

/** 处理“文字配图”流程：输入文字 → 生成图片 → 下一步 → 进入最终发布表单 */
async function completeTextImageFlow(content: GeneratedContent): Promise<ActionResult> {
  const editor = await waitForElement<HTMLElement>(xhsSelectors.bodyEditor, {
    timeout: 12000,
  });
  if (!editor) {
    return {
      success: false,
      errorCode: 'INPUT_FIELD_NOT_FOUND',
      message: `未找到文字配图编辑器。\n${describePageCandidates()}`,
    };
  }

  const draftText = buildBodyText(content, true);
  if (editor instanceof HTMLTextAreaElement) {
    setNativeValue(editor, draftText);
  } else {
    setContentEditable(editor, draftText);
  }
  await sleep(600);

  const generated = await waitAndClickText(['生成图片'], 30000);
  if (!generated) {
    return {
      success: false,
      errorCode: 'BUTTON_NOT_FOUND',
      message: `未找到“生成图片”按钮。\n${describePageCandidates()}`,
    };
  }

  const next = await waitAndClickText(['下一步'], 60000);
  if (!next) {
    return {
      success: false,
      errorCode: 'BUTTON_NOT_FOUND',
      message: `图片生成后未找到“下一步”按钮。\n${describePageCandidates()}`,
    };
  }

  const titleOrBody = await waitForElement(
    [...xhsSelectors.titleInput, ...xhsSelectors.bodyEditor],
    { timeout: 20000 },
  );
  if (!titleOrBody) {
    return {
      success: false,
      errorCode: 'INPUT_FIELD_NOT_FOUND',
      message: `进入下一步后未找到最终发布表单。\n${describePageCandidates()}`,
    };
  }

  return { success: true, message: '文字配图已生成并进入发布表单' };
}

export const xiaohongshuAdapter: PlatformAdapter = {
  platform: 'xiaohongshu',

  async detectLoginStatus(): Promise<LoginStatus> {
    // 健壮的登录判定策略（避免"已登录却被误判未登录"）：
    // 1) 若出现明确的登录墙（登录页 URL / 扫码登录弹层）→ 未登录；
    // 2) 否则默认视为已登录并继续，把不确定性交给后续具体操作，
    //    这样不会因为头像选择器失配而错误阻塞用户。
    if (isOnLoginWall()) {
      return {
        platform: 'xiaohongshu',
        loggedIn: false,
        needVerification: false,
        message: '检测到小红书登录页/扫码登录，请先在该页面完成登录',
      };
    }
    const hasUserFlag = Boolean(queryFirst(xhsSelectors.loggedInFlags));
    return {
      platform: 'xiaohongshu',
      loggedIn: true,
      message: hasUserFlag ? '已登录' : '未发现登录墙，按已登录继续（如后续失败请确认登录态）',
    };
  },

  async detectState(): Promise<ActionResult> {
    const publishState = detectXhsPublishState();
    const detailState = detectXhsDetailState();
    const state = publishState !== 'unknown' ? publishState : detailState;
    const diagnostics = collectDiagnostics(state);
    return {
      success: true,
      data: { state, publishState, detailState, diagnostics },
      message: `当前小红书状态: ${state}`,
      diagnostics,
    };
  },

  async getDiagnostics() {
    const publishState = detectXhsPublishState();
    const detailState = detectXhsDetailState();
    return collectDiagnostics(publishState !== 'unknown' ? publishState : detailState);
  },

  async runPublishFlow(content: GeneratedContent, files?: MediaFile[]): Promise<PublishResult> {
    const preferImageUpload = Boolean(files?.length);
    const publishMode = preferImageUpload ? 'image_upload' : 'text_image';
    if (files?.length) {
      const uploaded = await this.uploadMedia(files);
      if (!uploaded.success) {
        return {
          success: false,
          errorCode: uploaded.errorCode,
          message: uploaded.message,
        };
      }
    }
    const filled = await runXhsFillContentFlow(content, { preferImageUpload, publishMode });
    if (!filled.success) {
      return {
        success: false,
        errorCode: filled.errorCode,
        message: filled.message,
      };
    }
    return runXhsSubmitPublishFlow();
  },

  async runEngagementFlow(action, args): Promise<ActionResult> {
    if (action === 'comment') return runXhsCommentFlow((args?.comment as string) ?? '');
    if (action === 'like') return runXhsLikeFlow();
    if (action === 'favorite') return runXhsFavoriteFlow();
    if (action === 'follow') return runXhsFollowFlow();
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: `不支持的互动动作: ${action}` };
  },

  async ensurePublishPage(): Promise<ActionResult> {
    // 发布页需要先确保选中"上传图文"tab，再确认上传组件存在
    const tab =
      findByText('div,span,button', '上传图文') ?? findByText('div,span,button', '图文');
    if (tab) {
      simulateClick(tab);
      await sleep(800);
    }
    // 小红书发布页可能处于两种状态：
    // 1. 入口态：只显示“上传图片 / 文字配图”；
    // 2. 编辑态：标题框 / 正文编辑器已经出现。
    // 二者都说明页面可用，具体进入哪种编辑态由 uploadMedia/fillContent 决定。
    if (
      hasPublishEditor() ||
      findByText('button,div[role="button"],span', '上传图片') ||
      findByText('button,div[role="button"],span', '文字配图')
    ) {
      return { success: true, message: '已进入发布页' };
    }
    // 文件上传 input 通常是隐藏的，查找时不要求可见；若存在也说明发布页可用
    const fileInput = await waitForElement(xhsSelectors.fileInput, {
      timeout: 10000,
      visible: false,
    });
    if (!fileInput) {
      return {
        success: false,
        errorCode: 'PLATFORM_PAGE_CHANGED',
        message: `未找到发布页上传组件，页面可能未进入发布页或结构已变化。\n${describePageCandidates()}`,
      };
    }
    return { success: true, message: '已进入发布页' };
  },

  async uploadMedia(files: MediaFile[]): Promise<UploadResult> {
    if (!files.length) {
      return { success: true, uploadedCount: 0, message: '无素材需要上传' };
    }
    try {
      const fileObjs = files
        .filter((f) => f.dataUrl)
        .map((f) => dataUrlToFile(f.dataUrl as string, f.name));
      if (!fileObjs.length) {
        return {
          success: false,
          uploadedCount: 0,
          errorCode: 'MEDIA_UPLOAD_FAILED',
          message: '素材数据为空，无法上传。请重新选择图片或视频素材。',
        };
      }
      // 对齐 xiaohongshu-mcp：切换图文页签后逐张上传并等待预览
      return uploadXhsImagesSequentially(fileObjs);
    } catch (err) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fillContent(content: GeneratedContent, options?: FillContentOptions): Promise<ActionResult> {
    const publishMode =
      options?.publishMode ??
      (options?.preferImageUpload ? 'image_upload' : 'text_image');
    return runXhsFillContentFlow(content, {
      preferImageUpload: options?.preferImageUpload,
      publishMode,
    });
  },

  async submitPublish(): Promise<PublishResult> {
    return runXhsSubmitPublishFlow();
    /*
    // 等待所有内容生成/填写完成，并滚动内部容器让底部发布按钮进入可点击状态
    const btn = await waitForPublishReady(60000);
    if (!btn) {
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: `等待发布就绪超时：未找到可点击的发布按钮，或页面仍在生成/上传中。\n${describePageCandidates()}`,
      };
    }
    btn.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(300);
    simulateClick(btn);

    // 小红书有时没有明确成功页，只出现 Toast 或跳转到管理页/笔记页。
    const start = Date.now();
    while (Date.now() - start < 45000) {
      if (
        document.body.innerText.includes('发布成功') ||
        document.body.innerText.includes('已发布') ||
        document.body.innerText.includes('发布审核中') ||
        document.body.innerText.includes('笔记管理') && !findPublishButton()
      ) {
        return { success: true, resultUrl: location.href, message: '发布已提交' };
      }
      const success = queryFirst<HTMLElement>(xhsSelectors.publishSuccessFlags);
      if (success) return { success: true, resultUrl: location.href, message: '发布成功' };
      await sleep(1000);
    }

    // 已经成功点击可用的“发布”按钮，但平台未给出稳定成功标志。
    // 这里按“已提交”返回成功，后续日志保留当前 URL 供人工核验，避免误报失败。
    return { success: true, resultUrl: location.href, message: '已点击发布，未检测到失败提示，按已提交处理' };
    */
  },

  async readPageContent(): Promise<PageContent> {
    return {
      title: document.title,
      text: document.querySelector('#detail-title')?.textContent ?? '',
      url: location.href,
    };
  },

  async executeComment(comment: string): Promise<ActionResult> {
    return runXhsCommentFlow(comment);
    /*
    const input = await waitForElement<HTMLElement>(xhsSelectors.commentInput, {
      timeout: 8000,
    });
    if (!input) {
      return {
        success: false,
        errorCode: 'INPUT_FIELD_NOT_FOUND',
        message: `未找到评论输入框。\n${describePageCandidates()}`,
      };
    }
    simulateClick(input);
    await sleep(400);
    if (input instanceof HTMLTextAreaElement) {
      setNativeValue(input, comment);
    } else {
      setContentEditable(input, comment);
    }
    await sleep(600);
    const submit =
      findByText('button', '发送') ??
      queryFirst<HTMLElement>(xhsSelectors.commentSubmit, { visible: true });
    if (!submit) {
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: `未找到评论提交按钮。\n${describePageCandidates()}`,
      };
    }
    simulateClick(submit);
    await sleep(1000);
    return { success: true, message: '评论已提交' };
    */
  },

  async executeLike(): Promise<ActionResult> {
    return runXhsLikeFlow();
    /*
    const btn = queryFirst<HTMLElement>(xhsSelectors.likeButton);
    if (!btn)
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: `未找到点赞按钮。\n${describePageCandidates()}`,
      };
    simulateClick(btn);
    await sleep(600);
    return { success: true, message: '已点赞' };
    */
  },

  async executeFavorite(): Promise<ActionResult> {
    return runXhsFavoriteFlow();
    /*
    const btn = queryFirst<HTMLElement>(xhsSelectors.favoriteButton);
    if (!btn)
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: `未找到收藏按钮。\n${describePageCandidates()}`,
      };
    simulateClick(btn);
    await sleep(600);
    return { success: true, message: '已收藏' };
    */
  },

  async executeFollow(): Promise<ActionResult> {
    return runXhsFollowFlow();
    /*
    const btn =
      findByText('button,div[role="button"]', '关注') ??
      queryFirst<HTMLElement>(xhsSelectors.followButton, { visible: true });
    if (!btn)
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: `未找到关注按钮。\n${describePageCandidates()}`,
      };
    simulateClick(btn);
    await sleep(600);
    return { success: true, message: '已关注' };
    */
  },

  async captureResult(): Promise<ResultEvidence> {
    return { resultUrl: location.href, capturedAt: Date.now() };
  },
};

export { XHS_URLS };
