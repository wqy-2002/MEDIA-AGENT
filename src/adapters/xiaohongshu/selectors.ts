export const XHS_URLS = {
  publishUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
  homeUrl: 'https://www.xiaohongshu.com',
  creatorHome: 'https://creator.xiaohongshu.com',
};

export const xhsSelectors = {
  loginWallFlags: [
    '.login-container',
    '.login-box',
    '.qrcode',
    '.qrcode-img',
    '[class*="qrcode"]',
    '[class*="login-modal"]',
  ],
  loginUrlKeywords: ['/login', 'customer/sso', 'sso/'],

  loggedInFlags: [
    '.user-info',
    '.avatar',
    '[class*="avatar"]',
    '.name.user-nickname',
    '.reds-avatar',
  ],

  // 图文编辑、文字配图、最终表单在同一 URL 内切换，阶段检测应限定在此子树
  publishPageRoot: [
    '.publish-page',
    '.publish-page-content',
    '.microapp-container',
  ],

  uploadContentArea: [
    'div.upload-content',
    '.upload-content',
  ],

  imageTextTab: [
    'div.creator-tab',
    '.creator-tab',
    '[class*="creator-tab"]',
    '.upload-content .tab',
  ],

  fileInput: [
    '.upload-input',
    'input.upload-input',
    'input[type="file"]',
    '.upload-wrapper input[type="file"]',
  ],

  firstUploadInput: [
    '.upload-input',
    'input.upload-input',
  ],

  imagePreview: [
    '.img-preview-area .pr',
    '.img-preview-area .img-container',
    '.img-preview-area [class*="img"]',
    '[class*="preview"] [class*="img-container"]',
  ],

  // 勿用裸 input.d-text，会误匹配图片智能标题 overlay
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

  textImageDraftEditor: [
    '.tiptap.ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ],

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

  textImageGenerateButton: [
    'button',
    'div[role="button"]',
    '.d-button',
  ],

  // closed shadow DOM，Content Script 无法 querySelector 内部，仅操作 Host
  publishButtonNew: [
    'xhs-publish-btn[is-publish="true"]',
    'xhs-publish-btn',
  ],

  publishButtonHost: [
    '.publish-page-publish-btn xhs-publish-btn',
    '.publish-page xhs-publish-btn',
  ],

  publishButtonOld: [
    '.publish-page-publish-btn button.bg-red',
    '.publish-page-publish-btn button',
  ],

  // 需文本「发布」二次过滤
  publishButtonCe2026: [
    '.publish-page button.ce-btn.bg-red',
    'button.ce-btn.bg-red',
  ],

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

  submitButton: [
    '.publish-page-publish-btn button.bg-red',
    '.publish-page-publish-btn button',
    'button.publishBtn',
    '.submit button',
    'button[class*="publish"]',
    '.el-button--primary',
    '.d-button-content',
  ],

  // 发布按钮常在底部，需滚动这些容器而非仅 window
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

  titleLengthError: [
    'div.title-container div.max_suffix',
    '.title-container .max_suffix',
  ],

  contentLengthError: [
    'div.edit-container div.length-error',
    '.edit-container .length-error',
  ],

  topicSuggestion: [
    '#creator-editor-topic-container .item',
    '.topic-container .item',
    '[class*="topic"] [class*="item"]',
  ],

  popCover: [
    'div.d-popover',
    '.d-popover',
  ],

  publishSuccessFlags: [
    '.success-container',
    '[class*="publish-success"]',
    '.publish-success',
    '[class*="success"]',
  ],

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
