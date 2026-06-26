import { useEffect, useState } from 'react';
import type { AppSettings, PlatformName } from '@/types';
import {
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
} from '@/core/storage/settings';
import { clearAllData } from '@/core/storage/db';
import { sendToBackground } from '@/core/messaging';
import { PLATFORM_LABELS } from '@/adapters/registry';
import {
  applyTypingSafetyLevel,
  getTypingSafetyLabel,
} from '@/core/automation/typing-safety-presets';
import type { TypingSafetyLevel } from '@/types';

const PLATFORMS: PlatformName[] = ['xiaohongshu', 'sohu'];

const AUTOMATION_LABELS: Record<keyof AppSettings['automation'], string> = {
  autoPublish: '自动发布',
  autoComment: '自动评论',
  autoLike: '自动点赞',
  autoFavorite: '自动收藏',
  autoFollow: '自动关注',
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  function update(patch: Partial<AppSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  }

  async function handleSave() {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult('');
    const res = await sendToBackground<{ message: string }>({
      type: 'MODEL_TEST',
      payload: { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model },
    });
    setTestResult(res.ok ? (res.data?.message ?? '连接成功') : (res.errorMessage ?? '连接失败'));
    setTesting(false);
  }

  async function handleClearData() {
    if (!confirm('确定要清除所有本地任务记录、日志、草稿和素材吗？此操作不可恢复。')) return;
    await clearAllData();
    alert('本地数据已清除');
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">MediaFlow Agent 设置</h1>
        <p className="mt-1 text-sm text-gray-500">配置模型、默认偏好、自动化开关与频率限制。</p>
      </header>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">模型配置</h2>
        <Field label="API Key">
          <input
            type="password"
            className="input"
            value={settings.apiKey}
            placeholder="sk-..."
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </Field>
        <Field label="Base URL（OpenAI 兼容）">
          <input
            className="input"
            value={settings.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </Field>
        <Field label="默认模型">
          <input
            className="input"
            value={settings.model}
            placeholder="deepseek-chat"
            onChange={(e) => update({ model: e.target.value })}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !settings.apiKey}
            className="rounded-md border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          {testResult && <span className="text-xs text-gray-600">{testResult}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">默认偏好</h2>
        <Field label="默认平台">
          <select
            className="input"
            value={settings.defaultPlatform}
            onChange={(e) => update({ defaultPlatform: e.target.value as PlatformName })}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="文案风格">
          <input
            className="input"
            value={settings.contentTone}
            onChange={(e) => update({ contentTone: e.target.value })}
          />
        </Field>
        <Field label="评论风格">
          <input
            className="input"
            value={settings.commentStyle}
            onChange={(e) => update({ commentStyle: e.target.value })}
          />
        </Field>
      </section>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">自动化开关</h2>
        <p className="text-xs text-gray-500">
          所有自动发布 / 评论 / 关注动作默认关闭，需手动开启对应开关后才会执行。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(AUTOMATION_LABELS) as Array<keyof AppSettings['automation']>).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.automation[key]}
                onChange={(e) =>
                  update({ automation: { ...settings.automation, [key]: e.target.checked } })
                }
              />
              {AUTOMATION_LABELS[key]}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">平台开关</h2>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.platformSwitch[p]}
                onChange={(e) =>
                  update({ platformSwitch: { ...settings.platformSwitch, [p]: e.target.checked } })
                }
              />
              {PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">频率限制</h2>
        <Field label="单日评论上限">
          <input
            type="number"
            className="input"
            value={settings.rateLimit.maxCommentsPerDay}
            onChange={(e) =>
              update({
                rateLimit: { ...settings.rateLimit, maxCommentsPerDay: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="单日互动上限（点赞/收藏/关注）">
          <input
            type="number"
            className="input"
            value={settings.rateLimit.maxEngagementsPerDay}
            onChange={(e) =>
              update({
                rateLimit: { ...settings.rateLimit, maxEngagementsPerDay: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="连续失败暂停阈值">
          <input
            type="number"
            className="input"
            value={settings.rateLimit.maxConsecutiveFailures}
            onChange={(e) =>
              update({
                rateLimit: {
                  ...settings.rateLimit,
                  maxConsecutiveFailures: Number(e.target.value),
                },
              })
            }
          />
        </Field>
        <Field label="单日发布上限">
          <input
            type="number"
            className="input"
            value={settings.rateLimit.maxPublishesPerDay}
            onChange={(e) =>
              update({
                rateLimit: { ...settings.rateLimit, maxPublishesPerDay: Number(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="发布最短间隔（分钟）">
          <input
            type="number"
            className="input"
            value={settings.rateLimit.minMinutesBetweenPublishes}
            onChange={(e) =>
              update({
                rateLimit: {
                  ...settings.rateLimit,
                  minMinutesBetweenPublishes: Number(e.target.value),
                },
              })
            }
          />
        </Field>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800">小红书发布防风控</h2>
        <p className="text-xs text-gray-500">
          放慢发布节奏、分块输入与步骤间停顿，降低触发平台风控的概率。调试时可关闭「启用节奏」。
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={settings.publishPacing.enabled}
            onChange={(e) =>
              update({
                publishPacing: { ...settings.publishPacing, enabled: e.target.checked },
              })
            }
          />
          启用发布节奏（防风控）
        </label>
        <Field label="文本填入安全等级">
          <select
            className="input"
            value={settings.publishPacing.typingSafetyLevel ?? 'ultra_safe'}
            onChange={(e) => {
              const level = e.target.value as TypingSafetyLevel;
              update({
                publishPacing: applyTypingSafetyLevel(level, settings.publishPacing),
              });
            }}
          >
            {(['fast', 'balanced', 'safe', 'ultra_safe'] as TypingSafetyLevel[]).map((level) => (
              <option key={level} value={level}>
                {getTypingSafetyLabel(level)}
                {level === 'ultra_safe' ? '（逐字输入，默认）' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="大步骤间停顿（秒，最小）">
          <input
            type="number"
            className="input"
            value={settings.publishPacing.stepGapMinMs / 1000}
            onChange={(e) =>
              update({
                publishPacing: {
                  ...settings.publishPacing,
                  stepGapMinMs: Number(e.target.value) * 1000,
                },
              })
            }
          />
        </Field>
        <Field label="大步骤间停顿（秒，最大）">
          <input
            type="number"
            className="input"
            value={settings.publishPacing.stepGapMaxMs / 1000}
            onChange={(e) =>
              update({
                publishPacing: {
                  ...settings.publishPacing,
                  stepGapMaxMs: Number(e.target.value) * 1000,
                },
              })
            }
          />
        </Field>
      </section>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm text-xs text-gray-600">
        <h2 className="text-sm font-semibold text-gray-800">权限与隐私说明</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>storage：保存设置与本地任务数据。</li>
          <li>tabs / activeTab / scripting：打开支持的平台页面并执行受约束的页面操作。</li>
          <li>sidePanel：提供侧边栏主操作界面。</li>
          <li>仅对小红书、搜狐号注入脚本。</li>
          <li>不保存平台账号密码，不读取 Cookie，不读取私信与支付信息，不绕过验证码与风控。</li>
        </ul>
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleClearData}
          className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          清除本地数据
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-600">已保存</span>}
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
