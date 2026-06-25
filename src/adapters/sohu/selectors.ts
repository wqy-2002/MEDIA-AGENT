export const SOHU_URLS = {
  homeUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
  /** 登录态校验 / 预热（先打开内容管理首页再进编辑器） */
  dashboardUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/first/page',
  publishUrl: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
  publishUrlAlt: 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
};

export const sohuSelectors = {
  /** 登录墙 URL：passport 域名或明确 /login 路径 */
  loginHostnames: ['passport.sohu.com'],
  loginPathPattern: /\/login(?:\/|$|\?|#)/i,

  /** 可见验证码/滑块容器（不含 id*=captcha、nc-container 等宽匹配） */
  verificationFlags: [
    'iframe[src*="captcha"]',
    '[class*="geetest"]',
    '.captcha-container',
    '.slider-captcha',
  ],

  /** 验证码弹层文案（与可见容器联合判定） */
  verificationTextPattern: /验证码|滑动验证|安全验证|请完成验证|拖动滑块/,

  /** DOM 登录墙文案 */
  loginWallTextPattern: /请登录|扫码登录|立即登录|短信登录|账号登录/,

  titleInput: [
    '.publish-title input',
    'input[name="title"]',
    'input[placeholder*="标题"]',
  ],

  bodyEditor: [
    '#editor .ql-editor',
    '#editor.ql-editor',
    '.ql-editor[contenteditable="true"]',
  ],

  summaryInput: [
    'textarea[name="summary"]',
    'textarea[placeholder*="摘要"]',
  ],

  tagInput: [
    '.tag-input input',
    'input[placeholder*="标签"]',
    '.tag-input',
  ],

  coverUploadTrigger: [
    '.upload-file.mp-upload',
    '.cover-upload',
    '.upload-file',
    '[class*="cover"] [class*="upload"]',
  ],

  coverFileInput: [
    'input[type="file"]',
    'label[for="new-file"]',
  ],

  coverConfirmButton: [
    '.board[contentpictures] .positive-button',
    '.positive-button',
    'button[class*="confirm"]',
  ],

  publishButton: [
    'li.publish-report-btn.active.positive-button',
    'li.publish-report-btn.positive-button',
    'li[report-attr*="content-button-commit"]',
    '.bottom-button-outer-absolute li.positive-button',
    'ul.button-list li.positive-button',
    'button.publish-btn',
    'button[class*="publish"]',
  ],

  /** 发布确认弹窗（搜狐 v4 常用 li.positive-button，不一定是 button） */
  publishConfirmButton: [
    '.positive-button',
    'button[class*="confirm"]',
  ],

  popCover: [
    '.d-popover',
    'div.d-popover',
    '.guide-modal',
    '[class*="guide"] [class*="close"]',
  ],

  publishSuccessFlags: [
    '[class*="success"]',
    '.toast',
    '[class*="message"]',
  ],

  formErrorFlags: [
    '[class*="error"]',
    '[class*="warn"]',
    '.length-error',
  ],
};
