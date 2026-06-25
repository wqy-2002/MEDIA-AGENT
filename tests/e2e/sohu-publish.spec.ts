/**
 * 搜狐号发布 E2E（需本地登录态，默认跳过）。
 *
 * 运行前：
 *   npx playwright codegen https://mp.sohu.com --save-storage=scripts/sohu-probe/sohu-auth.json
 *   SOHU_E2E=1 npx playwright test tests/e2e/sohu-publish.spec.ts
 */
import { test, expect } from '@playwright/test';

const publishUrl =
  'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1';

test.describe('搜狐号发布 E2E', () => {
  test.skip(!process.env.SOHU_E2E, '设置 SOHU_E2E=1 且提供 storageState 后运行');

  test('发文页应加载编辑器', async ({ page }) => {
    await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toMatch(/login|passport/i);
    const title = page.locator('input[name="title"], .publish-title input');
    const editor = page.locator('#editor .ql-editor');
    await expect(title.or(editor).first()).toBeVisible({ timeout: 15000 });
  });
});
