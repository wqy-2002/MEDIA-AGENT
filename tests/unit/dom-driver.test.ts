import { describe, expect, it } from 'vitest';
import { verifyEditableContains } from '@/core/automation/dom-driver';

describe('verifyEditableContains', () => {
  it('换行 expected 与无换行 actual 应匹配', () => {
    const el = document.createElement('div');
    el.textContent = '111111近期入手好物分享';
    document.body.appendChild(el);
    expect(verifyEditableContains(el, '111111\n近期入手好物分享')).toBe(true);
    document.body.removeChild(el);
  });

  it('应忽略小红书草稿区「写文字」占位前缀', () => {
    const el = document.createElement('div');
    el.textContent = '写文字近期入手好物分享正文';
    document.body.appendChild(el);
    expect(verifyEditableContains(el, '近期入手好物分享正文')).toBe(true);
    document.body.removeChild(el);
  });

  it('多行 expected 任一行 probe 命中即可', () => {
    const el = document.createElement('div');
    el.textContent = '近期入手好物分享姐妹们';
    document.body.appendChild(el);
    expect(verifyEditableContains(el, '标题行\n近期入手好物分享姐妹们')).toBe(true);
    document.body.removeChild(el);
  });
});
