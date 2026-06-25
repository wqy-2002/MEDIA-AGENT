import { describe, it, expect, beforeEach } from 'vitest';
import {
  isSohuBackendUrl,
  isSohuLoginWallUrl,
  isSohuEditorDomReady,
  probeSohuFrameState,
  probeSohuLoginState,
  hasSohuVerificationWall,
  findSohuVerificationWall,
} from '@/adapters/sohu/readiness';
import { platformFromUrl } from '@/adapters/registry';
import { SOHU_URLS } from '@/adapters/sohu/selectors';

function setPageUrl(url: string): void {
  const testWindow = window as Window & { happyDOM?: { setURL: (value: string) => void } };
  testWindow.happyDOM?.setURL(url);
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPageUrl(SOHU_URLS.publishUrl);
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function getBoundingClientRect(this: HTMLElement) {
      const hidden = this.style.display === 'none' || this.style.visibility === 'hidden';
      if (hidden) {
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
      }
      return {
        x: 10,
        y: 10,
        top: 10,
        left: 10,
        right: 210,
        bottom: 110,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      };
    },
  });
});

describe('isSohuBackendUrl', () => {
  it('应识别 mpfe 列表页与 passport', () => {
    expect(isSohuBackendUrl(SOHU_URLS.dashboardUrl)).toBe(true);
    expect(isSohuBackendUrl('https://passport.sohu.com/login')).toBe(true);
    expect(isSohuBackendUrl(SOHU_URLS.publishUrl)).toBe(true);
    expect(isSohuBackendUrl('https://www.baidu.com')).toBe(false);
  });
});

describe('platformFromUrl 扩展', () => {
  it('应识别 mpfe 列表页', () => {
    expect(platformFromUrl(SOHU_URLS.dashboardUrl)).toBe('sohu');
  });

  it('应识别 passport 登录页', () => {
    expect(platformFromUrl('https://passport.sohu.com/login')).toBe('sohu');
  });
});

describe('probeSohuFrameState', () => {
  it('passport URL 应判定登录墙', () => {
    setPageUrl('https://passport.sohu.com/login');
    const state = probeSohuFrameState();
    expect(state.loginWall).toBe(true);
    expect(state.editorReady).toBe(false);
  });

  it('编辑器 DOM 存在时应 editorReady', () => {
    document.body.innerHTML = `
      <input name="title" />
      <div id="editor"><div class="ql-editor" contenteditable="true"></div></div>
    `;
    const state = probeSohuFrameState();
    expect(state.loginWall).toBe(false);
    expect(state.editorReady).toBe(true);
  });

  it('列表页无编辑器时 editorReady 为 false', () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    const state = probeSohuFrameState();
    expect(isSohuLoginWallUrl()).toBe(false);
    expect(isSohuEditorDomReady()).toBe(false);
    expect(state.editorReady).toBe(false);
  });
});

describe('probeSohuLoginState', () => {
  it('dashboard 无 editor 时应判定已登录', () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    document.body.innerHTML = '<div class="content-list">内容管理</div>';
    const probe = probeSohuLoginState();
    expect(probe.loggedIn).toBe(true);
    expect(probe.editorReady).toBe(false);
    expect(probe.loginWall).toBe(false);
  });

  it('content-verify-badge 不应误报 verification', () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    document.body.innerHTML = '<span class="content-verify-badge">已审核</span>';
    expect(hasSohuVerificationWall()).toBe(false);
    const probe = probeSohuLoginState();
    expect(probe.loggedIn).toBe(true);
    expect(probe.needVerification).toBe(false);
  });

  it('隐藏 captcha SDK 节点不应误报 verification', () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    document.body.innerHTML =
      '<div id="foo-captcha" style="display:none">验证码</div><div class="nc-container" style="display:none"></div>';
    expect(hasSohuVerificationWall()).toBe(false);
    expect(probeSohuLoginState().needVerification).toBe(false);
  });

  it('可见滑块且含验证文案应报 verification', () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    document.body.innerHTML = '<div class="slider-captcha">请完成验证</div>';
    const found = findSohuVerificationWall();
    expect(found.blocked).toBe(true);
    expect(found.matchedSelector).toBe('.slider-captcha');
    const probe = probeSohuLoginState();
    expect(probe.needVerification).toBe(true);
    expect(probe.verificationMatch).toBe('.slider-captcha');
  });
});
