import type { AppSettings, ModelConfig, PlatformName } from '@/types';
import { DEFAULT_PUBLISH_PACING } from '@/core/automation/human-pacing';

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
    maxPublishesPerDay: 5,
    minMinutesBetweenPublishes: 30,
  },
  publishPacing: { ...DEFAULT_PUBLISH_PACING },
  platformSwitch: {
    xiaohongshu: true,
    sohu: true,
  },
};

const SUPPORTED_PLATFORMS: PlatformName[] = ['xiaohongshu', 'sohu'];

function normalizePlatform(value: unknown): PlatformName {
  return SUPPORTED_PLATFORMS.includes(value as PlatformName)
    ? (value as PlatformName)
    : DEFAULT_SETTINGS.defaultPlatform;
}

function normalizePlatformSwitch(
  stored: Partial<Record<string, boolean>> | undefined,
): Record<PlatformName, boolean> {
  return {
    xiaohongshu: stored?.xiaohongshu ?? DEFAULT_SETTINGS.platformSwitch.xiaohongshu,
    sohu: stored?.sohu ?? DEFAULT_SETTINGS.platformSwitch.sohu,
  };
}

/** 深合并默认值，保证新增字段有兜底 */
function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    defaultPlatform: normalizePlatform(stored.defaultPlatform),
    automation: { ...DEFAULT_SETTINGS.automation, ...stored.automation },
    rateLimit: { ...DEFAULT_SETTINGS.rateLimit, ...stored.rateLimit },
    publishPacing: { ...DEFAULT_SETTINGS.publishPacing, ...stored.publishPacing },
    platformSwitch: normalizePlatformSwitch(stored.platformSwitch),
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
