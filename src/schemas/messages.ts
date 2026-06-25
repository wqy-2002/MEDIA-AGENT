import { z } from 'zod';
import { platformNameSchema } from './task-plan';

export const modelConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
});

export const createTaskPayloadSchema = z.object({
  userInput: z.string().min(1, '任务描述不能为空'),
  platform: platformNameSchema.optional(),
  targetUrl: z.string().url().optional(),
  materialIds: z.array(z.string()).optional(),
});

export const contentCommandSchema = z.enum([
  'check_login',
  'detect_state',
  'get_diagnostics',
  'ensure_publish_page',
  'upload_media',
  'fill_content',
  'submit_publish',
  'run_publish_flow',
  'run_engagement_flow',
  'read_page',
  'execute_comment',
  'execute_like',
  'execute_favorite',
  'execute_follow',
  'verify_result',
  'capture_result',
  'click_viewport_point',
  'scan_publish_button',
  'click_publish_button',
]);

export const executeActionPayloadSchema = z.object({
  taskId: z.string(),
  platform: platformNameSchema,
  command: contentCommandSchema,
  // 不同命令的附带数据，结构由具体 adapter 解释
  args: z.record(z.unknown()).optional(),
});

export type CreateTaskPayloadParsed = z.infer<typeof createTaskPayloadSchema>;
export type ExecuteActionPayloadParsed = z.infer<typeof executeActionPayloadSchema>;
export type ModelConfigParsed = z.infer<typeof modelConfigSchema>;
