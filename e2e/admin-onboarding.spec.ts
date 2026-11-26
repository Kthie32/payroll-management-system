import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_NEW_PASSWORD,
  ADMIN_SEED_PASSWORD,
  changePassword,
  createUser,
  enrolTotp,
  login,
  saveAdminState,
} from './helpers';

/**
 * Runs first on a freshly seeded payroll_test database (global setup): the seeded admin still has
 * the temporary password and no 2FA. Saves the admin credentials for later spec files.
 */
test('seeded admin onboards, creates a Finance Approver, and sees it in the audit log', async ({
  page,
}) => {
  // 1–3. Log in with the seeded credentials, forced password change, forced TOTP enrolment.
  await login(page, ADMIN_EMAIL, ADMIN_SEED_PASSWORD);
  await changePassword(page, ADMIN_SEED_PASSWORD, ADMIN_NEW_PASSWORD);
  const totpSecret = await enrolTotp(page);
  saveAdminState({ password: ADMIN_NEW_PASSWORD, totpSecret });

  // 4. Create a FINANCE_APPROVER user.
  const email = `approver-${Date.now()}@example.com`;
  await createUser(page, 'Fiona Approver', email, 'Finance Approver');
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
