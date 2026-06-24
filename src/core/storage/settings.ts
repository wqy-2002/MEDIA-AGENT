import type { AppSettings, ModelConfig, PlatformName } from '@/types';

// 设置存储：保存在 chrome.storage.local（参见开发文档第 12.1 节）
// 内容包括 API Key、Base URL、默认模型、平台开关、自动化开关、用户偏好、频率限制。

const SETTINGS_KEY = 'mediaflow_settings';

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  defaultPlatform: 'xiaohongshu',
  contentTone: '真诚分享',
  commentStyle: '友好自然',
  automation: {
    autoPublish: false,
    autoComment: false,
    autoLike: false,
    autoFavorite: false,
    autoFollow: false,
  },
  rateLimit: {
    maxCommentsPerDay: 20,
    maxEngagementsPerDay: 50,
    maxConsecutiveFailures: 3,
  },
  platformSwitch: {
    xiaohongshu: true,
    douyin: true,
    wechat_channel: true,
    wechat_official: true,
  },
};

/** 深合并默认值，保证新增字段有兜底 */
function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    automation: { ...DEFAULT_SETTINGS.automation, ...stored.automation },
    rateLimit: { ...DEFAULT_SETTINGS.rateLimit, ...stored.rateLimit },
    platformSwitch: {
      ...DEFAULT_SETTINGS.platformSwitch,
      ...stored.platformSwitch,
    } as Record<PlatformName, boolean>,
  };
}

/** 读取设置 */
export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] as Partial<AppSettings> | undefined);
}

/** 保存（部分）设置 */
export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = mergeSettings({ ...current, ...partial });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** 读取模型配置 */
export async function getModelConfig(): Promise<ModelConfig> {
  const s = await getSettings();
  return { apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model };
}

/** 清除所有设置（恢复默认） */
export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove(SETTINGS_KEY);
}

/** 监听设置变化 */
export function onSettingsChanged(cb: (settings: AppSettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]) {
      cb(mergeSettings(changes[SETTINGS_KEY].newValue as Partial<AppSettings>));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
