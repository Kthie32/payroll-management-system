import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';

/**
 * Requires a freshly seeded database (`pnpm db:reset`): the seeded admin must still have
 * the temporary password and no 2FA.
 */
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
const NEW_PASSWORD = 'E2e-New-Passw0rd!';

test('seeded admin onboards, creates a Finance Approver, and sees it in the audit log', async ({
  page,
}) => {
  // 1. Log in with the seeded credentials.
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // 2. Forced password change.
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password').fill(ADMIN_PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();

  // 3. Forced TOTP enrolment (SYSTEM_ADMIN requires 2FA).
  await expect(page).toHaveURL(/\/2fa\/enrol$/);
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel('6-digit code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 4. Create a FINANCE_APPROVER user.
  const email = `approver-${Date.now()}@example.com`;
  await page.getByRole('link', { name: 'Users' }).first().click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await page.getByLabel('Full name').fill('Fiona Approver');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Finance Approver').check();
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByTestId('temp-password')).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  // 5. The creation appears in the audit log.
  await page.getByRole('link', { name: 'Audit' }).first().click();
  await expect(page).toHaveURL(/\/audit/);
  const row = page.getByRole('row').filter({ hasText: 'USER_CREATED' }).first();
  await expect(row).toBeVisible();
  await row.getByText('Show changes').click();
  await expect(row.getByText(email)).toBeVisible();
  await expect(row.getByText('FINANCE_APPROVER')).toBeVisible();
});
