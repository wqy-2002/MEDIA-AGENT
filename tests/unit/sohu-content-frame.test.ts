import { describe, it, expect } from 'vitest';
import {
  isAboutBlankFrame,
  shouldIgnoreContentMessage,
} from '@/adapters/sohu/content-frame';

describe('shouldIgnoreContentMessage', () => {
  it('非 about:blank 不应忽略', () => {
    expect(
      shouldIgnoreContentMessage('https://mp.sohu.com/mpfe/v4/contentManagement/first/page', 'mp.sohu.com'),
    ).toBe(false);
  });

  it('小红书 about:blank 子 frame 应忽略', () => {
    expect(shouldIgnoreContentMessage('about:blank', 'www.xiaohongshu.com')).toBe(true);
  });

  it('搜狐 mp.sohu.com 下 about:blank 子 frame 不应忽略', () => {
    expect(shouldIgnoreContentMessage('about:blank', 'mp.sohu.com')).toBe(false);
  });

  it('搜狐 passport 下 about:blank 不应忽略', () => {
    expect(shouldIgnoreContentMessage('about:blank', 'passport.sohu.com')).toBe(false);
  });
});

describe('isAboutBlankFrame', () => {
  it('应识别 about:blank', () => {
    expect(isAboutBlankFrame('about:blank')).toBe(true);
    expect(isAboutBlankFrame('https://mp.sohu.com/')).toBe(false);
  });
});
