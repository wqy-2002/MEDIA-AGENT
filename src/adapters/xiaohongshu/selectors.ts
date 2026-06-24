// 小红书页面选择器集合。
// 说明：平台 DOM 可能变化，选择器集中在此维护，便于排错与更新。
// 每个动作提供多个候选选择器，按优先级排列，提升健壮性。

export const XHS_URLS = {
  // 创作者中心发布页（带 source=official，与官方参考实现保持一致，进入后默认可点“上传图文”）
  publishUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  homeUrl: 'https://www.xiaohongshu.com',
  creatorHome: 'https://creator.xiaohongshu.com',
};

export const xhsSelectors = {
  // 未登录信号：登录页 URL 关键字 / 登录弹层 / 扫码登录
  loginWallFlags: [
    '.login-container',
    '.login-box',
    '.qrcode',
    '.qrcode-img',
    '[class*="qrcode"]',
    '[class*="login-modal"]',
  ],
  // 登录页 URL 关键字
  loginUrlKeywords: ['/login', 'customer/sso', 'sso/'],

  // 已登录信号（仅作辅助参考，不作为唯一判据）
  loggedInFlags: [
    '.user-info',
    '.avatar',
    '[class*="avatar"]',
    '.name.user-nickname',
    '.reds-avatar',
  ],

  // 发布 SPA 根容器：图文编辑、文字配图、最终表单在同一 URL 内切换，阶段检测应限定在此子树
  publishPageRoot: [
    '.publish-page',
    '.publish-page-content',
    '.microapp-container',
  ],

  // 发布页：上传组件容器（出现即表示发布页已加载完成，参考实现以此为就绪标志）
  uploadContentArea: [
    'div.upload-content',
    '.upload-content',
  ],

  // 发布页：图文 / 视频上传 tab（需要先点选图文）。
  // 参考实现使用 div.creator-tab 并按文本匹配“上传图文”。
  imageTextTab: [
    'div.creator-tab',
    '.creator-tab',
    '[class*="creator-tab"]',
    '.upload-content .tab',
  ],

  // 文件上传 input（通常隐藏，查找时不要求可见）。
  // 参考实现：首张图片用 .upload-input，后续用 input[type="file"]。
  fileInput: [
    '.upload-input',
    'input.upload-input',
    'input[type="file"]',
    '.upload-wrapper input[type="file"]',
  ],

  // 首张图片上传 input（参考实现首张专用选择器）
  firstUploadInput: [
    '.upload-input',
    'input.upload-input',
  ],

  // 图片预览项：用于判断图片是否上传完成（参考实现统计 .img-preview-area .pr 数量）
  imagePreview: [
    '.img-preview-area .pr',
    '.img-preview-area .img-container',
    '.img-preview-area [class*="img"]',
    '[class*="preview"] [class*="img-container"]',
  ],

  // 标题输入。参考实现使用 div.d-input input；勿用裸 input.d-text（会误匹配图片智能标题 overlay）
  titleInput: [
    'div.d-input input',
    '.d-input input',
    'input[placeholder*="标题"]',
    'input[placeholder*="填写标题"]',
    'input.d-text[placeholder*="标题"]',
    'input.d-text[placeholder*="填写标题"]',
    '.title-container input',
    '.title input',
    'textarea[placeholder*="标题"]',
  ],

  // 文字配图草稿编辑器（出现「生成图片/写文字」时使用，勿与最终正文混淆）
  textImageDraftEditor: [
    '.tiptap.ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ],

  // 最终发布表单正文编辑器（需配合严格 predicate，排除图片编辑 overlay）
  finalBodyEditor: [
    'div.ql-editor',
    '.ql-editor',
    '.tiptap.ProseMirror',
    '.ProseMirror[role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    '[data-placeholder*="输入正文描述"]',
    '.edit-container [contenteditable="true"]',
    '.content-input [contenteditable="true"]',
    '#post-textarea',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="输入正文"]',
  ],

  // 正文编辑器（兼容别名，填写流程优先使用 finalBodyEditor / textImageDraftEditor）
  bodyEditor: [
    'div.ql-editor',
    '.ql-editor',
    '[data-placeholder*="输入正文描述"]',
    '.tiptap.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    '.content-input [contenteditable="true"]',
    '#post-textarea',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="输入正文"]',
  ],

  // 文字配图阶段按钮信号
  textImageGenerateButton: [
    'button',
    'div[role="button"]',
    '.d-button',
  ],

  // 新版发布按钮 Host（closed shadow DOM，Content Script 无法 querySelector 内部，仅操作 Host）
  publishButtonNew: [
    'xhs-publish-btn[is-publish="true"]',
    'xhs-publish-btn',
  ],

  // 发布按钮 Host 专用选择器（限定 publish-page 子树，顺序优先）
  publishButtonHost: [
    '.publish-page-publish-btn xhs-publish-btn',
    '.publish-page xhs-publish-btn',
  ],

  // 旧版发布按钮（红色主按钮，依赖 .publish-page-publish-btn 容器）
  publishButtonOld: [
    '.publish-page-publish-btn button.bg-red',
    '.publish-page-publish-btn button',
  ],

  // 2026 改版发布按钮（去掉外层 .publish-page-publish-btn，需文本「发布」二次过滤）
  publishButtonCe2026: [
    '.publish-page button.ce-btn.bg-red',
    'button.ce-btn.bg-red',
  ],

  // 文本兜底：按「发布 / 立即发布」匹配，需二次过滤排除定时发布等
  publishButtonTextFallback: [
    'button',
    '[role="button"]',
    '[class*="btn"]',
    '[class*="button"]',
    '[class*="publish"]',
    '[class*="submit"]',
    '[class*="red"]',
    'xhs-publish-btn',
  ],

  // 发布按钮（优先文本匹配「发布」，此处作为补充）
  submitButton: [
    '.publish-page-publish-btn button.bg-red',
    '.publish-page-publish-btn button',
    'button.publishBtn',
    '.submit button',
    'button[class*="publish"]',
    '.el-button--primary',
    '.d-button-content',
  ],

  // 发布页内部滚动容器（发布按钮常在底部，需滚动这些容器而非仅 window）
  publishScrollContainers: [
    '.microapp-container',
    '.publish-page',
    '.publish-page-content',
    "[class*='microapp']",
    "[class*='publish']",
    'main',
    'body',
    'html',
  ],

  // 标题超长提示（出现即表示标题超过平台上限，参考实现据此报错）
  titleLengthError: [
    'div.title-container div.max_suffix',
    '.title-container .max_suffix',
  ],

  // 正文超长提示
  contentLengthError: [
    'div.edit-container div.length-error',
    '.edit-container .length-error',
  ],

  // 话题联想下拉项（输入 # + 关键词后弹出，点击第一个即可绑定话题）
  topicSuggestion: [
    '#creator-editor-topic-container .item',
    '.topic-container .item',
    '[class*="topic"] [class*="item"]',
  ],

  // 弹窗遮罩：点击 tab 前可能存在的引导/提示遮罩，需移除后再操作
  popCover: [
    'div.d-popover',
    '.d-popover',
  ],

  // 发布成功标志
  publishSuccessFlags: [
    '.success-container',
    '[class*="publish-success"]',
    '.publish-success',
    '[class*="success"]',
  ],

  // 笔记详情页：评论框
  commentInput: [
    '.interaction-container .content-input',
    '.note-container .content-input',
    '.comment-input[contenteditable="true"]',
    '.content-edit [contenteditable="true"]',
    '.comment-input [contenteditable="true"]',
    'div.content-input',
    'p.content-input',
    'textarea[placeholder*="评论"]',
    '[role="textbox"][placeholder*="评论"]',
  ],
  commentSubmit: [
    '.btn.submit',
    'button.submit',
    'button[class*="submit"]',
    '.submit',
  ],

  // 点赞 / 收藏 / 关注
  likeButton: [
    '.like-wrapper',
    '.like-active-icon',
    'span[class*="like"]',
    '.interact-container .like',
    '[class*="like-wrapper"]',
  ],
  favoriteButton: [
    '.collect-wrapper',
    '.collect-active-icon',
    'span[class*="collect"]',
    '[class*="collect-wrapper"]',
  ],
  followButton: [
    '.follow-button',
    'button.follow',
    '[class*="follow"] button',
    '.reds-button',
  ],
};
