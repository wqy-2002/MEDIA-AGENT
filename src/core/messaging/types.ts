import type {
  ActionResult,
  ModelConfig,
  PlatformName,
  TaskRecord,
  TaskStatus,
  LogEntry,
} from '@/types';
import type { ContentCommand } from '@/adapters/types';

export interface CreateTaskPayload {
  userInput: string;
  platform?: PlatformName;
  targetUrl?: string;
  /** 已上传到 IndexedDB 的素材 id 列表 */
  materialIds?: string[];
}

export interface TaskStatusPayload {
  taskId: string;
  status: TaskStatus;
  record?: TaskRecord;
  log?: LogEntry;
}

export interface ExecuteActionPayload {
  taskId: string;
  platform: PlatformName;
  command: ContentCommand;
  args?: Record<string, unknown>;
}

/** Side Panel / Options / Content Script 与 Background 之间传递的消息 */
export type ExtensionMessage =
  | { type: 'TASK_CREATE'; payload: CreateTaskPayload }
  | { type: 'TASK_STATUS_UPDATE'; payload: TaskStatusPayload }
  | { type: 'TASK_CANCEL'; payload: { taskId: string } }
  | { type: 'TASK_RETRY'; payload: { taskId: string } }
  | { type: 'TASK_RESUME'; payload: { taskId: string } }
  | { type: 'MODEL_TEST'; payload: ModelConfig }
  | { type: 'PLATFORM_CHECK_LOGIN'; payload: { platform: PlatformName } }
  | { type: 'CONTENT_EXECUTE_ACTION'; payload: ExecuteActionPayload }
  | { type: 'CONTENT_ACTION_RESULT'; payload: ActionResult }
  | { type: 'PING' };

/** 统一的消息响应结构 */
export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
}
