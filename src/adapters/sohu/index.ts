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
  simulateClick,
  findByText,
  injectFiles,
  dataUrlToFile,
  sleep,
  fillQuillEditor,
  getEditableText,
} from '@/utils/dom';
import { sohuSelectors, SOHU_URLS } from './selectors';
import { verifySohuPublishSuccess } from './publish';
import { probeSohuFrameState, probeSohuLoginState } from './readiness';
import { collectDiagnostics } from '@/core/automation/diagnostics';

function dismissPopups(): void {
  for (const sel of sohuSelectors.popCover) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      try {
        el.remove();
      } catch {
        // 框架托管遮罩可能无法移除
      }
    });
  }
  const closeBtn =
    findByText('button,span,a', '关闭') ??
    findByText('button,span,a', '知道了') ??
    findByText('button,span,a', '跳过');
  if (closeBtn) simulateClick(closeBtn);
}

/** 搜狐 v4 发布按钮为 li.publish-report-btn，不是 button */
function findSohuPublishButton(): HTMLElement | null {
  const direct = queryFirst<HTMLElement>(sohuSelectors.publishButton, { visible: true });
  if (direct) return direct;

  const candidates = document.querySelectorAll<HTMLElement>('li.publish-report-btn');
  for (const el of candidates) {
    const text = (el.textContent ?? '').replace(/\s/g, '');
    if (text !== '发布') continue;
    if (/negative-button|timeout-pub/.test(el.className)) continue;
    if (el.classList.contains('positive-button') || el.classList.contains('active')) {
      return el;
    }
  }

  return findByText<HTMLElement>('li,button,div[role="button"]', '发布');
}

/** 发布按钮是否不可用（li 用 active/positive/negative 类判断） */
function isSohuPublishDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement) {
    return el.disabled || el.getAttribute('aria-disabled') === 'true';
  }
  if (el.classList.contains('publish-report-btn')) {
    if (
      el.classList.contains('disabled') ||
      el.classList.contains('negative-button') ||
      el.classList.contains('timeout-pub')
    ) {
      return true;
    }
    return !(el.classList.contains('active') || el.classList.contains('positive-button'));
  }
  return false;
}

async function findTitleInput(): Promise<HTMLElement | null> {
  return (
    queryFirst<HTMLElement>(sohuSelectors.titleInput, { visible: false }) ??
    (await waitForElement(sohuSelectors.titleInput, { timeout: 8000, visible: false }))
  );
}

async function findBodyEditor(): Promise<HTMLElement | null> {
  return (
    queryFirst<HTMLElement>(sohuSelectors.bodyEditor, { visible: false }) ??
    (await waitForElement(sohuSelectors.bodyEditor, { timeout: 8000, visible: false }))
  );
}

async function fillTags(tags: string[]): Promise<void> {
  const input =
    queryFirst<HTMLInputElement>(sohuSelectors.tagInput, { visible: false }) ??
    queryFirst<HTMLInputElement>(['input[placeholder*="标签"]'], { visible: false });
  if (!input) return;

  for (const raw of tags) {
    const tag = raw.replace(/^#/, '').trim();
    if (!tag) continue;
    simulateClick(input);
    setNativeValue(input, tag);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(400);
  }
}

export const sohuAdapter: PlatformAdapter = {
  platform: 'sohu',

  async detectState(): Promise<ActionResult> {
    const state = probeSohuFrameState();
    const login = probeSohuLoginState();
    return {
      success: !state.loginWall,
      data: { ...state, ...login },
      message: state.editorReady
        ? '搜狐编辑器已就绪'
        : state.loginWall
          ? '检测到搜狐登录墙'
          : '搜狐页面已加载，编辑器未就绪',
    };
  },

  async detectLoginStatus(): Promise<LoginStatus> {
    const probe = probeSohuLoginState();
    return {
      platform: 'sohu',
      loggedIn: probe.loggedIn,
      needVerification: probe.needVerification,
      message: probe.message,
      verificationMatch: probe.verificationMatch,
      loginWall: probe.loginWall,
      onBackend: probe.onBackend,
      url: probe.url,
    };
  },

  async ensurePublishPage(): Promise<ActionResult> {
    dismissPopups();
    const url = location.href.toLowerCase();
    if (!url.includes('addarticle') && !url.includes('article/new') && !url.includes('article/edit')) {
      return {
        success: false,
        errorCode: 'PLATFORM_PAGE_CHANGED',
        message: '当前不在搜狐号发文页，请从内容管理进入「发文」',
      };
    }
    const title = await findTitleInput();
    const editor = await findBodyEditor();
    if (!title && !editor) {
      return {
        success: false,
        errorCode: 'PLATFORM_PAGE_CHANGED',
        message: '未找到搜狐号文章编辑器（标题或正文区域）',
      };
    }
    return { success: true, message: '已进入搜狐号发文编辑页' };
  },

  async uploadMedia(files: MediaFile[]): Promise<UploadResult> {
    if (!files.length) {
      return { success: true, uploadedCount: 0, message: '无封面素材，跳过上传' };
    }

    const image = files.find((f) => f.dataUrl && f.mimeType.startsWith('image/'));
    if (!image?.dataUrl) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: '封面素材无效，请上传图片',
      };
    }

    dismissPopups();
    const trigger =
      queryFirst<HTMLElement>(sohuSelectors.coverUploadTrigger, { visible: true }) ??
      findByText('div,button,span', '上传封面') ??
      findByText('div,button,span', '封面');
    if (trigger) {
      simulateClick(trigger);
      await sleep(800);
    }

    const localTab = findByText('div,span,button', '本地上传');
    if (localTab) {
      simulateClick(localTab);
      await sleep(500);
    }

    let fileInput = queryFirst<HTMLInputElement>(sohuSelectors.coverFileInput, { visible: false });
    if (!fileInput) {
      fileInput = await waitForElement<HTMLInputElement>(['input[type="file"]'], {
        timeout: 8000,
        visible: false,
      });
    }
    if (!fileInput) {
      return {
        success: false,
        uploadedCount: 0,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        message: '未找到封面上传控件',
      };
    }

    const file = dataUrlToFile(image.dataUrl, image.name || 'cover.jpg');
    injectFiles(fileInput, [file]);
    await sleep(1500);

    const confirm =
      queryFirst<HTMLElement>(sohuSelectors.coverConfirmButton, { visible: true }) ??
      findByText('button', '确定') ??
      findByText('button', '确认');
    if (confirm) {
      simulateClick(confirm);
      await sleep(800);
    }

    return { success: true, uploadedCount: 1, message: '封面已上传' };
  },

  async fillContent(content: GeneratedContent): Promise<ActionResult> {
    dismissPopups();

    if (content.title) {
      const titleEl = await findTitleInput();
      if (!titleEl) {
        return {
          success: false,
          errorCode: 'INPUT_FIELD_NOT_FOUND',
          message: '未找到标题输入框',
        };
      }
      if (titleEl instanceof HTMLInputElement || titleEl instanceof HTMLTextAreaElement) {
        setNativeValue(titleEl, content.title);
      } else {
        titleEl.textContent = content.title;
        titleEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      await sleep(300);
    }

    const body = content.body ?? content.description;
    if (body) {
      const editor = await findBodyEditor();
      if (!editor) {
        return {
          success: false,
          errorCode: 'INPUT_FIELD_NOT_FOUND',
          message: '未找到正文 Quill 编辑器',
        };
      }
      await fillQuillEditor(editor, body);
      const written = getEditableText(editor);
      if (!written.includes(body.trim().slice(0, Math.min(8, body.trim().length)))) {
        return {
          success: false,
          errorCode: 'FORM_NOT_READY',
          message: '正文未成功写入编辑器',
        };
      }
    }

    if (content.description && content.description !== content.body) {
      const summaryEl =
        queryFirst<HTMLTextAreaElement>(sohuSelectors.summaryInput, { visible: false }) ??
        (await waitForElement<HTMLTextAreaElement>(sohuSelectors.summaryInput, {
          timeout: 5000,
          visible: false,
        }));
      if (summaryEl) {
        setNativeValue(summaryEl, content.description);
      }
    }

    if (content.hashtags?.length) {
      await fillTags(content.hashtags);
    }

    return { success: true, message: '搜狐号文章内容已填写' };
  },

  async submitPublish(): Promise<PublishResult> {
    dismissPopups();

    let publishBtn = findSohuPublishButton();
    if (!publishBtn) {
      return {
        success: false,
        errorCode: 'BUTTON_NOT_FOUND',
        message: '未找到「发布」按钮',
        resultUrl: location.href,
      };
    }

    const btnText = (publishBtn.textContent ?? '').trim();
    if (/草稿|预览|保存/.test(btnText) && !/发布/.test(btnText)) {
      publishBtn = findSohuPublishButton();
      if (!publishBtn) {
        return {
          success: false,
          errorCode: 'BUTTON_NOT_FOUND',
          message: '未找到「发布」按钮',
          resultUrl: location.href,
        };
      }
    }

    if (isSohuPublishDisabled(publishBtn)) {
      return {
        success: false,
        errorCode: 'BUTTON_DISABLED',
        message: '发布按钮不可用，请检查封面/栏目/标题是否填写完整',
        resultUrl: location.href,
      };
    }

    publishBtn.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(200);
    simulateClick(publishBtn);
    await sleep(1000);

    const confirm =
      queryFirst<HTMLElement>(sohuSelectors.publishConfirmButton, { visible: true }) ??
      findByText('button,li,span', '确定') ??
      findByText('button,li,span', '确认发布');
    if (confirm) {
      simulateClick(confirm);
      await sleep(800);
    }

    const verified = await verifySohuPublishSuccess(45000);
    return {
      success: verified.success,
      errorCode: verified.errorCode as PublishResult['errorCode'],
      message: verified.message ?? (verified.success ? '发布已提交' : '发布结果未确认'),
      resultUrl: location.href,
    };
  },

  async readPageContent(): Promise<PageContent> {
    return {
      title: document.title,
      text: pageTextFromSelectors(),
      url: location.href,
    };
  },

  async executeComment(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '搜狐号 MVP 仅支持图文发布' };
  },
  async executeLike(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '搜狐号 MVP 仅支持图文发布' };
  },
  async executeFavorite(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '搜狐号 MVP 仅支持图文发布' };
  },
  async executeFollow(): Promise<ActionResult> {
    return { success: false, errorCode: 'UNSUPPORTED_PLATFORM', message: '搜狐号 MVP 仅支持图文发布' };
  },

  async captureResult(): Promise<ResultEvidence> {
    return { resultUrl: location.href, capturedAt: Date.now() };
  },

  async getDiagnostics() {
    return collectDiagnostics('sohu_publish');
  },
};

function pageTextFromSelectors(): string {
  const titleEl = queryFirst<HTMLInputElement>(sohuSelectors.titleInput);
  const title = titleEl?.value ?? '';
  const body = queryFirst<HTMLElement>(sohuSelectors.bodyEditor)?.textContent ?? '';
  return [title, body].filter(Boolean).join('\n');
}

export { SOHU_URLS, verifySohuPublishSuccess };
