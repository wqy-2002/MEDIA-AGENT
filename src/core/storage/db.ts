import Dexie, { type Table } from 'dexie';
import type {
  TaskRecord,
  LogEntry,
  DraftRecord,
  MaterialRecord,
} from '@/types';

export class MediaFlowDB extends Dexie {
  tasks!: Table<TaskRecord, string>;
  logs!: Table<LogEntry, number>;
  drafts!: Table<DraftRecord, string>;
  materials!: Table<MaterialRecord, string>;

  constructor() {
    super('mediaflow_agent');
    this.version(1).stores({
      tasks: 'id, taskType, platform, status, startedAt',
      logs: '++id, taskId, level, createdAt',
      drafts: 'id, taskId, platform, createdAt',
      materials: 'id, mimeType, createdAt',
    });
  }
}

export const db = new MediaFlowDB();

export async function putTask(record: TaskRecord): Promise<void> {
  await db.tasks.put(record);
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
  return db.tasks.get(id);
}

export async function updateTask(
  id: string,
  patch: Partial<TaskRecord>,
): Promise<TaskRecord | undefined> {
  await db.tasks.update(id, patch);
  return db.tasks.get(id);
}

export async function listTasks(limit = 50): Promise<TaskRecord[]> {
  return db.tasks.orderBy('startedAt').reverse().limit(limit).toArray();
}

export async function addLog(entry: LogEntry): Promise<number> {
  return db.logs.add(entry);
}

export async function listLogs(taskId: string): Promise<LogEntry[]> {
  return db.logs.where('taskId').equals(taskId).sortBy('createdAt');
}

export async function putDraft(draft: DraftRecord): Promise<void> {
  await db.drafts.put(draft);
}

export async function putMaterial(material: MaterialRecord): Promise<void> {
  await db.materials.put(material);
}

export async function getMaterial(id: string): Promise<MaterialRecord | undefined> {
  return db.materials.get(id);
}

export async function getMaterials(ids: string[]): Promise<MaterialRecord[]> {
  const items = await db.materials.bulkGet(ids);
  return items.filter((x): x is MaterialRecord => Boolean(x));
}

/** 清除所有本地数据库数据 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tasks, db.logs, db.drafts, db.materials, async () => {
    await Promise.all([
      db.tasks.clear(),
      db.logs.clear(),
      db.drafts.clear(),
      db.materials.clear(),
    ]);
  });
}

/** 统计今日某类动作次数，用于频率限制 */
export async function countTodayByType(
  taskType: TaskRecord['taskType'],
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const ts = startOfDay.getTime();
  return db.tasks
    .where('taskType')
    .equals(taskType)
    .filter((t) => t.startedAt >= ts && t.status === 'success')
    .count();
}
