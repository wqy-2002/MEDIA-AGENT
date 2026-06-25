# 搜狐号探针与验收

## DOM 探针

```bash
npm install
npx playwright install chromium
npm run probe:sohu -- --headed
```

已登录时可保存会话：

```bash
npx playwright codegen https://mp.sohu.com --save-storage=scripts/sohu-probe/sohu-auth.json
npm run probe:sohu -- --storage-state=scripts/sohu-probe/sohu-auth.json
```

结果写入 `findings.json`。

## 扩展内端到端验收（修订版）

1. 在 `chrome://extensions` **完全重载**扩展
2. Options 开启「搜狐号」平台开关与「自动发布」
3. 手动打开内容管理首页，Console 应见 `[MediaFlow] Content Script 已注入`  
   `https://mp.sohu.com/mpfe/v4/contentManagement/first/page`
4. Chrome 已登录搜狐号（URL 不含 passport/login）
5. Side Panel 选择搜狐号，输入发布任务并上传封面图
6. 观察日志应出现：
   - `frameId=X PING 成功`
   - `已进入搜狐号发文编辑页`
   - `发布结果校验通过`
7. 搜狐后台「内容管理」确认新文章

若主发文 URL 失败，扩展会自动尝试备用链接（无 query 参数的 v4 编辑器页）：  
`https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle`

## E2E（可选）

```bash
set SOHU_E2E=1
npx playwright test tests/e2e/sohu-publish.spec.ts
```
