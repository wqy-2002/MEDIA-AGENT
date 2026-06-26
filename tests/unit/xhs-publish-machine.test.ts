import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectXhsPublishState,
  findXhsPublishButton,
  getXhsPublishFlowDiagnostics,
  isPublishSuccessSignal,
  runXhsFillContentFlow,
  runXhsSubmitPublishFlow,
} from '@/adapters/xiaohongshu/publish-machine';
import { DEFAULT_PUBLISH_PACING, setPublishPacingOverride } from '@/core/automation/human-pacing';

// 小红书发布状态机测试：覆盖 publish-page SPA 阶段切换与 closed shadow Host。

vi.mock('@/core/automation/human-pacing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/automation/human-pacing')>();
  return {
    ...actual,
    humanActionDelay: vi.fn(async () => {}),
    humanImageUploadGap: vi.fn(async () => {}),
    humanPreSubmitDwell: vi.fn(async () => 0),
    humanStateTransitionDelayMs: vi.fn(() => 0),
    humanFieldGap: vi.fn(async () => 0),
    getCharDelayMs: vi.fn(() => 0),
    typeHuman: vi.fn(async (el: HTMLElement, text: string) => {
      const { fillElement } = await import('@/core/automation/dom-driver');
      await fillElement(el, text);
    }),
    typeCharByCharHuman: vi.fn(async () => {}),
    loadPublishPacingFromSettings: vi.fn(async () => ({
      ...DEFAULT_PUBLISH_PACING,
      enabled: false,
    })),
  };
});

function makeVisibleRects(x = 260, y = 120) {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x,
      y,
      top: y,
      left: x,
      right: x + 160,
      bottom: y + 40,
      width: 160,
      height: 40,
      toJSON: () => ({}),
    }),
  });
}

function mountFinalForm(publishInIframe = false) {
  document.body.innerHTML = `
    <nav><span>发布笔记</span></nav>
    <div class="publish-page">
      <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
      <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true"></div>
      <div class="publish-page-publish-btn">
        ${publishInIframe ? '' : '<xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>'}
      </div>
      ${publishInIframe ? '<iframe id="publish-frame"></iframe>' : ''}
    </div>
  `;
  if (publishInIframe) {
    const iframe = document.getElementById('publish-frame') as HTMLIFrameElement;
    iframe.contentDocument!.body.innerHTML = `
      <div class="publish-page">
        <div class="publish-page-publish-btn">
          <xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
        </div>
      </div>
    `;
    iframe.contentDocument!.querySelector('xhs-publish-btn')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });
  } else {
    document.querySelector('xhs-publish-btn')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });
  }
}

beforeEach(() => {
  setPublishPacingOverride({ ...DEFAULT_PUBLISH_PACING, enabled: false });
  makeVisibleRects();
  document.body.innerHTML = `
    <nav><span>发布笔记</span></nav>
    <div class="publish-page">
      <div class="creator-tab">上传视频</div>
      <div class="creator-tab" id="image-tab">上传图文</div>
      <div>拖拽视频到此或点击上传</div>
    </div>
  `;
  document.getElementById('image-tab')?.addEventListener('click', () => {
    document.body.innerHTML = `
      <nav><span>发布笔记</span></nav>
      <div class="publish-page">
        <button id="upload-image">上传图片</button>
        <button id="text-image">文字配图</button>
      </div>
    `;
    document.getElementById('text-image')?.addEventListener('click', () => {
      document.body.innerHTML = `
        <nav><span>发布笔记</span></nav>
        <div class="publish-page">
          <div>写文字 再写一张</div>
          <div class="tiptap ProseMirror" role="textbox" contenteditable="true"></div>
          <button id="generate">生成图片</button>
        </div>
      `;
      document.getElementById('generate')?.addEventListener('click', () => {
        document.body.innerHTML = `
          <nav><span>发布笔记</span></nav>
          <div class="publish-page">
            <div>选择一个喜欢的卡片</div>
            <button id="next">下一步</button>
          </div>
        `;
        document.getElementById('next')?.addEventListener('click', () => {
          mountFinalForm(false);
        });
      });
    });
  });
});

describe('xhs publish machine', () => {
  it('应从视频默认页签走到最终发布按钮就绪', async () => {
    expect(detectXhsPublishState()).toBe('video_tab');
    const result = await runXhsFillContentFlow(
      {
        title: '好物分享标题',
        body: '这是一篇好物分享正文',
      },
      { publishMode: 'text_image' },
    );
    expect(result.success).toBe(true);
    expect(detectXhsPublishState()).toBe('publish_button_ready');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('好物分享标题');
    expect(document.querySelector('.ql-editor')?.textContent).toContain('这是一篇好物分享正文');
  }, 30000);

  it('发布按钮就绪后应点击发布并验证成功提示', async () => {
    await runXhsFillContentFlow(
      { title: '标题', body: '正文' },
      { publishMode: 'text_image' },
    );
    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('发布成功');
  }, 30000);

  it('左侧发布笔记 + 草稿编辑器不应误判为 publish_button_ready', () => {
    makeVisibleRects(40, 40);
    document.body.innerHTML = `
      <nav><div role="button">发布笔记</div></nav>
      <div class="publish-page">
        <div>写文字 生成图片</div>
        <div class="tiptap ProseMirror" role="textbox" contenteditable="true"></div>
        <button>生成图片</button>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('text_image_editor');
  });

  it('publish-page 外的 Host 不应导致 publish_button_ready', () => {
    makeVisibleRects(40, 40);
    document.body.innerHTML = `
      <nav><xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn></nav>
      <div class="publish-page">
        <div>写文字 生成图片</div>
        <div class="tiptap ProseMirror" role="textbox" contenteditable="true"></div>
        <button>生成图片</button>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('text_image_editor');
    expect(findXhsPublishButton()).toBeNull();
  });

  it('publish-page 内双 Host 应优先点击 is-publish=true 的发布按钮', async () => {
    let clicked = '';
    document.body.innerHTML = `
      <nav><span>发布笔记</span></nav>
      <div class="publish-page">
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
        <div class="publish-page-publish-btn">
          <xhs-publish-btn id="save" is-publish="false" submit-disabled="false">暂存</xhs-publish-btn>
          <xhs-publish-btn id="pub" is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
        </div>
      </div>
    `;
    document.getElementById('save')?.addEventListener('click', () => {
      clicked = 'save';
    });
    document.getElementById('pub')?.addEventListener('click', () => {
      clicked = 'publish';
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });
    expect(detectXhsPublishState()).toBe('publish_button_ready');
    expect(findXhsPublishButton()?.id).toBe('pub');
    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(clicked).toBe('publish');
  }, 15000);

  it('应扫描可访问 iframe 并点击其中的发布按钮', async () => {
    mountFinalForm(true);
    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('发布成功');
  }, 20000);

  it('应收起话题候选层后识别新版发布按钮并提交', async () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
        <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true"></div>
        <button class="contentBtn topic-btn">话题</button>
        <div class="items" id="topic-panel">#必买清单 #好物分享</div>
        <div class="publish-page-publish-btn">
          <xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
        </div>
      </div>
    `;
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        document.getElementById('topic-panel')?.remove();
      },
      { once: true },
    );
    document.querySelector('xhs-publish-btn')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });

    const filled = await runXhsFillContentFlow({
      title: '我的年度爱用物',
      body: '今天来分享几件我真的回购了无数次的好物',
    });
    expect(filled.success).toBe(true);
    expect(detectXhsPublishState()).toBe('publish_button_ready');

    const submitted = await runXhsSubmitPublishFlow();
    expect(submitted.success).toBe(true);
    expect(document.body.innerText).toContain('发布成功');
  }, 30000);

  it('图片编辑 overlay 智能标题小框不应误判为最终标题', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="microapp-container">
          <div>返回 图片编辑2/18 获取封面建议 1 编辑 2 编辑 智能标题</div>
          <input class="d-text --color-text-title" style="width:4px;height:22px" />
          <input class="d-text --color-text-title" style="width:4px;height:22px" />
        </div>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('image_editing');
    expect(findXhsPublishButton()).toBeNull();
  });

  it('图片编辑中间页不应误判为最终发布表单', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="microapp-container">
          <div>返回 图片编辑1/18 获取封面建议 1 编辑 智能标题</div>
          <input class="d-text --color-text-title" />
          <input class="d-text --color-text-title" />
        </div>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('image_editing');
  });

  it('图片编辑同屏出现标题和正文且有表单 chrome 时应按最终表单处理', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="microapp-container">
          <div>返回 图片编辑1/18 获取封面建议 1 编辑 智能标题</div>
          <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
          <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true">正文</div>
          <button class="contentBtn topic-btn">话题</button>
          <button class="contentBtn">用户</button>
          <button class="contentBtn">表情</button>
        </div>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('final_form');
  });

  it('layout 存在但视口外的标题和正文仍应识别为最终表单', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        const isEditor = this.matches?.('.tiptap, .ProseMirror, .ql-editor');
        const isTitle = this instanceof HTMLInputElement;
        const y = isEditor || isTitle ? 1200 : 120;
        return {
          x: 260,
          y,
          top: y,
          left: 260,
          right: 420,
          bottom: y + 40,
          width: 160,
          height: 40,
          toJSON: () => ({}),
        };
      },
    });
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="publish-page-content">
          <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
          <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true">正文</div>
          <div class="publish-page-publish-btn">
            <xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
          </div>
        </div>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('publish_button_ready');
  });

  it('仅有表单 chrome 无发布按钮时不应进入 publish_button_ready 终态', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
        <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true">正文</div>
        <button class="contentBtn topic-btn">话题</button>
        <button class="contentBtn">用户</button>
        <button class="contentBtn">表情</button>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('final_form');
    expect(findXhsPublishButton()).toBeNull();
  });

  it('图片编辑同屏出现标题和正文但无 chrome 时仍应识别为 image_editing', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="microapp-container">
          <div>返回 图片编辑1/18 获取封面建议 1 编辑 智能标题</div>
          <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
          <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true">正文</div>
        </div>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('image_editing');
  });

  it('有图片预览时应识别为最终发布表单而非文字配图入口', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="img-preview-area"><div class="pr"></div></div>
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
      </div>
    `;

    expect(detectXhsPublishState()).toBe('final_form');
  });

  it('preferImageUpload 模式下应跳过文字配图直接进入最终表单', async () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="upload-content"></div>
        <div class="creator-tab">上传图文</div>
        <button id="upload-image">上传图片</button>
        <button id="text-image">文字配图</button>
        <div class="img-preview-area"><div class="pr"></div></div>
        <div class="d-input"><input class="d-text" placeholder="填写标题会有更多赞哦" /></div>
        <div class="tiptap ProseMirror ql-editor" role="textbox" contenteditable="true"></div>
        <div class="publish-page-publish-btn">
          <xhs-publish-btn is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
        </div>
      </div>
    `;
    document.querySelector('xhs-publish-btn')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });

    const filled = await runXhsFillContentFlow(
      {
        title: '图文测试标题',
        body: '图文测试正文',
      },
      { preferImageUpload: true, publishMode: 'image_upload' },
    );
    expect(filled.success, filled.message).toBe(true);
    expect(detectXhsPublishState()).toBe('publish_button_ready');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('图文测试标题');
    expect(document.querySelector('.ql-editor')?.textContent).toContain('图文测试正文');
  }, 30000);

  it('2026 改版 ce-btn 发布按钮（无 publish-page-publish-btn）应识别并提交', async () => {
    let clicked = '';
    document.body.innerHTML = `
      <nav><span>发布笔记</span></nav>
      <div class="publish-page">
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
        <button class="ce-btn bg-red" disabled>保存草稿</button>
        <button class="ce-btn bg-red" id="ce-publish">发布</button>
        <button class="ce-btn bg-red">删除</button>
      </div>
    `;
    document.getElementById('ce-publish')?.addEventListener('click', () => {
      clicked = 'ce-publish';
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });
    expect(detectXhsPublishState()).toBe('publish_button_ready');
    expect(findXhsPublishButton()?.id).toBe('ce-publish');
    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(clicked).toBe('ce-publish');
  }, 15000);

  it('空的 publish-page 壳层不应遮挡 microapp-container 的视频默认页签', () => {
    document.body.innerHTML = `
      <nav><span>发布笔记</span></nav>
      <div class="publish-page"></div>
      <div class="microapp-container">
        <button class="d-button d-button-default">上传视频</button>
        <div class="creator-tab">上传视频</div>
        <div class="creator-tab">上传图文</div>
        <div>拖拽视频到此或点击上传</div>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('video_tab');
  });

  it('隐藏的 microapp-container 不应遮挡可见容器的 image_entry 识别', () => {
    document.body.innerHTML = `
      <div class="publish-page"></div>
      <div class="microapp-container" style="display:none">占位</div>
      <div class="microapp-container">
        <div>上传视频 上传图文 写长文 发播客</div>
        <button class="d-button d-button-default">上传图片</button>
        <button class="d-button d-button-default">文字配图</button>
        <div>上传图片，或写文字生成图片</div>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('image_entry');
  });

  it('image_entry 页营销文案「写文字生成图片」不应误判为文字配图草稿', () => {
    document.body.innerHTML = `
      <div class="publish-page"></div>
      <div class="microapp-container">
        <button class="d-button d-button-default">上传图片</button>
        <button class="d-button d-button-default">文字配图</button>
        <div>上传图片，或写文字生成图片</div>
      </div>
    `;
    expect(detectXhsPublishState()).toBe('image_entry');
    expect(getXhsPublishFlowDiagnostics().publishModeSignals).toMatchObject({
      textImageDraft: false,
      hasGenerateButton: false,
    });
  });

  it('2026 ce-btn 同类红色按钮无「发布」文本时应被跳过', () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
        <button class="ce-btn bg-red">保存草稿</button>
      </div>
    `;
    expect(findXhsPublishButton()).toBeNull();
    expect(detectXhsPublishState()).toBe('final_form');
  });

  it('closed shadow Host 应通过 _onPublish 实例方法触发发布', async () => {
    if (!customElements.get('xhs-publish-btn')) {
      class XhsClosedShadowBtn extends HTMLElement {
        connectedCallback(): void {
          const shadow = this.attachShadow({ mode: 'closed' });
          const inner = document.createElement('button');
          inner.type = 'button';
          inner.textContent = '发布';
          inner.style.cssText = 'width:100%;height:100%;';
          shadow.appendChild(inner);
        }
      }
      customElements.define('xhs-publish-btn', XhsClosedShadowBtn);
    }

    document.body.innerHTML = `
      <div class="publish-page">
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
        <div class="publish-page-publish-btn">
          <xhs-publish-btn id="shadow-pub" is-publish="true" submit-disabled="false"></xhs-publish-btn>
        </div>
      </div>
    `;
    let invokedMethod = '';
    const pub = document.getElementById('shadow-pub') as HTMLElement & { _onPublish?: () => void };
    pub._onPublish = () => {
      invokedMethod = '_onPublish';
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    };

    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(invokedMethod).toBe('_onPublish');
    expect(document.body.innerText).toContain('发布成功');
  }, 15000);

  it('Host 无 _onPublish 时应 fallback 到 CustomEvent/click', async () => {
    document.body.innerHTML = `
      <div class="publish-page">
        <div class="d-input"><input placeholder="填写标题会有更多赞哦" /></div>
        <div class="ql-editor" contenteditable="true"></div>
        <div class="publish-page-publish-btn">
          <xhs-publish-btn id="fallback-pub" is-publish="true" submit-disabled="false">发布</xhs-publish-btn>
        </div>
      </div>
    `;
    document.getElementById('fallback-pub')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div>发布成功</div>');
    });

    const result = await runXhsSubmitPublishFlow();
    expect(result.success).toBe(true);
    expect(document.body.innerText).toContain('发布成功');
  }, 15000);

  it('about:blank 子 frame 应拒绝 submit_publish 并给出明确错误', async () => {
    const saved = window.location;
    // jsdom 下模拟 about:blank 子 frame
    vi.stubGlobal('location', { ...saved, href: 'about:blank', protocol: 'about:' });
    const result = await runXhsSubmitPublishFlow();
    vi.stubGlobal('location', saved);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PLATFORM_PAGE_CHANGED');
    expect(result.message).toContain('about:blank');
  });

  it('note-manager 搜索框「已发布」子串不应误判 success', () => {
    const saved = window.location;
    vi.stubGlobal('location', {
      ...saved,
      href: 'https://creator.xiaohongshu.com/new/note-manager?source=official',
    });
    document.body.innerHTML = `
      <input class="d-text" placeholder="搜索已发布的笔记" />
    `;
    expect(detectXhsPublishState()).toBe('unknown');
    expect(isPublishSuccessSignal()).toBe(false);
    vi.stubGlobal('location', saved);
  });

  it('发布成功强文案应判定 success', () => {
    document.body.innerHTML = '<div class="publish-page">发布成功</div>';
    expect(detectXhsPublishState()).toBe('success');
    expect(isPublishSuccessSignal()).toBe(true);
  });

  it('note-manager URL 且无表单、无强成功文案不应判定 success', () => {
    const saved = window.location;
    vi.stubGlobal('location', {
      ...saved,
      href: 'https://creator.xiaohongshu.com/new/note-manager?source=official',
    });
    document.body.innerHTML = '<div>笔记列表</div>';
    expect(isPublishSuccessSignal()).toBe(false);
    vi.stubGlobal('location', saved);
  });
});
