import { describe, it, expect, beforeEach } from 'vitest';
import { xiaohongshuAdapter } from '@/adapters/xiaohongshu';
import { douyinAdapter } from '@/adapters/douyin';
import { platformFromUrl } from '@/adapters/registry';
import {
  setNativeValue,
  dataUrlToFile,
  findByText,
  simulateClick,
  queryFirst,
} from '@/utils/dom';

// 适配器与 DOM 工具测试（happy-dom 环境）。
// 注：waitForElement 依赖布局可见性，happy-dom 不做布局，这里只测同步查询类逻辑。

function setPageUrl(url: string): void {
  const testWindow = window as Window & { happyDOM?: { setURL: (value: string) => void } };
  testWindow.happyDOM?.setURL(url);
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPageUrl('https://www.xiaohongshu.com/explore/test-note');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 260,
      y: 0,
      top: 0,
      left: 260,
      right: 360,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    }),
  });
});

describe('platformFromUrl', () => {
  it('应根据 URL 识别平台', () => {
    expect(platformFromUrl('https://www.xiaohongshu.com/explore')).toBe('xiaohongshu');
    expect(platformFromUrl('https://creator.douyin.com/x')).toBe('douyin');
    expect(platformFromUrl('https://channels.weixin.qq.com/x')).toBe('wechat_channel');
    expect(platformFromUrl('https://mp.weixin.qq.com/x')).toBe('wechat_official');
    expect(platformFromUrl('https://example.com')).toBeUndefined();
  });
});

describe('xiaohongshuAdapter.detectLoginStatus', () => {
  it('存在用户头像时判定为已登录', async () => {
    document.body.innerHTML = '<div class="avatar"></div>';
    const status = await xiaohongshuAdapter.detectLoginStatus();
    expect(status.loggedIn).toBe(true);
  });

  it('无登录墙时默认按已登录继续（避免误判阻塞）', async () => {
    const status = await xiaohongshuAdapter.detectLoginStatus();
    expect(status.loggedIn).toBe(true);
  });

  it('出现扫码登录弹层时判定为未登录', async () => {
    document.body.innerHTML = '<div class="login-container"><div class="qrcode-img"></div></div>';
    const status = await xiaohongshuAdapter.detectLoginStatus();
    expect(status.loggedIn).toBe(false);
  });
});

describe('xiaohongshuAdapter 互动动作', () => {
  it('入口态只有“文字配图”时，fillContent 应先进入编辑态再填写', async () => {
    document.body.innerHTML =
      '<button class="d-button d-button-default">上传图片</button><button class="d-button d-button-default">文字配图</button>';
    const textImageButton = document.querySelectorAll('button')[1];
    textImageButton.addEventListener('click', () => {
      document.body.innerHTML = `
        <div>写文字 再写一张</div>
        <div class="tiptap ProseMirror" role="textbox" contenteditable="true"></div>
        <button id="generate">生成图片</button>
      `;
      document.getElementById('generate')?.addEventListener('click', () => {
        document.body.innerHTML = `
          <div>选择一个喜欢的卡片</div>
          <button id="next">下一步</button>
        `;
        document.getElementById('next')?.addEventListener('click', () => {
          document.body.innerHTML = `
            <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
            <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true"></div>
            <xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
          `;
        });
      });
    });

    const res = await xiaohongshuAdapter.fillContent(
      {
        title: '好物分享标题',
        body: '这是一篇好物分享正文',
      },
      { publishMode: 'text_image' },
    );

    expect(res.success).toBe(true);
    expect((document.querySelector('input[placeholder*="标题"]') as HTMLInputElement).value).toBe(
      '好物分享标题',
    );
    expect(document.querySelector('.ql-editor')?.textContent).toContain('这是一篇好物分享正文');
  }, 60000);

  it('executeLike 应点击点赞按钮', async () => {
    let clicked = false;
    document.body.innerHTML = '<button class="like-wrapper">点赞</button>';
    queryFirst(['.like-wrapper'])?.addEventListener('click', () => {
      clicked = true;
      const btn = document.querySelector('.like-wrapper') as HTMLElement;
      btn.className = 'like-wrapper active';
      btn.textContent = '已点赞';
    });
    const res = await xiaohongshuAdapter.executeLike();
    expect(res.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('找不到关注按钮时返回 BUTTON_NOT_FOUND', async () => {
    const res = await xiaohongshuAdapter.executeFollow();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('BUTTON_NOT_FOUND');
  });
});

describe('douyinAdapter', () => {
  it('收藏在 MVP 不支持', async () => {
    const res = await douyinAdapter.executeFavorite();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('UNSUPPORTED_PLATFORM');
  });
});

describe('DOM 工具', () => {
  it('setNativeValue 应设置值并触发 input 事件', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    let fired = false;
    input.addEventListener('input', () => {
      fired = true;
    });
    setNativeValue(input, '你好');
    expect(input.value).toBe('你好');
    expect(fired).toBe(true);
  });

  it('dataUrlToFile 应生成正确类型的 File', () => {
    // "hi" 的 base64 是 aGk=
    const file = dataUrlToFile('data:text/plain;base64,aGk=', 'a.txt');
    expect(file.name).toBe('a.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe(2);
  });

  it('findByText 应按文本匹配按钮', () => {
    document.body.innerHTML = '<button>取消</button><button>发布笔记</button>';
    const btn = findByText('button', '发布');
    expect(btn?.textContent).toBe('发布笔记');
  });

  it('simulateClick 应触发 click 事件', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let count = 0;
    btn.addEventListener('click', () => {
      count++;
    });
    simulateClick(btn);
    expect(count).toBe(1);
  });
});
