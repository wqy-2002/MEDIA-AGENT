import { useState, useRef } from 'react';
import type { PlatformName } from '@/types';
import { PLATFORM_LABELS } from '@/adapters/registry';
import { saveMaterials } from '@/utils/materials';
import { sendToBackground } from '@/core/messaging';
import type { TaskRecord } from '@/types';

// 任务输入区：自然语言任务、平台选择、目标 URL、素材上传。

const PLATFORMS: PlatformName[] = [
  'xiaohongshu',
  'douyin',
  'wechat_channel',
  'wechat_official',
];

interface Props {
  defaultPlatform: PlatformName;
  onCreated: (record: TaskRecord) => void;
}

export function TaskComposer({ defaultPlatform, onCreated }: Props) {
  const [userInput, setUserInput] = useState('');
  const [platform, setPlatform] = useState<PlatformName>(defaultPlatform);
  const [targetUrl, setTargetUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    setError('');
    if (!userInput.trim()) {
      setError('请输入任务描述');
      return;
    }
    setSubmitting(true);
    try {
      const materialIds = files.length ? await saveMaterials(files) : undefined;
      const res = await sendToBackground<TaskRecord>({
        type: 'TASK_CREATE',
        payload: {
          userInput: userInput.trim(),
          platform,
          targetUrl: targetUrl.trim() || undefined,
          materialIds,
        },
      });
      if (res.ok && res.data) {
        onCreated(res.data);
        setUserInput('');
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
      <textarea
        className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        rows={3}
        placeholder="用一句话描述你的任务，例如：帮我在小红书发一篇关于露营好物的图文笔记，配 3 个话题"
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
      />

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

      <input
        className="w-full rounded-md border border-gray-300 p-1.5 text-sm focus:border-brand-500 focus:outline-none"
        placeholder="目标页面 URL（评论/点赞/关注任务需要，选填）"
        value={targetUrl}
        onChange={(e) => setTargetUrl(e.target.value)}
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? '创建中…' : '执行任务'}
      </button>
    </div>
  );
}
