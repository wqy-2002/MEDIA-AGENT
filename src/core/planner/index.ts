import type {
  AppSettings,
  GeneratedContent,
  ModelConfig,
  PlatformName,
  TaskPlan,
} from '@/types';
import { chatCompletion, extractJson, ModelError } from '@/core/model';
import { taskPlanSchema, generatedContentSchema } from '@/schemas/task-plan';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  buildContentSystemPrompt,
  buildContentUserPrompt,
} from '@/prompts';

const MAX_RETRY = 2;

/**
 * 解析用户输入为 TaskPlan。
 * @param config 模型配置
 * @param settings 用户设置（提供默认平台）
 * @param input 用户输入与素材信息
 */
export async function parseTaskPlan(
  config: ModelConfig,
  settings: AppSettings,
  input: {
    userInput: string;
    platform?: PlatformName;
    targetUrl?: string;
    hasImages: boolean;
    hasVideos: boolean;
  },
  signal?: AbortSignal,
): Promise<TaskPlan> {
  const system = buildPlannerSystemPrompt();
  const user = buildPlannerUserPrompt({
    userInput: input.userInput,
    defaultPlatform: input.platform ?? settings.defaultPlatform,
    targetUrl: input.targetUrl,
    hasImages: input.hasImages,
    hasVideos: input.hasVideos,
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const raw = await chatCompletion(
        config,
        [
          { role: 'system', content: system },
          {
            role: 'user',
            content:
              attempt === 0
                ? user
                : `${user}\n\n注意：上一次输出无法通过校验，请严格只返回合法 JSON。`,
          },
        ],
        { temperature: 0.2, signal },
      );
      const json = extractJson(raw);
      const parsed = taskPlanSchema.parse(json);
      // 用户明确指定了平台/目标地址时以用户输入为准
      if (input.platform) parsed.platform = input.platform;
      if (input.targetUrl) parsed.targetUrl = input.targetUrl;
      return parsed as TaskPlan;
    } catch (err) {
      lastErr = err;
      if (err instanceof ModelError && err.code === 'MODEL_API_KEY_MISSING') throw err;
    }
  }
  throw new ModelError(
    'TASK_PARSE_FAILED',
    `任务解析失败（已重试 ${MAX_RETRY} 次）：${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** 生成可发布内容 */
export async function generateContent(
  config: ModelConfig,
  settings: AppSettings,
  plan: TaskPlan,
  signal?: AbortSignal,
): Promise<GeneratedContent> {
  const system = buildContentSystemPrompt(settings);
  const user = buildContentUserPrompt({
    platform: plan.platform,
    contentType: plan.contentType,
    topic: plan.requirements?.topic,
    tone: plan.requirements?.tone ?? settings.contentTone,
    length: plan.requirements?.length,
    hashtags: plan.requirements?.hashtags,
    commentStyle: plan.requirements?.commentStyle ?? settings.commentStyle,
    needComment:
      plan.taskType === 'comment' || plan.actions.includes('fill_comment'),
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const raw = await chatCompletion(
        config,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.8, signal },
      );
      const json = extractJson(raw);
      return generatedContentSchema.parse(json) as GeneratedContent;
    } catch (err) {
      lastErr = err;
      if (err instanceof ModelError && err.code === 'MODEL_API_KEY_MISSING') throw err;
    }
  }
  throw new ModelError(
    'TASK_PARSE_FAILED',
    `内容生成失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
