import { defineConfig } from 'wxt';

// WXT 配置：使用 React 模块，生成 Manifest V3 插件
// 文档：https://wxt.dev
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MediaFlow Agent',
    description: '独立运行的 Chrome 浏览器 AI Agent 插件，用自然语言完成多平台发布与互动',
    version: '0.1.0',
    // 仅申请 MVP 必需权限（参见开发文档第 14 节）
    permissions: [
      'storage',
      'tabs',
      'activeTab',
      'scripting',
      'webNavigation',
      'sidePanel',
      'notifications',
      'alarms',
    ],
    // 只对支持平台注入脚本
    host_permissions: [
      '*://*.xiaohongshu.com/*',
      '*://*.xhscdn.com/*',
      '*://*.sohu.com/*',
      '*://mp.sohu.com/*',
    ],
    // 点击插件图标打开 Side Panel
    action: {
      default_title: 'MediaFlow Agent',
    },
  },
  // 开发时使用的 Vite 配置
  vite: () => ({
    define: {
      // 避免某些库引用 process.env 报错
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
  }),
});
