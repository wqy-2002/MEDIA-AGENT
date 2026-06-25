import { create } from 'zustand';
import type { LogEntry, TaskRecord } from '@/types';
import { listTasks, listLogs } from '@/core/storage/db';

interface TaskState {
  tasks: TaskRecord[];
  currentTaskId?: string;
  logs: LogEntry[];
  loading: boolean;

  /** 从 IndexedDB 加载历史任务 */
  refreshTasks: () => Promise<void>;
  /** 选中并加载某任务日志 */
  selectTask: (taskId: string) => Promise<void>;
  /** 设置当前任务（创建后调用） */
  setCurrentTask: (record: TaskRecord) => void;
  /** 收到实时日志时追加 */
  appendLog: (taskId: string, log: LogEntry) => void;
  /** 从 DB 重新拉取当前任务的完整日志（权威来源，避免竞态丢失） */
  reloadLogs: (taskId: string) => Promise<void>;
  /** 更新某任务记录（状态变化） */
  upsertTask: (record: TaskRecord) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  logs: [],
  loading: false,

  async refreshTasks() {
    set({ loading: true });
    const tasks = await listTasks(50);
    set({ tasks, loading: false });
  },

  async selectTask(taskId: string) {
    const logs = await listLogs(taskId);
    set({ currentTaskId: taskId, logs });
  },

  setCurrentTask(record: TaskRecord) {
    set((s) => ({
      currentTaskId: record.id,
      logs: [],
      tasks: [record, ...s.tasks.filter((t) => t.id !== record.id)],
    }));
  },

  appendLog(taskId: string, log: LogEntry) {
    if (get().currentTaskId !== taskId) return;
    set((s) => ({ logs: [...s.logs, log] }));
  },

  async reloadLogs(taskId: string) {
    if (get().currentTaskId !== taskId) return;
    const logs = await listLogs(taskId);
    set({ logs });
  },

  upsertTask(record: TaskRecord) {
    set((s) => {
      const exists = s.tasks.some((t) => t.id === record.id);
      return {
        tasks: exists
          ? s.tasks.map((t) => (t.id === record.id ? record : t))
          : [record, ...s.tasks],
      };
    });
  },
}));
