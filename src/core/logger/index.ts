import type { LogEntry, TaskStatus } from '@/types';
import { addLog } from '@/core/storage/db';
import { broadcastTaskStatus } from '@/core/messaging';

// 日志模块：所有关键步骤都要写日志（参见开发文档原则第 10 条）。
// 日志同时落 IndexedDB，并广播给 Side Panel 以实时展示。

export interface LoggerLike {
  info(message: string, data?: unknown): Promise<void>;
  warn(message: string, data?: unknown): Promise<void>;
  error(message: string, data?: unknown): Promise<void>;
  status(status: TaskStatus, message: string): Promise<void>;
}

/** 为某个任务创建 logger */
export function createTaskLogger(taskId: string): LoggerLike {
  async function write(
    level: LogEntry['level'],
    message: string,
    data?: unknown,
    status?: TaskStatus,
  ): Promise<void> {
    const entry: LogEntry = {
      taskId,
      level,
      message,
      data,
      status,
      createdAt: Date.now(),
    };
    try {
      const id = await addLog(entry);
      entry.id = id;
    } catch (err) {
      console.error('[MediaFlow] 写日志失败', err);
    }
    // 控制台同步输出便于调试
    const prefix = `[MediaFlow][${taskId.slice(0, 8)}]`;
    if (level === 'error') console.error(prefix, message, data ?? '');
    else if (level === 'warn') console.warn(prefix, message, data ?? '');
    else console.info(prefix, message, data ?? '');

    broadcastTaskStatus({ taskId, status: status ?? 'created', log: entry });
  }

  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    status: (status, message) => write('info', message, undefined, status),
  };
}
