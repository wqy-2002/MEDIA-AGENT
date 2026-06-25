import type { ActionResult, PublishResult } from '@/types';
import { verifyTextAppears } from '@/core/automation/verifier';
import { sleep } from '@/utils/dom';
import { sohuSelectors } from './selectors';
import { hasSohuVerificationWall, isSohuLoginWallUrl } from './readiness';

const SUCCESS_TEXTS = ['发布成功', '提交成功', '审核中', '已发布', '发表成功'];
const FAILURE_TEXTS = ['发布失败', '请上传封面', '请选择栏目', '标题不符合', '不符合规范'];

function pageText(): string {
  return (document.body?.innerText ?? '').replace(/\s+/g, ' ');
}

function isLoginWallUrl(): boolean {
  return isSohuLoginWallUrl();
}

function isPublishEditorPage(): boolean {
  const url = location.href.toLowerCase();
  if (url.includes('addarticle') || url.includes('article/new') || url.includes('article/edit')) {
    return true;
  }
  return Boolean(
    document.querySelector(sohuSelectors.titleInput.join(',')) ||
      document.querySelector(sohuSelectors.bodyEditor.join(',')),
  );
}

function hasVerificationWall(): boolean {
  return hasSohuVerificationWall();
}

/** 校验搜狐号发布是否成功 */
export async function verifySohuPublishSuccess(timeout = 15000): Promise<ActionResult> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = pageText();
    if (FAILURE_TEXTS.some((t) => text.includes(t))) {
      return {
        success: false,
        errorCode: 'SUBMIT_FAILED',
        message: `检测到发布失败提示：${FAILURE_TEXTS.find((t) => text.includes(t))}`,
      };
    }
    if (SUCCESS_TEXTS.some((t) => text.includes(t))) {
      return { success: true, message: '发布成功信号已出现' };
    }
    if (/contentManagement|content\/list|news\/list/i.test(location.href)) {
      return { success: true, message: '已跳转至内容管理页' };
    }
    await sleep(500);
  }

  const appeared = await verifyTextAppears(SUCCESS_TEXTS, { timeout: 2000 }).catch(() => ({
    success: false,
  }));
  if (appeared.success) {
    return { success: true, message: '发布成功文案已出现' };
  }

  if (!isPublishEditorPage() && !isLoginWallUrl()) {
    return { success: true, message: '已离开编辑页，按已提交处理' };
  }

  return {
    success: false,
    errorCode: 'SUBMIT_FAILED',
    message: '未检测到发布成功提示，请人工确认搜狐后台内容管理',
  };
}

export function buildSohuPublishDiagnostics(): Record<string, unknown> {
  return {
    url: location.href,
    isLoginWall: isLoginWallUrl(),
    isEditorPage: isPublishEditorPage(),
    hasVerification: hasVerificationWall(),
    pageSnippet: pageText().slice(0, 300),
  };
}

export async function waitForSohuPublishOutcome(timeout = 45000): Promise<PublishResult> {
  const verified = await verifySohuPublishSuccess(timeout);
  return {
    success: verified.success,
    errorCode: verified.errorCode as PublishResult['errorCode'],
    message: verified.message,
    resultUrl: location.href,
  };
}
