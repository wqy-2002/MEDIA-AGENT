import type { TaskRecord } from '@/types';
import { StatusBadge } from './StatusBadge';
import { PLATFORM_LABELS } from '@/adapters/registry';
import { TASK_TYPE_LABELS } from '@/utils/labels';

interface Props {
  tasks: TaskRecord[];
  currentTaskId?: string;
  onSelect: (taskId: string) => void;
}

export function TaskHistory({ tasks, currentTaskId, onSelect }: Props) {
  if (!tasks.length) {
    return <p className="px-1 py-4 text-center text-xs text-gray-400">暂无历史任务</p>;
  }
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className={`w-full rounded-md border p-2 text-left transition ${
              t.id === currentTaskId
                ? 'border-brand-400 bg-brand-50'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">
                {PLATFORM_LABELS[t.platform]} · {TASK_TYPE_LABELS[t.taskType]}
              </span>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-1 truncate text-xs text-gray-500">{t.userInput}</p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {new Date(t.startedAt).toLocaleString('zh-CN')}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
