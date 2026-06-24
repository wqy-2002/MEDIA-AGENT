import { useEffect, useRef } from 'react';
import type { LogEntry, TaskRecord } from '@/types';
import { StatusBadge } from './StatusBadge';
import { PLATFORM_LABELS } from '@/adapters/registry';
import { TASK_TYPE_LABELS, isWaiting } from '@/utils/labels';
import { sendToBackground } from '@/core/messaging';

// 当前任务详情：计划、实时日志、暂停时的「继续」操作。

interface Props {
  task?: TaskRecord;
  logs: LogEntry[];
}

const levelColor: Record<LogEntry['level'], string> = {
  info: 'text-gray-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

export function TaskLogs({ task, logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  if (!task) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        暂无进行中的任务，输入任务后开始执行。
      </div>
    );
  }

  async function resume() {
    if (task) await sendToBackground({ type: 'TASK_RESUME', payload: { taskId: task.id } });
  }
  async function retry() {
    if (task) await sendToBackground({ type: 'TASK_RETRY', payload: { taskId: task.id } });
  }
  async function cancel() {
    if (task) await sendToBackground({ type: 'TASK_CANCEL', payload: { taskId: task.id } });
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">
            {PLATFORM_LABELS[task.platform]} · {TASK_TYPE_LABELS[task.taskType]}
          </span>
          <StatusBadge status={task.status} />
        </div>
      </div>

      {task.plan && (
        <details className="rounded-md bg-gray-50 p-2 text-xs text-gray-600">
          <summary className="cursor-pointer select-none font-medium">执行计划</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
            {JSON.stringify(task.plan, null, 2)}
          </pre>
        </details>
      )}

      {task.generatedContent && (
        <details className="rounded-md bg-brand-50 p-2 text-xs text-gray-700">
          <summary className="cursor-pointer select-none font-medium">生成内容</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
            {JSON.stringify(task.generatedContent, null, 2)}
          </pre>
        </details>
      )}

      <div className="max-h-48 overflow-y-auto rounded-md bg-gray-900 p-2 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500">等待日志…</p>
        ) : (
          logs.map((log, i) => (
            <div key={log.id ?? i} className={`${levelColor[log.level]} leading-relaxed`}>
              <span className="text-gray-500">
                {new Date(log.createdAt).toLocaleTimeString('zh-CN')}{' '}
              </span>
              {log.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {task.errorMessage && (
        <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">
          {task.errorCode ? `[${task.errorCode}] ` : ''}
          {task.errorMessage}
        </p>
      )}

      <div className="flex gap-2">
        {isWaiting(task.status) && (
          <button
            type="button"
            onClick={resume}
            className="flex-1 rounded-md bg-amber-500 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
          >
            我已处理，继续
          </button>
        )}
        {task.status === 'failed' && (
          <button
            type="button"
            onClick={retry}
            className="flex-1 rounded-md bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            重试
          </button>
        )}
        {!['success', 'failed', 'cancelled'].includes(task.status) && (
          <button
            type="button"
            onClick={cancel}
            className="flex-1 rounded-md border border-gray-300 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
        )}
        {task.resultUrl && (
          <a
            href={task.resultUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-md border border-brand-300 py-1.5 text-center text-xs text-brand-600 hover:bg-brand-50"
          >
            查看结果
          </a>
        )}
      </div>
    </div>
  );
}
