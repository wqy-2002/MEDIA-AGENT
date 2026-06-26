# MediaFlow Agent

> 用途：用于 Cursor / Claude Code / Windsurf / Vibe Coding 的核心上下文  
> 目标：压缩 PRD + MVP 技术架构，只保留首轮编码必须知道的信息  
> 产品阶段：MVP  
> 产品形态：独立 Chrome 浏览器 AI Agent 插件

---

## 1. 项目一句话

MediaFlow Agent 是一个独立运行的 Chrome 浏览器 AI Agent 插件。用户点击插件图标打开侧边栏，输入自然语言任务，插件调用大模型解析任务、生成内容，并自动控制浏览器在小红书、抖音、微信视频号、微信公众号等平台完成发布、评论、点赞、收藏、关注等操作。

---

## 2. MVP 核心目标

MVP 只验证一个核心闭环：

```text
打开侧边栏
→ 用户输入任务 / 上传素材
→ 大模型解析任务
→ 生成结构化执行计划
→ 插件自动打开目标平台
→ 自动上传 / 填写 / 点击 / 提交
→ 保存执行日志和结果
```

MVP 不做完整商业化系统，不做后端用户体系，不做订阅，不做团队协作，不做云端任务管理。

---

## 3. 产品边界

### 3.1 要做

- Chrome 插件独立运行。
- 点击插件图标打开 Side Panel。
- 用户可配置 DeepSeek / OpenAI-Compatible API Key。
- 用户在侧边栏输入自然语言任务。
- 大模型解析任务并生成结构化 JSON。
- 自动生成标题、正文、话题、评论。
- 自动打开目标平台页面。
- 自动检测登录状态。
- 自动执行上传、填写、点击发布、评论、点赞、收藏、关注。
- 本地保存任务记录、执行日志、结果截图、错误信息。
- 遇到登录、扫码、验证码、风控时暂停等待用户处理。

### 3.2 不做

- 不保存平台账号密码。
- 不读取或上传 Cookie。
- 不绕过验证码、扫码登录、短信验证、平台风控。
- 不做无任务后台静默执行。
- 不做刷量、刷赞、刷粉、规避封号功能。
- 不采集私信、支付信息、验证码、通讯录等敏感信息。
- MVP 不做云端用户系统和订阅系统。

---

## 4. MVP 首期支持平台

P0 支持：

1. 小红书：图文 / 视频发布，评论，点赞，收藏，关注。
2. 抖音：视频发布，评论，点赞，关注。
3. 微信视频号：视频发布。
4. 微信公众号：自动创建图文草稿，保存草稿。

建议开发顺序：

```text
先小红书完整闭环
→ 再抖音视频发布
→ 再微信视频号
→ 最后微信公众号草稿
```

---

## 5. 推荐技术栈

```text
WXT
+ Chrome Extension Manifest V3
+ TypeScript
+ React
+ Tailwind CSS
+ Zustand
+ Zod
+ Dexie / IndexedDB
+ chrome.storage.local
+ chrome.runtime messaging
+ chrome.scripting
+ DeepSeek API
+ OpenAI-Compatible API
+ Vitest
+ Playwright
```

### 说明

- WXT：插件工程框架。
- React：实现 Side Panel、Options、Popup。
- Zustand：管理侧边栏和任务状态。
- Zod：校验模型输出 JSON 和消息 payload。
- Dexie / IndexedDB：保存任务记录、日志、草稿、素材索引。
- chrome.storage.local：保存设置、API Key、平台开关。
- Content Script：执行页面读取、填写、点击、上传。
- Background Service Worker：任务调度中枢。
- Platform Adapter：封装各平台页面自动化逻辑。

---

## 6. MVP 系统架构

```text
User
  ↓
Side Panel
  ↓ TASK_CREATE
Background Service Worker
  ↓
Model Service
  ↓
Task Planner
  ↓
Task Executor
  ↓
Platform Adapter
  ↓
Content Script
  ↓
Target Platform Page
  ↓
Execution Result
  ↓
IndexedDB / chrome.storage.local
  ↓
Side Panel
```

---

## 7. 核心模块职责

### 7.1 Side Panel

主操作台（点击工具栏图标打开，非 Options 设置页）。

职责：

- **发布方式切换**：AI 生成（自然语言任务）或 **手动发布**（用户自备标题/正文/话题）。
- 输入自然语言任务，或填写手动发布表单。
- 上传图片 / 视频素材。
- 展示模型状态。
- 展示平台登录状态。
- 展示执行计划。
- 展示实时日志。
- 展示执行结果。
- 查看历史任务记录。
- 跳转设置页。
- 显示扩展版本号，便于确认是否加载最新构建。

**手动发布**：在「执行」Tab 顶部「发布方式」选择「手动发布」，无需 API Key；标题≤20 字、正文≤1000 字、话题≤10 个。修改源码后须 `npm run build` 并重载扩展，否则可能看不到新入口。

### 7.2 Options Page

设置页。

职责：

- 配置 DeepSeek API Key。
- 配置 OpenAI-Compatible Base URL。
- 配置默认模型名称。
- 设置默认平台、文案风格、评论风格。
- 开关自动发布、自动评论、点赞、收藏、关注。
- 设置单日评论数和互动数限制。
- 清除本地数据。
- 展示权限和隐私说明。

### 7.3 Background Service Worker

任务中枢。

职责：

- 接收 Side Panel 创建的任务。
- 调用大模型。
- 生成结构化任务计划。
- 管理 tabs。
- 分发任务给 Platform Adapter。
- 向页面注入 / 调用 Content Script。
- 接收页面执行结果。
- 更新任务状态。
- 保存日志。
- 处理暂停、恢复、重试、取消。

注意：MV3 Service Worker 可能被回收，关键状态必须写入 IndexedDB 或 chrome.storage。

### 7.4 Content Script

页面执行层。

职责：

- 读取页面公开内容。
- 检测是否登录。
- 定位输入框。
- 填写标题、正文、描述、评论。
- 上传图片或视频。
- 点击发布、评论、点赞、收藏、关注按钮。
- 检测上传进度。
- 检测执行结果。
- 返回截图、链接、错误信息。

### 7.5 Platform Adapter

平台适配层。每个平台独立维护，不要混写。

建议目录：

```text
adapters/
├─ xiaohongshu/
│  ├─ selectors.ts
│  ├─ login.ts
│  ├─ publish.ts
│  ├─ comment.ts
│  └─ engagement.ts
├─ douyin/
├─ wechat-channel/
└─ wechat-official/
```

统一接口：

```ts
export interface PlatformAdapter {
  platform: PlatformName

  detectLoginStatus(): Promise<LoginStatus>

  openPublishPage(task: PublishTask): Promise<void>

  uploadMedia(files: MediaFile[]): Promise<UploadResult>

  fillContent(content: GeneratedContent): Promise<void>

  submitPublish(): Promise<PublishResult>

  openTargetPage(url: string): Promise<void>

  readPageContent(): Promise<PageContent>

  executeComment(comment: string): Promise<ActionResult>

  executeLike(): Promise<ActionResult>

  executeFavorite(): Promise<ActionResult>

  executeFollow(): Promise<ActionResult>

  captureResult(): Promise<ResultEvidence>
}
```

---

## 8. Agent 设计原则

本项目使用“受约束 Agent”，不要让模型自由控制浏览器。

### 原则

- LLM 只负责理解任务和生成内容。
- LLM 不直接输出 JavaScript。
- LLM 不直接输出任意 DOM selector。
- LLM 不直接读 Cookie。
- LLM 输出必须是结构化 JSON。
- JSON 必须经过 Zod 校验。
- 真实执行由 Task Executor + Platform Adapter 完成。

执行链路：

```text
用户自然语言
→ Intent Parser
→ Task Planner
→ Content Generator
→ Policy Guard
→ Task Executor
→ Result Verifier
→ Task Logger
```

---

## 9. TaskPlan 结构

模型输出建议格式：

```ts
type TaskType = 'publish' | 'comment' | 'like' | 'favorite' | 'follow'

type PlatformName =
  | 'xiaohongshu'
  | 'douyin'
  | 'wechat_channel'
  | 'wechat_official'

interface TaskPlan {
  taskType: TaskType
  platform: PlatformName
  contentType?: 'note' | 'video' | 'article'
  requirements?: {
    topic?: string
    tone?: string
    length?: string
    hashtags?: number | string[]
    commentStyle?: string
  }
  materials?: {
    images?: string[]
    videos?: string[]
  }
  targetUrl?: string
  actions: ActionName[]
}
```

Zod 校验必须做，非法计划不能执行。

---

## 10. Action 白名单

MVP 只允许以下动作：

```text
check_login
generate_content
open_publish_page
open_target_page
upload_media
fill_title
fill_body
fill_description
fill_hashtags
fill_comment
submit_publish
submit_comment
execute_like
execute_favorite
execute_follow
verify_result
take_screenshot
save_record
pause_for_login
pause_for_verification
```

禁止：

- 任意 JS 执行。
- 任意 DOM selector 由模型生成。
- 任意 Cookie 读取。
- 任意验证码绕过。
- 任意本地路径读取。
- 任意用户未授权后台任务。

---

## 11. 任务状态机

任务状态必须状态机化：

```ts
type TaskStatus =
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
  | 'retrying'
```

每一步都要写入日志，便于恢复、排错和展示进度。

---

## 12. 本地存储设计

### 12.1 存储位置

```text
chrome.storage.local:
- API Key
- Base URL
- 默认模型
- 平台开关
- 自动化开关
- 用户偏好
- 频率限制配置

IndexedDB:
- 任务记录
- 执行日志
- AI 生成草稿
- 素材索引
- 截图记录
```

### 12.2 TaskRecord

```ts
interface TaskRecord {
  id: string
  taskType: 'publish' | 'comment' | 'like' | 'favorite' | 'follow'
  platform: 'xiaohongshu' | 'douyin' | 'wechat_channel' | 'wechat_official'
  userInput: string
  plan: unknown
  generatedContent?: unknown
  targetUrl?: string
  resultUrl?: string
  screenshot?: string
  status: TaskStatus
  errorCode?: string
  errorMessage?: string
  startedAt: number
  finishedAt?: number
  retryCount: number
}
```

---

## 13. 消息通信设计

### 13.1 消息流

```text
Side Panel
  → TASK_CREATE
Background
  → CONTENT_EXECUTE_ACTION
Content Script
  → CONTENT_ACTION_RESULT
Background
  → TASK_STATUS_UPDATE
Side Panel
```

### 13.2 Message 类型

```ts
type ExtensionMessage =
  | { type: 'TASK_CREATE'; payload: CreateTaskPayload }
  | { type: 'TASK_STATUS_UPDATE'; payload: TaskStatusPayload }
  | { type: 'TASK_CANCEL'; payload: { taskId: string } }
  | { type: 'TASK_RETRY'; payload: { taskId: string } }
  | { type: 'MODEL_TEST'; payload: ModelConfig }
  | { type: 'PLATFORM_CHECK_LOGIN'; payload: { platform: string } }
  | { type: 'CONTENT_EXECUTE_ACTION'; payload: ExecuteActionPayload }
  | { type: 'CONTENT_ACTION_RESULT'; payload: ActionResult }
```

原则：

- Background 是任务中枢。
- Side Panel 不直接操作页面。
- Content Script 不直接调用模型。
- 所有 payload 要有类型定义。
- 关键 payload 用 Zod 校验。

---

## 14. Manifest 权限建议

```json
{
  "permissions": [
    "storage",
    "tabs",
    "activeTab",
    "scripting",
    "sidePanel",
    "notifications",
    "alarms"
  ],
  "host_permissions": [
    "*://*.xiaohongshu.com/*",
    "*://*.douyin.com/*",
    "*://mp.weixin.qq.com/*",
    "*://channels.weixin.qq.com/*"
  ]
}
```

权限原则：

- 只申请 MVP 必需权限。
- 只对支持平台注入脚本。
- 不读取密码。
- 不读取 Cookie。
- 不读取私信和支付页面。
- 设置页必须解释权限用途。

---

## 15. 推荐目录结构

```text
mediaflow-agent/
├─ package.json
├─ wxt.config.ts
├─ tsconfig.json
├─ .env.example
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts
│  │  ├─ content.ts
│  │  ├─ sidepanel/
│  │  │  ├─ App.tsx
│  │  │  └─ main.tsx
│  │  ├─ popup/
│  │  └─ options/
│  ├─ core/
│  │  ├─ task-manager/
│  │  ├─ executor/
│  │  ├─ planner/
│  │  ├─ model/
│  │  ├─ storage/
│  │  ├─ messaging/
│  │  └─ logger/
│  ├─ adapters/
│  │  ├─ xiaohongshu/
│  │  ├─ douyin/
│  │  ├─ wechat-channel/
│  │  └─ wechat-official/
│  ├─ schemas/
│  ├─ prompts/
│  ├─ components/
│  ├─ hooks/
│  ├─ stores/
│  ├─ utils/
│  └─ types/
├─ tests/
│  ├─ unit/
│  ├─ e2e/
│  └─ fixtures/
└─ docs/
```

---

## 16. 首轮开发顺序

### Phase 1：插件基础

- 初始化 WXT + React + TypeScript。
- 实现点击插件图标打开 Side Panel。
- 实现 Options 设置页。
- 实现 API Key 配置。
- 实现模型连接测试。
- 实现任务输入框。
- 实现任务记录 IndexedDB。
- 实现任务状态机和日志展示。

### Phase 2：LLM 任务解析

- 写 Prompt。
- 调 DeepSeek / OpenAI-Compatible。
- 输出 TaskPlan JSON。
- 用 Zod 校验。
- 校验失败重试。
- 展示执行计划。

### Phase 3：小红书完整闭环

- 登录检测。
- 打开发布页。
- 上传图片。
- 填写标题。
- 填写正文。
- 添加话题。
- 点击发布。
- 验证结果。
- 评论 / 点赞 / 收藏 / 关注。
- 保存截图和日志。

### Phase 4：抖音 / 视频号

- 上传视频。
- 检测上传进度。
- 填写标题 / 描述 / 话题。
- 设置封面。
- 点击发布。
- 验证结果。

### Phase 5：公众号草稿

- 打开公众号后台。
- 创建图文草稿。
- 填写标题和正文。
- 填写摘要。
- 上传封面。
- 保存草稿。

---

## 17. 关键错误码

```text
MODEL_API_KEY_MISSING
MODEL_REQUEST_FAILED
TASK_PARSE_FAILED
PLATFORM_LOGIN_REQUIRED
CAPTCHA_REQUIRED
PLATFORM_PAGE_CHANGED
INPUT_FIELD_NOT_FOUND
BUTTON_NOT_FOUND
MEDIA_UPLOAD_FAILED
MEDIA_FORMAT_UNSUPPORTED
SUBMIT_FAILED
RESULT_VERIFY_FAILED
RATE_LIMITED
USER_CANCELLED
PERMISSION_DENIED
UNSUPPORTED_PLATFORM
```

---

## 18. 安全和风控底线

必须遵守：

- 用户必须主动输入任务后才执行。
- 未登录时暂停，引导用户去官方页面登录。
- 遇到验证码、扫码、安全验证必须暂停。
- 不保存账号密码。
- 不读取 Cookie。
- 不绕过验证。
- 高频评论、点赞、关注必须限制。
- 失败次数过多必须暂停。
- 重复评论内容要拦截。
- 所有自动发布 / 评论 / 关注动作应该有可配置开关。

---

## 19. MVP 验收标准

MVP 最小可验收标准：

- 插件可安装运行。
- 点击图标可打开 Side Panel。
- 可配置模型 API Key。
- 可输入任务并解析为 TaskPlan。
- 可保存任务记录和执行日志。
- 可打通小红书发布完整流程。
- 可完成小红书评论、点赞、收藏、关注。
- 可打通至少一个视频平台发布流程。
- 未登录 / 验证码 / 页面变化 / 上传失败时有明确错误提示。
- 不保存密码，不读取 Cookie，不绕过验证。

---

## 20. 给 Vibe Coding 的总指令

请基于本文件开发 MediaFlow Agent MVP。优先实现插件架构和小红书完整闭环。所有代码必须遵循以下规则：

1. 使用 WXT + React + TypeScript。
2. 使用 Manifest V3。
3. Side Panel 是主入口。
4. Background 是任务中枢。
5. Content Script 只负责页面执行。
6. 平台逻辑必须通过 Platform Adapter 封装。
7. LLM 只能输出结构化 TaskPlan，不允许直接控制网页。
8. 所有模型输出必须用 Zod 校验。
9. 任务必须状态机化。
10. 所有关键步骤必须写日志。
11. 不保存平台账号密码。
12. 不读取 Cookie。
13. 不绕过验证码和平台风控。
14. MVP 先打通小红书，再扩展抖音、视频号和公众号。
