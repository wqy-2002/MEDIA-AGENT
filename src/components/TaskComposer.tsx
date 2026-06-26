import { useRef, useState } from 'react';
import type { ContentSource, PlatformName } from '@/types';
import { PLATFORM_LABELS } from '@/adapters/registry';
import { saveMaterials } from '@/utils/materials';
import { sendToBackground } from '@/core/messaging';
import type { TaskRecord } from '@/types';
import {
  MANUAL_BODY_MAX_LENGTH,
  MANUAL_TITLE_MAX_LENGTH,
  manualContentSchema,
  normalizeManualContent,
  parseHashtagInput,
} from '@/schemas/manual-content';

const PLATFORMS: PlatformName[] = ['xiaohongshu', 'sohu'];

interface Props {
  defaultPlatform: PlatformName;
  contentSource: ContentSource;
  apiKeyMissing?: boolean;
  onCreated: (record: TaskRecord) => void;
}

export function TaskComposer({
  defaultPlatform,
  contentSource,
  apiKeyMissing,
  onCreated,
}: Props) {
  const [userInput, setUserInput] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [manualHashtags, setManualHashtags] = useState('');
  const [platform, setPlatform] = useState<PlatformName>(defaultPlatform);
  const [targetUrl, setTargetUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    setError('');
    const isManual = contentSource === 'manual';

    if (isManual) {
      const manualContent = normalizeManualContent({
        title: manualTitle,
        body: manualBody,
        hashtags: parseHashtagInput(manualHashtags),
      });
      const parsed = manualContentSchema.safeParse(manualContent);
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? '文案校验失败');
        return;
      }
    } else {
      if (!userInput.trim()) {
        setError('请输入任务描述');
        return;
      }
      if (apiKeyMissing) {
        setError('请先配置模型 API Key');
        return;
      }
    }

    setSubmitting(true);
    try {
      const materialIds = files.length ? await saveMaterials(files) : undefined;
      const res = await sendToBackground<TaskRecord>({
        type: 'TASK_CREATE',
        payload: isManual
          ? {
              contentSource: 'manual',
              userInput: manualTitle.trim() || '手动发布',
              manualContent: normalizeManualContent({
                title: manualTitle,
                body: manualBody,
                hashtags: parseHashtagInput(manualHashtags),
              }),
              platform,
              materialIds,
            }
          : {
              userInput: userInput.trim(),
              platform,
              targetUrl: targetUrl.trim() || undefined,
              materialIds,
            },
      });
      if (res.ok && res.data) {
        onCreated(res.data);
        setUserInput('');
        setManualTitle('');
        setManualBody('');
        setManualHashtags('');
        setTargetUrl('');
        setFiles([]);
        if (fileRef.current) fileRef.current.value = '';
      } else {
        setError(res.errorMessage ?? '创建任务失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      {contentSource === 'ai' ? (
        <textarea
          className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          rows={3}
          placeholder="用一句话描述你的任务，例如：帮我在小红书发一篇关于露营好物的图文笔记，配 3 个话题"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
        />
      ) : (
        <div className="space-y-2">
          <input
            className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder={`标题（选填，≤${MANUAL_TITLE_MAX_LENGTH} 字）`}
            value={manualTitle}
            maxLength={MANUAL_TITLE_MAX_LENGTH}
            onChange={(e) => setManualTitle(e.target.value)}
          />
          <textarea
            className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={4}
            placeholder={`正文（与标题至少填一项，≤${MANUAL_BODY_MAX_LENGTH} 字）`}
            value={manualBody}
            maxLength={MANUAL_BODY_MAX_LENGTH}
            onChange={(e) => setManualBody(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="话题，逗号或空格分隔，如：露营,好物"
            value={manualHashtags}
            onChange={(e) => setManualHashtags(e.target.value)}
          />
          <p className="text-xs text-gray-500">无需 API Key，直接使用自备文案发布</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          className="flex-1 rounded-md border border-gray-300 p-1.5 text-sm focus:border-brand-500 focus:outline-none"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformName)}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          onClick={() => fileRef.current?.click()}
        >
          素材{files.length ? `(${files.length})` : ''}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {contentSource === 'ai' && (
        <input
          className="w-full rounded-md border border-gray-300 p-1.5 text-sm focus:border-brand-500 focus:outline-none"
          placeholder="目标页面 URL（评论/点赞/关注任务需要，选填）"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
        />
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? '创建中…' : contentSource === 'manual' ? '手动发布' : '执行任务'}
      </button>
    </div>
  );
}
