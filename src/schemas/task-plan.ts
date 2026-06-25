import { z } from 'zod';

export const platformNameSchema = z.enum(['xiaohongshu', 'sohu']);

export const taskTypeSchema = z.enum([
  'publish',
  'comment',
  'like',
  'favorite',
  'follow',
]);

export const contentTypeSchema = z.enum(['note', 'video', 'article']);

/** Action 白名单：模型只能输出此列表内的动作 */
export const actionNameSchema = z.enum([
  'check_login',
  'generate_content',
  'open_publish_page',
  'open_target_page',
  'upload_media',
  'fill_title',
  'fill_body',
  'fill_description',
  'fill_hashtags',
  'fill_comment',
  'submit_publish',
  'submit_comment',
  'execute_like',
  'execute_favorite',
  'execute_follow',
  'verify_result',
  'take_screenshot',
  'save_record',
  'pause_for_login',
  'pause_for_verification',
]);

export const taskRequirementsSchema = z
  .object({
    topic: z.string().optional(),
    tone: z.string().optional(),
    length: z.string().optional(),
    hashtags: z.union([z.number(), z.array(z.string())]).optional(),
    commentStyle: z.string().optional(),
  })
  .strict();

export const taskMaterialsSchema = z
  .object({
    images: z.array(z.string()).optional(),
    videos: z.array(z.string()).optional(),
  })
  .strict();

export const taskPlanSchema = z
  .object({
    taskType: taskTypeSchema,
    platform: platformNameSchema,
    contentType: contentTypeSchema.optional(),
    requirements: taskRequirementsSchema.optional(),
    materials: taskMaterialsSchema.optional(),
    targetUrl: z.string().url().optional(),
    actions: z.array(actionNameSchema).min(1),
  })
  .strict();

export type TaskPlanParsed = z.infer<typeof taskPlanSchema>;

/** 模型生成内容的校验 */
export const generatedContentSchema = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    description: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    comment: z.string().optional(),
  })
  .strict();

export type GeneratedContentParsed = z.infer<typeof generatedContentSchema>;
