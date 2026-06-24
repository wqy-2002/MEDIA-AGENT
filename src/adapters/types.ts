import type {
  ActionResult,
  AutomationDiagnostics,
  GeneratedContent,
  LoginStatus,
  MediaFile,
  PageContent,
  PlatformName,
  PublishResult,
  ResultEvidence,
  UploadResult,
} from '@/types';

/** 填写内容时的可选参数（平台扩展） */
export interface FillContentOptions {
  publishMode?: 'image_upload' | 'text_image';
  preferImageUpload?: boolean;
}

// 平台适配器接口（参见开发文档第 7.5 节）。
// 每个平台独立实现，运行在 Content Script 的 DOM 上下文中。
// LLM 不参与此层，所有 selector 与执行逻辑由开发者维护。

export interface PlatformAdapter {
  platform: PlatformName;

  /** 检测登录状态 */
  detectLoginStatus(): Promise<LoginStatus>;

  /** 打开/确认处于发布页（content script 内只能校验，实际跳转由 background 控制 tab） */
  ensurePublishPage(): Promise<ActionResult>;

  /** 上传媒体文件 */
  uploadMedia(files: MediaFile[]): Promise<UploadResult>;

  /** 填写内容（标题/正文/描述/话题） */
  fillContent(content: GeneratedContent, options?: FillContentOptions): Promise<ActionResult>;

  /** 提交发布 */
  submitPublish(): Promise<PublishResult>;

  /** 读取页面公开内容 */
  readPageContent(): Promise<PageContent>;

  /** 提交评论 */
  executeComment(comment: string): Promise<ActionResult>;

  /** 点赞 */
  executeLike(): Promise<ActionResult>;

  /** 收藏 */
  executeFavorite(): Promise<ActionResult>;

  /** 关注 */
  executeFollow(): Promise<ActionResult>;

  /** 采集结果证据（链接等；截图由 background 用 chrome.tabs.captureVisibleTab 完成） */
  captureResult(): Promise<ResultEvidence>;

  /** 可选：检测当前平台页面状态 */
  detectState?(): Promise<ActionResult>;

  /** 可选：采集当前平台 DOM 诊断 */
  getDiagnostics?(): Promise<AutomationDiagnostics>;

  /** 可选：运行平台级完整发布流程 */
  runPublishFlow?(content: GeneratedContent, files?: MediaFile[]): Promise<PublishResult>;

  /** 可选：运行平台级完整互动流程 */
  runEngagementFlow?(
    action: 'comment' | 'like' | 'favorite' | 'follow',
    args?: Record<string, unknown>,
  ): Promise<ActionResult>;
}

/** 平台的发布页与目标页 URL，供 background 打开 tab 使用 */
export interface PlatformUrls {
  publishUrl: string;
  homeUrl: string;
}

/**
 * Content Script 内部指令（Background → Content 的执行协议）。
 * 与 LLM 的 ActionName 白名单区分：白名单约束模型输出，
 * ContentCommand 是开发者维护的页面操作命令，二者解耦。
 */
export type ContentCommand =
  | 'check_login'
  | 'detect_state'
  | 'get_diagnostics'
  | 'ensure_publish_page'
  | 'upload_media'
  | 'fill_content'
  | 'submit_publish'
  | 'run_publish_flow'
  | 'run_engagement_flow'
  | 'read_page'
  | 'execute_comment'
  | 'execute_like'
  | 'execute_favorite'
  | 'execute_follow'
  | 'verify_result'
  | 'capture_result'
  | 'click_viewport_point'
  | 'scan_publish_button'
  | 'click_publish_button';
