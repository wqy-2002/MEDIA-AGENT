import type { PlatformName } from '@/types';
import type { PlatformAdapter, PlatformUrls } from './types';
import { xiaohongshuAdapter, XHS_URLS } from './xiaohongshu';
import { douyinAdapter, DOUYIN_URLS } from './douyin';
import { wechatChannelAdapter, WECHAT_CHANNEL_URLS } from './wechat-channel';
import { wechatOfficialAdapter, WECHAT_OFFICIAL_URLS } from './wechat-official';

// 适配器注册表：根据平台名获取对应 Adapter（Content Script 侧）
// 以及发布页 / 主页 URL（Background 侧用于打开 tab）。

const adapters: Record<PlatformName, PlatformAdapter> = {
  xiaohongshu: xiaohongshuAdapter,
  douyin: douyinAdapter,
  wechat_channel: wechatChannelAdapter,
  wechat_official: wechatOfficialAdapter,
};

const urls: Record<PlatformName, PlatformUrls> = {
  xiaohongshu: { publishUrl: XHS_URLS.publishUrl, homeUrl: XHS_URLS.homeUrl },
  douyin: { publishUrl: DOUYIN_URLS.publishUrl, homeUrl: DOUYIN_URLS.homeUrl },
  wechat_channel: {
    publishUrl: WECHAT_CHANNEL_URLS.publishUrl,
    homeUrl: WECHAT_CHANNEL_URLS.homeUrl,
  },
  wechat_official: {
    publishUrl: WECHAT_OFFICIAL_URLS.publishUrl,
    homeUrl: WECHAT_OFFICIAL_URLS.homeUrl,
  },
};

export function getAdapter(platform: PlatformName): PlatformAdapter | undefined {
  return adapters[platform];
}

export function getPlatformUrls(platform: PlatformName): PlatformUrls {
  return urls[platform];
}

/** 平台中文名 */
export const PLATFORM_LABELS: Record<PlatformName, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  wechat_channel: '微信视频号',
  wechat_official: '微信公众号',
};

/** URL 匹配到平台名 */
export function platformFromUrl(url: string): PlatformName | undefined {
  if (/xiaohongshu\.com/.test(url)) return 'xiaohongshu';
  if (/douyin\.com/.test(url)) return 'douyin';
  if (/channels\.weixin\.qq\.com/.test(url)) return 'wechat_channel';
  if (/mp\.weixin\.qq\.com/.test(url)) return 'wechat_official';
  return undefined;
}
