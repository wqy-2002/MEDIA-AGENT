/**
 * 搜狐号发文页 DOM 探针（开发期使用，不打包进扩展）。
 *
 * 用法：
 *   npx playwright install chromium
 *   npm run probe:sohu -- --headed
 *   npm run probe:sohu -- --storage-state=scripts/sohu-probe/sohu-auth.json
 */
import { chromium, type Page } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const FINDINGS_PATH = join(__dir, 'findings.json');

const CANDIDATE_URLS = [
  'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1',
  'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',
];

function parseArgs(argv: string[]) {
  let headed = false;
  let storageState: string | undefined;
  for (const arg of argv) {
    if (arg === '--headed') headed = true;
    if (arg.startsWith('--storage-state=')) storageState = arg.slice('--storage-state='.length);
  }
  return { headed, storageState };
}

async function probePage(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  const loggedOut = /login|passport/i.test(currentUrl);

  const probeSelectors = [
    'input[name="title"]',
    '.publish-title input',
    '#editor .ql-editor',
    'textarea[name="summary"]',
    'button.publish-btn',
    'input[type="file"]',
    '.upload-file',
    '.cover-upload',
  ];

  const found: Record<string, boolean> = {};
  for (const sel of probeSelectors) {
    found[sel] = (await page.locator(sel).count()) > 0;
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const hasQuill = await page.evaluate(() => Boolean(document.querySelector('#editor .ql-editor')));

  return {
    url,
    landedUrl: currentUrl,
    loggedOut,
    hasQuill,
    selectors: found,
    bodySnippet: bodyText.slice(0, 500),
  };
}

async function main() {
  const { headed, storageState } = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext(
    storageState && existsSync(storageState) ? { storageState } : {},
  );
  const page = await context.newPage();

  const results = [];
  for (const url of CANDIDATE_URLS) {
    console.info(`[sohu-probe] 探测: ${url}`);
    try {
      results.push(await probePage(page, url));
    } catch (err) {
      results.push({
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const base = existsSync(FINDINGS_PATH)
    ? JSON.parse(readFileSync(FINDINGS_PATH, 'utf-8'))
    : {};
  const output = {
    ...base,
    probedAt: new Date().toISOString(),
    probeResults: results,
  };
  writeFileSync(FINDINGS_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.info(`[sohu-probe] 已写入 ${FINDINGS_PATH}`);
  console.info(JSON.stringify(results, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error('[sohu-probe] 失败:', err);
  process.exit(1);
});
