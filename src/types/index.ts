// 全局类型定义
// 说明：本文件汇总插件中跨模块使用的核心类型，保持单一来源，避免重复定义。

/** 支持的平台名称 */
export type PlatformName =
  | 'xiaohongshu'
  | 'sohu';

/** 任务类型 */
export type TaskType = 'publish' | 'comment' | 'like' | 'favorite' | 'follow';

/** 内容类型 */
export type ContentType = 'note' | 'video' | 'article';

/** Action 白名单（参见开发文档第 10 节）。模型不能生成此列表之外的动作 */
export type ActionName =
  | 'check_login'
  | 'generate_content'
  | 'open_publish_page'
  | 'open_target_page'
  | 'upload_media'
  | 'fill_title'
  | 'fill_body'
  | 'fill_description'
  | 'fill_hashtags'
  | 'fill_comment'
  | 'submit_publish'
  | 'submit_comment'
  | 'execute_like'
  | 'execute_favorite'
  | 'execute_follow'
  | 'verify_result'
  | 'take_screenshot'
  | 'save_record'
  | 'pause_for_login'
  | 'pause_for_verification';

/** 任务状态机（参见开发文档第 11 节） */
export type TaskStatus =
  | 'created'
  | 'parsing'
  | 'planning'
  | 'checking_login'
  | 'waiting_login'
  | 'waiting_verification'
  | 'generating_content'
  | 'opening_page'
  | 'uploading_media'
  | 'filling_content'
  | 'submitting'
  | 'verifying_result'
  | 'success'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'retrying';

/** 关键错误码（参见开发文档第 17 节） */
export type ErrorCode =
  | 'MODEL_API_KEY_MISSING'
  | 'MODEL_REQUEST_FAILED'
  | 'TASK_PARSE_FAILED'
  | 'PLATFORM_LOGIN_REQUIRED'
  | 'CAPTCHA_REQUIRED'
  | 'PLATFORM_PAGE_CHANGED'
  | 'INPUT_FIELD_NOT_FOUND'
  | 'BUTTON_NOT_FOUND'
  | 'BUTTON_DISABLED'
  | 'FORM_NOT_READY'
  | 'UPLOAD_NOT_FINISHED'
  | 'BLOCKED_BY_DIALOG'
  | 'LOGIN_REQUIRED'
  | 'VERIFY_REQUIRED'
  | 'CLICKED_BUT_NOT_PUBLISHED'
  | 'FRAME_MESSAGE_FAILED'
  | 'MEDIA_UPLOAD_FAILED'
  | 'MEDIA_FORMAT_UNSUPPORTED'
  | 'SUBMIT_FAILED'
  | 'SUBMIT_UNKNOWN'
  | 'RESULT_VERIFY_FAILED'
  | 'RATE_LIMITED'
  | 'USER_CANCELLED'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_PLATFORM';

/** 任务需求（由模型从自然语言中解析） */
export interface TaskRequirements {
  topic?: string;
  tone?: string;
  length?: string;
  hashtags?: number | string[];
  commentStyle?: string;
}

/** 素材引用（IndexedDB 中素材的 id 列表，或临时 URL） */
export interface TaskMaterials {
  images?: string[];
  videos?: string[];
}

/** 内容来源：AI 生成或用户自备 */
export type ContentSource = 'ai' | 'manual';

/** 模型输出的结构化任务计划（参见开发文档第 9 节） */
export interface TaskPlan {
  taskType: TaskType;
  platform: PlatformName;
  contentType?: ContentType;
  requirements?: TaskRequirements;
  materials?: TaskMaterials;
  targetUrl?: string;
  /** 任务内容来源，便于历史记录区分 */
  contentSource?: ContentSource;
  actions: ActionName[];
}

/** 模型生成的可发布内容 */
export interface GeneratedContent {
  title?: string;
  body?: string;
  description?: string;
  hashtags?: string[];
  comment?: string;
}

/** 登录状态 */
export interface LoginStatus {
  platform: PlatformName;
  loggedIn: boolean;
  needVerification?: boolean;
  message?: string;
  verificationMatch?: string;
  loginWall?: boolean;
  onBackend?: boolean;
  url?: string;
}

/** 素材文件（在内存中传递时使用 base64 dataUrl，落库时存索引） */
export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  /** base64 data url，仅在传递时使用 */
  dataUrl?: string;
  size?: number;
}

/** 上传结果 */
export interface UploadResult {
  success: boolean;
  uploadedCount: number;
  errorCode?: ErrorCode;
  message?: string;
}

/** 发布结果 */
export interface PublishResult {
  success: boolean;
  resultUrl?: string;
  errorCode?: ErrorCode;
  message?: string;
}

/** 通用动作执行结果 */
export interface ActionResult {
  success: boolean;
  action?: ActionName;
  data?: unknown;
  errorCode?: ErrorCode;
  message?: string;
  diagnostics?: AutomationDiagnostics;
}

/** DOM 候选元素诊断信息 */
export interface ElementCandidate {
  tag: string;
  selector?: string;
  id?: string;
  className?: string;
  role?: string;
  text?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  visible?: boolean;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** 页面自动化诊断信息 */
export interface AutomationDiagnostics {
  state: string;
  url: string;
  title?: string;
  candidates: {
    inputs: ElementCandidate[];
    editables: ElementCandidate[];
    buttons: ElementCandidate[];
    scrollContainers: ElementCandidate[];
    dialogs: ElementCandidate[];
    toasts: ElementCandidate[];
  };
  blockers: string[];
  activeElement?: ElementCandidate;
  rawText?: string;
  capturedAt: number;
}

/** 页面公开内容 */
export interface PageContent {
  title?: string;
  text?: string;
  url: string;
}

/** 结果证据（截图、链接等） */
export interface ResultEvidence {
  screenshot?: string;
  resultUrl?: string;
  capturedAt: number;
}

/** 模型配置 */
export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 任务记录（落 IndexedDB，参见开发文档第 12.2 节） */
export interface TaskRecord {
  id: string;
  taskType: TaskType;
  platform: PlatformName;
  userInput: string;
  plan?: TaskPlan;
  generatedContent?: GeneratedContent;
  targetUrl?: string;
  resultUrl?: string;
  screenshot?: string;
  status: TaskStatus;
  errorCode?: ErrorCode;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
  retryCount: number;
}

/** 执行日志条目 */
export interface LogEntry {
  id?: number;
  taskId: string;
  status?: TaskStatus;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
  createdAt: number;
}

/** AI 生成草稿（落库） */
export interface DraftRecord {
  id: string;
  taskId: string;
  platform: PlatformName;
  content: GeneratedContent;
  createdAt: number;
}

/** 素材索引（落库） */
export interface MaterialRecord {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  createdAt: number;
}

/** 文本填入安全等级 */
export type TypingSafetyLevel = 'fast' | 'balanced' | 'safe' | 'ultra_safe';

/** 文本输入模式 */
export type TypingMode = 'chunked' | 'char';

/** 小红书发布防风控节奏配置 */
export interface PublishPacingConfig {
  enabled: boolean;
  /** Executor 大步骤间最小/最大停顿（毫秒） */
  stepGapMinMs: number;
  stepGapMaxMs: number;
  /** 状态机步间最小/最大停顿 */
  stateTransitionMinMs: number;
  stateTransitionMaxMs: number;
  /** 点击与字段切换间停顿 */
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  /** 分块输入块长与块间停顿 */
  chunkMinChars: number;
  chunkMaxChars: number;
  chunkDelayMinMs: number;
  chunkDelayMaxMs: number;
  /** 点击发布前审阅停顿 */
  preSubmitMinMs: number;
  preSubmitMaxMs: number;
  /** 逐张图片上传间隔 */
  imageUploadGapMinMs: number;
  imageUploadGapMaxMs: number;
  /** 文本填入安全等级预设 */
  typingSafetyLevel: TypingSafetyLevel;
  /** 文本输入模式：分块或逐字 */
  typingMode: TypingMode;
  /** 逐字输入每字延时 */
  charDelayMinMs: number;
  charDelayMaxMs: number;
  /** 标题/正文/标签字段切换间停顿 */
  fieldGapMinMs: number;
  fieldGapMaxMs: number;
  /** 思考停顿：每隔多少字触发一次（最小/最大间隔字数） */
  thinkingPauseEveryMinChars: number;
  thinkingPauseEveryMaxChars: number;
  /** 思考停顿时长 */
  thinkingPauseMinMs: number;
  thinkingPauseMaxMs: number;
}

/** 用户设置（落 chrome.storage.local） */
export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultPlatform: PlatformName;
  contentTone: string;
  commentStyle: string;
  automation: {
    autoPublish: boolean;
    autoComment: boolean;
    autoLike: boolean;
    autoFavorite: boolean;
    autoFollow: boolean;
  };
  rateLimit: {
    /** 单日评论上限 */
    maxCommentsPerDay: number;
    /** 单日互动（点赞/收藏/关注）上限 */
    maxEngagementsPerDay: number;
    /** 连续失败上限，超过则暂停 */
    maxConsecutiveFailures: number;
    /** 单日发布上限 */
    maxPublishesPerDay: number;
    /** 两次成功发布最短间隔（分钟） */
    minMinutesBetweenPublishes: number;
  };
  /** 小红书发布节奏（防风控） */
  publishPacing: PublishPacingConfig;
  platformSwitch: Record<PlatformName, boolean>;
}
