import type { PlatformName } from '@/types';
import type { PlatformAdapter, PlatformUrls } from './types';
import { xiaohongshuAdapter, XHS_URLS } from './xiaohongshu';
import { sohuAdapter, SOHU_URLS } from './sohu';

const adapters: Record<PlatformName, PlatformAdapter> = {
  xiaohongshu: xiaohongshuAdapter,
  sohu: sohuAdapter,
};

const urls: Record<PlatformName, PlatformUrls> = {
  xiaohongshu: { publishUrl: XHS_URLS.publishUrl, homeUrl: XHS_URLS.homeUrl },
  sohu: {
    publishUrl: SOHU_URLS.publishUrl,
    homeUrl: SOHU_URLS.homeUrl,
    dashboardUrl: SOHU_URLS.dashboardUrl,
    publishUrlAlt: SOHU_URLS.publishUrlAlt,
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
  sohu: '搜狐号',
};

/** URL 匹配到平台名 */
export function platformFromUrl(url: string): PlatformName | undefined {
  if (/xiaohongshu\.com/.test(url)) return 'xiaohongshu';
  if (/passport\.sohu\.com/.test(url)) return 'sohu';
  if (/mp\.sohu\.com/.test(url)) return 'sohu';
  if (
    /sohu\.com/.test(url) &&
    /mpfe\/v4|addarticle|article\/new|contentManagement/.test(url)
  ) {
    return 'sohu';
  }
  return undefined;
}
