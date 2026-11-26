import { expect, test } from '@playwright/test';
import {
  acceptDialogs,
  createUser,
  firstLogin,
  login,
  loginAsAdmin,
  selectOptionContaining,
  verifyTotp,
} from './helpers';

/**
 * The whole payroll cycle through the UI, one person per role (spec: preparer ≠ approver):
 * admin creates users → HR adds an employee → Payroll Officer prepares and submits →
 * Payroll Officer cannot approve → Finance Approver approves and downloads the bank file.
 * Expected figures: basic 1,000,000 → PAYE 188,250, NSSF 50,000, net 761,750.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const PASSWORD = 'Cycle-Passw0rd!';
const users = {
  hr: { name: 'Hana HR', email: `hr-${stamp}@example.com`, role: 'HR Officer', temp: '' },
  po: { name: 'Paul Payroll', email: `po-${stamp}@example.com`, role: 'Payroll Officer', temp: '' },
  fa: {
    name: 'Faith Finance',
    email: `fa-${stamp}@example.com`,
    role: 'Finance Approver',
    temp: '',
  },
};
const staffNo = `E2E${String(stamp).slice(-6)}`;
let runUrl = '';
let faSecret = '';

test('admin creates an HR Officer, a Payroll Officer and a Finance Approver', async ({ page }) => {
  await loginAsAdmin(page);
  for (const u of Object.values(users)) {
    u.temp = await createUser(page, u.name, u.email, u.role);
  }
});

test('HR Officer adds an employee with basic pay and a bank account', async ({ page }) => {
  acceptDialogs(page);
  await firstLogin(page, users.hr.email, users.hr.temp, PASSWORD);

  await page.goto('/employees/new');
  await page.locator('input[name="staffNo"]').fill(staffNo);
  await page.locator('input[name="firstName"]').fill('Esi');
  await page.locator('input[name="lastName"]').fill('Cycle');
  await page.locator('select[name="workerType"]').selectOption('PERMANENT');
  await selectOptionContaining(page, 'payGroupId', 'Monthly Staff');
  await page.locator('input[name="hireDate"]').fill('2026-01-05');
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page).toHaveURL(/\/employees\/[a-z0-9]+\?created=1/);
  const employeeUrl = page.url().split('?')[0]!;

  await page.goto(`${employeeUrl}?tab=components`);
  await selectOptionContaining(page, 'componentId', '(BASIC)');
  await page.locator('input[name="value"]').fill('1000000');
  await page.locator('input[name="effectiveFrom"]').fill('2026-01-05');
  await page.getByRole('button', { name: 'Assign component' }).click();
  await expect(page.getByTestId('component-row-BASIC')).toBeVisible();

  await page.goto(`${employeeUrl}?tab=payment`);
  await selectOptionContaining(page, 'bankId', 'Stanbic');
  await page.locator('input[name="accountNo"]').fill('9030012345678');
  await page.locator('input[name="accountName"]').fill('Esi Cycle');
  await page.locator('input[name="effectiveFrom"]').fill('2026-01-05');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('••••5678').first()).toBeVisible();
});

test('Payroll Officer prepares and submits the November run but cannot approve it', async ({
  page,
}) => {
  acceptDialogs(page);
  await firstLogin(page, users.po.email, users.po.temp, PASSWORD);

  await page.goto('/payroll/periods');
  await selectOptionContaining(page, 'payGroupId', 'Monthly Staff');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.locator('input[name="from"]').fill('2026-11');
  await page.locator('input[name="to"]').fill('2026-11');
  await page.getByRole('button', { name: 'Generate periods' }).click();
  await expect(page.getByText(/Created [0-9]+ period/).first()).toBeVisible();

  await page.goto('/payroll');
  await selectOptionContaining(page, 'periodId', 'Monthly Staff');
  await page.getByRole('button', { name: 'Create run' }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\/[a-z0-9]+$/);
  runUrl = page.url();

  await page.getByRole('button', { name: 'Compute payroll' }).click();
  const row = page.getByRole('row').filter({ hasText: staffNo });
  await expect(row).toContainText('761,750');

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('run-status')).toHaveText(/Submitted for approval/);

  // The preparer has no approve control (role) — and the server would refuse it anyway.
  await expect(page.getByRole('button', { name: 'Approve run' })).toHaveCount(0);
});

test('Finance Approver approves and downloads the bank file', async ({ page }) => {
  acceptDialogs(page);
  faSecret = (await firstLogin(page, users.fa.email, users.fa.temp, PASSWORD, {
    requires2fa: true,
  }))!;

  await page.goto(runUrl);
  await page.getByRole('button', { name: 'Approve run' }).click();
  await expect(page.getByTestId('run-status')).toHaveText(/^Approved$/);

  const runId = runUrl.split('/').pop()!;
  await page.goto(`/exports/runs/${runId}`);
  await page.getByRole('button', { name: 'Generate bank file' }).click();
  const download = page.getByRole('link', { name: 'Download' }).first();
  await expect(download).toBeVisible();

  const res = await page.request.get((await download.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  const text = await res.text();
  const dataRows = text.split(/\r?\n/).filter((l) => l.includes(staffNo));
  expect(dataRows).toHaveLength(1);
  expect(dataRows[0]).toContain('761750');
});

test('a second Finance Approver sign-in asks for the TOTP code', async ({ page }) => {
  await login(page, users.fa.email, PASSWORD);
  await verifyTotp(page, faSecret);
});
