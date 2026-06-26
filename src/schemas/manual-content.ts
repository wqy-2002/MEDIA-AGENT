import { z } from 'zod';
import type { GeneratedContent } from '@/types';

/** 小红书标题建议上限 */
export const MANUAL_TITLE_MAX_LENGTH = 20;
/** 正文建议上限 */
export const MANUAL_BODY_MAX_LENGTH = 1000;
/** 话题数量上限 */
export const MANUAL_HASHTAG_MAX_COUNT = 10;

export const manualContentSchema = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    description: z.string().optional(),
    hashtags: z.array(z.string()).max(MANUAL_HASHTAG_MAX_COUNT).optional(),
    comment: z.string().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const title = data.title?.trim() ?? '';
    const body = data.body?.trim() ?? '';
    if (!title && !body) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '标题与正文至少填写一项',
      });
    }
    if (title.length > MANUAL_TITLE_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `标题不能超过 ${MANUAL_TITLE_MAX_LENGTH} 字`,
        path: ['title'],
      });
    }
    if (body.length > MANUAL_BODY_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `正文不能超过 ${MANUAL_BODY_MAX_LENGTH} 字`,
        path: ['body'],
      });
    }
  });

/** 解析并规范化用户输入的手动文案 */
export function normalizeManualContent(input: GeneratedContent): GeneratedContent {
  const title = input.title?.trim();
  const body = input.body?.trim();
  const description = input.description?.trim();
  const hashtags = input.hashtags
    ?.map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, MANUAL_HASHTAG_MAX_COUNT);

  return {
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(description ? { description } : {}),
    ...(hashtags?.length ? { hashtags } : {}),
    ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
  };
}

/** 校验手动文案，失败时抛出 ZodError */
export function validateManualContent(input: GeneratedContent | undefined): GeneratedContent {
  if (!input) {
    throw new Error('缺少手动发布文案');
  }
  const normalized = normalizeManualContent(input);
  return manualContentSchema.parse(normalized) as GeneratedContent;
}

/** 将话题输入字符串解析为数组 */
export function parseHashtagInput(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[,，\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, MANUAL_HASHTAG_MAX_COUNT);
}
