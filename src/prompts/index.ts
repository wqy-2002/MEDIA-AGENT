import type { AppSettings, PlatformName } from '@/types';

const PLATFORM_LABELS: Record<PlatformName, string> = {
  xiaohongshu: '小红书',
  sohu: '搜狐号',
};

/** 任务解析（Intent Parser + Task Planner）系统提示词 */
export function buildPlannerSystemPrompt(): string {
  return `你是 MediaFlow Agent 的任务解析器。你的唯一职责是把用户的自然语言任务解析为结构化 JSON 执行计划（TaskPlan）。

严格遵守以下规则：
1. 只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块标记或多余文字。
2. 不要输出任何 JavaScript 代码、DOM 选择器、Cookie 操作或网址抓取脚本。
3. taskType 必须是: publish | comment | like | favorite | follow 之一。
4. platform 必须是: xiaohongshu | sohu 之一。
5. contentType 可选: note | video | article。
6. actions 必须是下列白名单的子集（按执行顺序排列）:
   check_login, generate_content, open_publish_page, open_target_page, upload_media,
   fill_title, fill_body, fill_description, fill_hashtags, fill_comment, submit_publish,
   submit_comment, execute_like, execute_favorite, execute_follow, verify_result,
   take_screenshot, save_record, pause_for_login, pause_for_verification。
7. 如果是发布任务，actions 通常包含: check_login, generate_content, open_publish_page, upload_media(若有素材), fill_title, fill_body, fill_hashtags, submit_publish, verify_result, save_record。
8. 如果是评论任务，actions 必须包含: check_login, generate_content, open_target_page, submit_comment, verify_result, save_record，并需要 targetUrl。
9. 如果是点赞/收藏/关注任务，必须包含 open_target_page，并需要 targetUrl。
10. requirements 中提取主题(topic)、语气(tone)、长度(length)、话题数量或列表(hashtags)、评论风格(commentStyle)。

TaskPlan 的 TypeScript 结构如下:
interface TaskPlan {
  taskType: 'publish' | 'comment' | 'like' | 'favorite' | 'follow';
  platform: 'xiaohongshu' | 'sohu';
  contentType?: 'note' | 'video' | 'article';
  requirements?: { topic?: string; tone?: string; length?: string; hashtags?: number | string[]; commentStyle?: string };
  materials?: { images?: string[]; videos?: string[] };
  targetUrl?: string;
  actions: string[];
}

只返回 JSON。`;
}

/** 任务解析用户提示词 */
export function buildPlannerUserPrompt(params: {
  userInput: string;
  defaultPlatform: PlatformName;
  targetUrl?: string;
  hasImages: boolean;
  hasVideos: boolean;
}): string {
  const { userInput, defaultPlatform, targetUrl, hasImages, hasVideos } = params;
  return `用户任务: ${userInput}
默认平台(用户未明确指定时使用): ${defaultPlatform} (${PLATFORM_LABELS[defaultPlatform]})
是否提供了图片素材: ${hasImages ? '是' : '否'}
是否提供了视频素材: ${hasVideos ? '是' : '否'}
${targetUrl ? `目标页面URL: ${targetUrl}` : ''}

请解析为 TaskPlan JSON。`;
}

/** 内容生成系统提示词 */
export function buildContentSystemPrompt(settings: AppSettings): string {
  return `你是 MediaFlow Agent 的内容生成器，帮助用户为社交媒体平台生成发布内容。

规则：
1. 只输出一个 JSON 对象，不要输出解释或 Markdown 代码块标记。
2. 内容必须真实、积极、合规，不得包含违法、虚假宣传、夸大引流或诱导内容。
3. 默认文案风格: ${settings.contentTone}；默认评论风格: ${settings.commentStyle}。
4. 输出字段根据任务需要选择填写：
   - title: 标题（小红书/视频建议 20 字以内，吸引人但不标题党）
   - body: 正文
   - description: 视频描述（部分平台用）
   - hashtags: 话题数组，元素不带 # 号
   - comment: 评论内容（评论任务用）
5. 如果用户任务是评论，必须输出非空 comment 字段；不要只输出 title、body 或 description。

GeneratedContent 结构:
interface GeneratedContent {
  title?: string;
  body?: string;
  description?: string;
  hashtags?: string[];
  comment?: string;
}

只返回 JSON。`;
}

/** 内容生成用户提示词 */
export function buildContentUserPrompt(params: {
  platform: PlatformName;
  contentType?: string;
  topic?: string;
  tone?: string;
  length?: string;
  hashtags?: number | string[];
  commentStyle?: string;
  needComment: boolean;
}): string {
  const lines = [
    `平台: ${PLATFORM_LABELS[params.platform]}`,
    params.platform === 'sohu'
      ? '搜狐号图文：需输出 title（5-72字）、body（正文）、description（摘要，120字内）'
      : '',
    params.contentType ? `内容类型: ${params.contentType}` : '',
    params.topic ? `主题: ${params.topic}` : '',
    params.tone ? `语气: ${params.tone}` : '',
    params.length ? `篇幅要求: ${params.length}` : '',
    typeof params.hashtags === 'number'
      ? `话题数量: ${params.hashtags}`
      : Array.isArray(params.hashtags)
        ? `指定话题: ${params.hashtags.join(', ')}`
        : '',
    params.needComment && params.commentStyle ? `评论风格: ${params.commentStyle}` : '',
  ].filter(Boolean);
  return `请生成内容。\n${lines.join('\n')}\n${params.needComment ? '\n当前是评论任务，必须生成非空 comment 字段。' : ''}\n只返回 GeneratedContent JSON。`;
}
