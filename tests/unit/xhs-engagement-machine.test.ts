import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectXhsDetailState,
  runXhsCommentFlow,
  runXhsFavoriteFlow,
  runXhsFollowFlow,
  runXhsLikeFlow,
} from '@/adapters/xiaohongshu/engagement-machine';
import { collectDiagnostics } from '@/core/automation/diagnostics';

// 小红书互动状态机测试：点击后必须验证状态变化。

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
      x: 300,
      y: 100,
      top: 100,
      left: 300,
      right: 380,
      bottom: 130,
      width: 80,
      height: 30,
      toJSON: () => ({}),
    }),
  });
});

describe('xhs engagement machine', () => {
  it('点赞后应验证状态变化', async () => {
    document.body.innerHTML = '<button class="like-wrapper">点赞</button>';
    document.querySelector('button')?.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).className = 'like-wrapper active';
      (event.currentTarget as HTMLElement).textContent = '已点赞';
    });
    const result = await runXhsLikeFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('已点赞');
  });

  it('收藏后应验证状态变化', async () => {
    document.body.innerHTML = '<button class="collect-wrapper">收藏</button>';
    document.querySelector('button')?.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).className = 'collect-wrapper active';
      (event.currentTarget as HTMLElement).textContent = '已收藏';
    });
    const result = await runXhsFavoriteFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('已收藏');
  });

  it('关注后应验证按钮文本变化', async () => {
    document.body.innerHTML = '<button class="follow-button">关注</button>';
    document.querySelector('button')?.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).textContent = '已关注';
    });
    const result = await runXhsFollowFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('已关注');
  });

  it('评论后应验证评论内容出现', async () => {
    document.body.innerHTML = `
      <div class="comment-input" contenteditable="true"></div>
      <button>发送</button>
    `;
    document.querySelector('button')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>这是一条评论</div>');
    });
    const result = await runXhsCommentFlow('这是一条评论');
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('这是一条评论');
  });

  it('点赞只更新子节点状态时也应判定成功', async () => {
    document.body.innerHTML = `
      <div class="interaction-container">
        <button class="like-wrapper" aria-label="点赞">
          <svg><path fill="#999"></path></svg>
        </button>
      </div>
    `;
    document.querySelector('button')?.addEventListener('click', () => {
      document.querySelector('path')?.setAttribute('fill', 'red');
    });

    const result = await runXhsLikeFlow();

    expect(result.success).toBe(true);
    expect(document.querySelector('path')?.getAttribute('fill')).toBe('red');
  });

  it('普通 reds 类名不能被误判为已点赞', async () => {
    let clicked = false;
    document.body.innerHTML = '<button class="like-wrapper reds-button-new">点赞</button>';
    document.querySelector('button')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await runXhsLikeFlow();

    expect(clicked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RESULT_VERIFY_FAILED');
  }, 10000);

  it('未激活的白色图标不能被误判为已点赞', async () => {
    let clicked = false;
    document.body.innerHTML = `
      <button class="like-wrapper" aria-label="点赞">
        <svg>
          <path fill="#fff"></path>
          <path fill="currentColor" stroke="#fff"></path>
        </svg>
      </button>
    `;
    document.querySelector('button')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await runXhsLikeFlow();

    expect(clicked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RESULT_VERIFY_FAILED');
  }, 10000);

  it('like-active-icon 类名本身不能被误判为已点赞', async () => {
    let clicked = false;
    document.body.innerHTML = `
      <button class="like-wrapper" aria-label="点赞">
        <span class="like-active-icon"></span>
      </button>
    `;
    document.querySelector('button')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await runXhsLikeFlow();

    expect(clicked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RESULT_VERIFY_FAILED');
  }, 10000);

  it('真实 like-active 按钮应识别为已点赞而不重复点击', async () => {
    let clicked = false;
    document.body.innerHTML = `
      <span class="like-wrapper like-active">
        <svg class="reds-icon like-icon"><use xlink:href="#like"></use></svg>
        <span class="count">2</span>
      </span>
    `;
    document.querySelector('.like-wrapper')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await runXhsLikeFlow();

    expect(result.success).toBe(true);
    expect(result.message).toBe('已处于点赞状态');
    expect(clicked).toBe(false);
  });

  it('收藏图标使用 #collected 但未激活时不能直接完成', async () => {
    let clicked = false;
    document.body.innerHTML = `
      <span id="note-page-collect-board-guide" class="collect-wrapper">
        <svg class="reds-icon collect-icon" width="24" height="24">
          <use xlink:href="#collected"></use>
        </svg>
        <span class="count">1</span>
      </span>
    `;
    document.querySelector('.collect-wrapper')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await runXhsFavoriteFlow();

    expect(clicked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RESULT_VERIFY_FAILED');
  }, 10000);

  it('收藏只更新父容器状态时也应判定成功', async () => {
    document.body.innerHTML = `
      <div class="interaction-container">
        <div class="collect-area">
          <button class="collect-wrapper">收藏</button>
        </div>
      </div>
    `;
    document.querySelector('button')?.addEventListener('click', () => {
      document.querySelector('.collect-area')?.classList.add('active');
    });

    const result = await runXhsFavoriteFlow();

    expect(result.success).toBe(true);
    expect(document.querySelector('.collect-area')?.className).toContain('active');
  });

  it('评论时不应点击发布入口，应点击评论提交按钮', async () => {
    let publishClicked = false;
    document.body.innerHTML = `
      <div class="interaction-container">
        <p class="content-input" contenteditable="true"></p>
        <a href="https://creator.xiaohongshu.com">发布</a>
        <button class="btn submit">发送</button>
      </div>
    `;
    document.querySelector('a')?.addEventListener('click', () => {
      publishClicked = true;
    });
    document.querySelector('button')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>不要跳转</div>');
    });

    const result = await runXhsCommentFlow('不要跳转');

    expect(result.success).toBe(true);
    expect(publishClicked).toBe(false);
    expect(document.body.innerText).toContain('不要跳转');
  });

  it('创作者中心页面不应执行评论、点赞或收藏', async () => {
    setPageUrl('https://creator.xiaohongshu.com/home');
    document.body.innerHTML = `
      <button class="like-wrapper">点赞</button>
      <button class="collect-wrapper">收藏</button>
      <p class="content-input" contenteditable="true"></p>
      <button class="btn submit">发送</button>
    `;

    await expect(runXhsLikeFlow()).resolves.toMatchObject({ success: false, errorCode: 'PLATFORM_PAGE_CHANGED' });
    await expect(runXhsFavoriteFlow()).resolves.toMatchObject({ success: false, errorCode: 'PLATFORM_PAGE_CHANGED' });
    await expect(runXhsCommentFlow('评论')).resolves.toMatchObject({ success: false, errorCode: 'PLATFORM_PAGE_CHANGED' });
    expect(detectXhsDetailState()).toBe('unknown');
  });

  it('无关 disabled 按钮不应被诊断为阻塞', () => {
    document.body.innerHTML = `
      <div class="interaction-container">
        <button class="like-wrapper">点赞</button>
        <button disabled>发送</button>
      </div>
    `;

    const diagnostics = collectDiagnostics('like_ready');

    expect(diagnostics.blockers).not.toContain('存在 1 个 disabled 按钮');
    expect(diagnostics.blockers).toHaveLength(0);
  });
});

