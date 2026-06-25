import { useEffect, useState } from 'react';
import type { AppSettings } from '@/types';
import { getSettings } from '@/core/storage/settings';
import { getTask } from '@/core/storage/db';
import { useTaskStore } from '@/stores/task-store';
import { onMessage } from '@/core/messaging';
import { TaskComposer } from '@/components/TaskComposer';
import { TaskLogs } from '@/components/TaskLogs';
import { TaskHistory } from '@/components/TaskHistory';

type Tab = 'run' | 'history';

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<Tab>('run');
  const {
    tasks,
    currentTaskId,
    logs,
    refreshTasks,
    selectTask,
    setCurrentTask,
    appendLog,
    reloadLogs,
    upsertTask,
  } = useTaskStore();

  const currentTask = tasks.find((t) => t.id === currentTaskId);

  useEffect(() => {
    void getSettings().then(setSettings);
    void refreshTasks();

    const off = onMessage((message) => {
      if (message.type === 'TASK_STATUS_UPDATE') {
        const { taskId, log } = message.payload;
        // 先追加本条日志，再从 DB 拉完整日志对齐，避免早期日志因竞态丢失
        if (log) appendLog(taskId, log);
        void reloadLogs(taskId);
        void getTask(taskId).then((rec) => {
          if (rec) upsertTask(rec);
        });
      }
    });
    return off;
  }, []);

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  if (!settings) {
    return <div className="p-4 text-sm text-gray-500">加载中…</div>;
  }

  const apiKeyMissing = !settings.apiKey;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <span className="text-sm font-semibold text-gray-800">MediaFlow Agent</span>
        </div>
        <button
          type="button"
          onClick={openOptions}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
          title="设置"
        >
          设置
        </button>
      </header>

      {apiKeyMissing && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          尚未配置模型 API Key，请先到
          <button onClick={openOptions} className="mx-1 underline">
            设置页
          </button>
          填写后再执行任务。
        </div>
      )}

      <nav className="flex border-b border-gray-200 bg-white text-sm">
        <button
          type="button"
          onClick={() => setTab('run')}
          className={`flex-1 py-2 ${tab === 'run' ? 'border-b-2 border-brand-600 font-medium text-brand-700' : 'text-gray-500'}`}
        >
          执行
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('history');
            void refreshTasks();
          }}
          className={`flex-1 py-2 ${tab === 'history' ? 'border-b-2 border-brand-600 font-medium text-brand-700' : 'text-gray-500'}`}
        >
          历史
        </button>
      </nav>

      <main className="flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'run' ? (
          <>
            <TaskComposer
              defaultPlatform={settings.defaultPlatform}
              onCreated={(rec) => {
                setCurrentTask(rec);
                void selectTask(rec.id);
              }}
            />
            <TaskLogs task={currentTask} logs={logs} />
          </>
        ) : (
          <TaskHistory
            tasks={tasks}
            currentTaskId={currentTaskId}
            onSelect={(id) => {
              void selectTask(id);
              setTab('run');
            }}
          />
        )}
      </main>
    </div>
  );
}
