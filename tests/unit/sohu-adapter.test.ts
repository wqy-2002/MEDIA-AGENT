import { describe, it, expect, beforeEach } from 'vitest';
import { sohuAdapter } from '@/adapters/sohu';
import { platformFromUrl } from '@/adapters/registry';
import { SOHU_URLS } from '@/adapters/sohu/selectors';

function setPageUrl(url: string): void {
  const testWindow = window as Window & { happyDOM?: { setURL: (value: string) => void } };
  testWindow.happyDOM?.setURL(url);
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPageUrl('https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1');
});

describe('platformFromUrl sohu', () => {
  it('应识别搜狐号域名', () => {
    expect(platformFromUrl('https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle')).toBe('sohu');
    expect(platformFromUrl('https://mp.sohu.com/mpfe/v4/contentManagement/first/page')).toBe('sohu');
    expect(platformFromUrl('https://passport.sohu.com/login')).toBe('sohu');
  });
});

describe('sohuAdapter.detectState', () => {
  it('编辑器存在时应返回 editorReady', async () => {
    document.body.innerHTML = `
      <input name="title" />
      <div id="editor"><div class="ql-editor" contenteditable="true"></div></div>
    `;
    const res = await sohuAdapter.detectState!();
    expect(res.success).toBe(true);
    expect((res.data as { editorReady?: boolean }).editorReady).toBe(true);
  });
});

describe('sohuAdapter.detectLoginStatus', () => {
  it('登录页 URL 应判定未登录', async () => {
    setPageUrl('https://passport.sohu.com/login');
    const status = await sohuAdapter.detectLoginStatus();
    expect(status.loggedIn).toBe(false);
  });

  it('编辑器存在时应判定已登录', async () => {
    document.body.innerHTML = `
      <input name="title" placeholder="标题" />
      <div id="editor"><div class="ql-editor" contenteditable="true"></div></div>
    `;
    const status = await sohuAdapter.detectLoginStatus();
    expect(status.loggedIn).toBe(true);
  });

  it('dashboard 无 editor 时应快速判定已登录', async () => {
    setPageUrl('https://mp.sohu.com/mpfe/v4/contentManagement/first/page');
    document.body.innerHTML = '<div class="nav">内容管理</div>';
    const t0 = Date.now();
    const status = await sohuAdapter.detectLoginStatus();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(status.loggedIn).toBe(true);
    expect(status.needVerification).toBe(false);
    expect(status.message).toContain('后台');
  });

  it('隐藏 geetest 容器不应误报 verification', async () => {
    setPageUrl(SOHU_URLS.dashboardUrl);
    document.body.innerHTML = '<div class="geetest_panel" style="display:none">验证码</div>';
    const status = await sohuAdapter.detectLoginStatus();
    expect(status.needVerification).toBeFalsy();
    expect(status.loggedIn).toBe(true);
  });
});

describe('sohuAdapter.ensurePublishPage', () => {
  it('非发文页应失败', async () => {
    setPageUrl('https://mp.sohu.com/mpfe/v4/contentManagement/first/page');
    const res = await sohuAdapter.ensurePublishPage();
    expect(res.success).toBe(false);
  });

  it('发文页有编辑器应成功', async () => {
    document.body.innerHTML = `
      <input class="publish-title-input" name="title" />
      <div id="editor"><div class="ql-editor" contenteditable="true"></div></div>
    `;
    const res = await sohuAdapter.ensurePublishPage();
    expect(res.success).toBe(true);
  });
});

describe('sohuAdapter.fillContent', () => {
  it('应填写标题与 Quill 正文', async () => {
    document.body.innerHTML = `
      <input name="title" />
      <div id="editor"><div class="ql-editor" contenteditable="true"></div></div>
      <textarea name="summary"></textarea>
    `;
    const res = await sohuAdapter.fillContent({
      title: '测试搜狐标题',
      body: '这是搜狐正文内容',
      description: '这是摘要',
    });
    expect(res.success).toBe(true);
    expect((document.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('测试搜狐标题');
    expect(document.querySelector('.ql-editor')?.textContent).toContain('搜狐正文');
  });
});

describe('sohuAdapter.submitPublish', () => {
  it('应点击 v4 li 发布按钮', async () => {
    let clicked = false;
    document.body.innerHTML = `
      <ul class="button-list">
        <li class="pre">预览</li>
        <li class="publish-report-btn active positive-button" report-attr='{"code":"content-button-commit"}'>发布</li>
        <li class="publish-report-btn normal timeout-pub negative-button">定时发布</li>
      </ul>
    `;
    const btn = document.querySelector('li.publish-report-btn.positive-button')!;
    btn.addEventListener('click', () => {
      clicked = true;
      document.body.innerHTML += '<div>发布成功</div>';
    });
    const res = await sohuAdapter.submitPublish();
    expect(clicked).toBe(true);
    expect(res.success).toBe(true);
  });

  it('应点击 legacy button 发布按钮', async () => {
    let clicked = false;
    document.body.innerHTML = `<button class="publish-btn">发布</button>`;
    const btn = document.querySelector('button.publish-btn')!;
    btn.addEventListener('click', () => {
      clicked = true;
      document.body.innerHTML += '<div>发布成功</div>';
    });
    const res = await sohuAdapter.submitPublish();
    expect(clicked).toBe(true);
    expect(res.success).toBe(true);
  });

  it('无发布按钮应失败', async () => {
    const res = await sohuAdapter.submitPublish();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('BUTTON_NOT_FOUND');
  });
});

describe('sohuAdapter.uploadMedia', () => {
  it('无素材时应跳过', async () => {
    const res = await sohuAdapter.uploadMedia([]);
    expect(res.success).toBe(true);
    expect(res.uploadedCount).toBe(0);
  });
});
