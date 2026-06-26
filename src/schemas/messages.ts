import { z } from 'zod';
import { platformNameSchema } from './task-plan';
import { manualContentSchema } from './manual-content';

export const modelConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
});

export const createTaskPayloadSchema = z
  .object({
    userInput: z.string(),
    contentSource: z.enum(['ai', 'manual']).optional().default('ai'),
    manualContent: manualContentSchema.optional(),
    platform: platformNameSchema.optional(),
    targetUrl: z.string().url().optional(),
    materialIds: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.contentSource === 'manual') {
      if (!data.manualContent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '缺少手动发布文案',
          path: ['manualContent'],
        });
      }
    } else if (!data.userInput.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '任务描述不能为空',
        path: ['userInput'],
      });
    }
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
