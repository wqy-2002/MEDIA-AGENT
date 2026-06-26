# MediaFlow Agent

> 独立运行的 Chrome 浏览器 AI Agent 插件。用户在侧边栏输入自然语言任务，插件调用大模型解析任务、生成内容，并在小红书、抖音、微信视频号、微信公众号等平台自动完成发布、评论、点赞、收藏、关注等操作。

本项目按 `MediaFlow_Agent.md` 开发文档实现 MVP，优先打通插件架构与小红书完整闭环。

## 技术栈

- [WXT](https://wxt.dev) + Chrome Extension Manifest V3
- TypeScript + React + Tailwind CSS
- Zustand（状态管理）+ Zod（模型输出/消息校验）
- Dexie / IndexedDB（任务记录、日志、草稿、素材）
- chrome.storage.local（设置、API Key、开关）
- DeepSeek / OpenAI 兼容 API
- Vitest（单元测试）

## 目录结构

```text
src/
├─ entrypoints/        # 插件入口
│  ├─ background.ts     # 任务中枢 Service Worker
│  ├─ content.ts        # 页面执行层 Content Script
│  ├─ sidepanel/        # 侧边栏（主操作台）
│  └─ options/          # 设置页
├─ core/               # 核心模块
│  ├─ task-manager/     # 任务调度
│  ├─ executor/         # 计划执行 + 策略守卫 + tab 管理
│  ├─ planner/          # LLM 任务解析与内容生成
│  ├─ model/            # 模型服务（OpenAI 兼容）
│  ├─ storage/          # IndexedDB(Dexie) + chrome.storage
│  ├─ messaging/        # 消息通信
│  └─ logger/           # 日志
├─ adapters/           # 平台适配器（小红书/抖音/视频号/公众号）
├─ schemas/            # Zod schemas
├─ prompts/            # Prompt 模板
├─ components/         # React 组件
├─ stores/             # Zustand store
├─ utils/              # 工具
└─ types/              # 类型定义
```

## 开发与构建

```bash
# 安装依赖
npm install

# 开发模式（自动打开带插件的 Chrome）
npm run dev

# 生产构建（产物在 .output/chrome-mv3）
npm run build

# 打包 zip
npm run zip

# 类型检查
npm run compile

# 单元测试
npm run test
```

## 安装到 Chrome

1. 执行 `npm run build`。
2. 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录。
4. 点击工具栏的 MediaFlow Agent 图标打开侧边栏（Side Panel，非设置页）。
5. 首次使用 AI 模式需先到「设置」页填写模型 API Key，并点击「测试连接」；**手动发布无需 API Key**。

修改源码后须重新构建并在 `chrome://extensions` 点击「重新加载」，否则侧边栏可能仍是旧界面。

## 使用流程

### AI 生成（默认）

1. 在侧边栏「执行」Tab 选择 **AI 生成**，选择平台、输入自然语言任务（可上传图片/视频素材）。
2. 点击「执行任务」，插件调用大模型解析为结构化执行计划（TaskPlan，经 Zod 校验）。
3. 插件打开目标平台页面并执行受约束的页面操作。
4. 遇到未登录 / 验证码 / 安全验证时会暂停，提示你手动处理后点击「继续」。
5. 任务记录、日志、生成内容与截图保存在本地，可在「历史」查看。

### 手动发布（自备文案）

入口：**Side Panel → 执行 Tab → 发布方式 → 手动发布**（不在设置页）。

1. 切换到「手动发布」，填写标题（选填，≤20 字）、正文（与标题至少一项，≤1000 字）、话题（选填，最多 10 个）。
2. 选择平台（小红书 / 搜狐号），可选上传素材。
3. 点击「手动发布」——跳过 LLM 解析与内容生成，直接使用你的文案走发布自动化。
4. 需在设置页开启「自动发布」；发布频率限制与 AI 模式相同。

## 安全与隐私底线

- 必须用户主动输入任务后才执行；自动发布/评论/点赞等默认关闭。
- 不保存平台账号密码，不读取 Cookie，不读取私信与支付信息。
- 不绕过验证码、扫码登录与平台风控。
- 高频评论、点赞、关注有单日上限限制。
- LLM 只能输出结构化 TaskPlan，不能直接控制网页或生成 DOM 选择器。

## 故障排查

- 发布失败且 URL 停在 `note-manager`、日志出现 `success` 循环：多为 tab 仍在笔记管理列表页而非发布编辑页；重载扩展后重试，或手动打开创作者中心「发布笔记」再执行。
- 日志「文字配图草稿未写入成功」但诊断里编辑器已有长文：多为防风控逐字输入与校验不兼容（已修复：输入前清空占位、校验忽略换行与「写文字」前缀）；请重载最新扩展后重试。

## 说明

平台页面 DOM 可能随时变化，各平台选择器集中维护在 `src/adapters/<platform>/selectors.ts`，
若某平台自动化失效，多数情况下只需更新对应选择器即可。
