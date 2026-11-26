// Smoke test: sign in as demo users and open every page on a running app (default http://localhost:3000).
// Usage: node scripts/smoke.mjs [baseUrl]   — requires `pnpm db:seed:demo` data.
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PASSWORD = 'Demo!Pass2026';

const PLAN = {
  'auditor@example.com': [
    '/dashboard', '/employees', '/employees/departments', '/employees/banks', '/payroll',
    '/payroll/periods', '/loans', '/reports', '/settings', '/settings/statutory',
    '/settings/components', '/settings/pay-groups', '/settings/general', '/audit',
    '/exports', '/exports/templates', '/admin/users', '/admin/messages',
  ],
  'payroll@example.com': ['/dashboard', '/payroll', '/payroll/periods', '/reports', '/admin/messages', '/employees'],
  'hr@example.com': ['/employees/new', '/employees/import', '/loans/new'],
};

const browser = await chromium.launch();
let failures = 0;
for (const [email, paths] of Object.entries(PLAN)) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

  // Discover detail pages from list pages.
  const extra = [];
  const linkFrom = async (list, pattern) => {
    await page.goto(`${BASE}${list}`);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    const hit = hrefs.find((h) => h && pattern.test(h));
    if (hit) extra.push(hit);
  };
  if (email === 'auditor@example.com') {
    await linkFrom('/employees', /^\/employees\/[a-z0-9]{20,}$/);
    await linkFrom('/payroll', /^\/payroll\/runs\/[a-z0-9]{20,}$/);
    await linkFrom('/loans', /^\/loans\/[a-z0-9]{20,}$/);
    await linkFrom('/reports', /^\/reports\/[a-z-]+/);
    await linkFrom('/payroll/periods', /\/inputs$/);
  }
  if (email === 'payroll@example.com') {
    await linkFrom('/exports', /^\/exports\/runs\//);
    await linkFrom('/exports/templates', /^\/exports\/templates\/[a-z0-9]{20,}/);
  }
  for (const path of [...paths, ...extra]) {
    const res = await page.goto(`${BASE}${path}`);
    const status = res?.status() ?? 0;
    const body = await page.locator('body').innerText();
    const broken =
      status >= 400 || /Application error|Internal Server Error|Unhandled Runtime Error/i.test(body);
    if (broken || errors.length) failures++;
    console.log(`${broken || errors.length ? 'FAIL' : 'ok  '} ${status} ${email.split('@')[0].padEnd(8)} ${path}${errors.length ? '  ' + errors.join(' | ') : ''}`);
    errors.length = 0;
  }
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} page(s) failed` : '\nAll pages rendered');
process.exitCode = failures ? 1 : 0;
