import { describe, expect, it, beforeEach } from 'vitest';
import { collectDiagnostics, formatDiagnostics } from '@/core/automation/diagnostics';

// 自动化诊断测试：确保失败日志能包含真实候选 DOM 和阻塞原因。

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    }),
  });
});

describe('automation diagnostics', () => {
  it('应采集输入框、编辑器、按钮和阻塞原因', () => {
    document.body.innerHTML = `
      <input placeholder="填写标题会有更多赞哦" />
      <div class="tiptap ProseMirror" role="textbox" contenteditable="true">正文</div>
      <button disabled>发布</button>
      <div class="d-toast">上传中</div>
    `;
    const diag = collectDiagnostics('final_form');
    expect(diag.state).toBe('final_form');
    expect(diag.candidates.inputs.length).toBeGreaterThan(0);
    expect(diag.candidates.editables.length).toBeGreaterThan(0);
    expect(diag.candidates.buttons.length).toBeGreaterThan(0);
    expect(diag.blockers.join(' ')).toContain('生成或上传');
    expect(formatDiagnostics(diag)).toContain('状态: final_form');
  });
});

