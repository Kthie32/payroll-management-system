import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { authenticator } from 'otplib';

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
export const ADMIN_SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
export const ADMIN_NEW_PASSWORD = 'E2e-New-Passw0rd!';

/** Admin credentials after onboarding, shared between spec files (reset by global setup). */
export const ADMIN_STATE_FILE = join(__dirname, '.auth', 'admin.json');

interface AdminState {
  password: string;
  totpSecret: string;
}

function readAdminState(): AdminState | null {
  if (!existsSync(ADMIN_STATE_FILE)) return null;
  return JSON.parse(readFileSync(ADMIN_STATE_FILE, 'utf8')) as AdminState;
}

export function saveAdminState(state: AdminState) {
  mkdirSync(dirname(ADMIN_STATE_FILE), { recursive: true });
  writeFileSync(ADMIN_STATE_FILE, JSON.stringify(state));
}

/** Accept every confirm() dialog (destructive-action confirmations). */
export function acceptDialogs(page: Page) {
  page.on('dialog', (d) => void d.accept());
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Confirm new password').fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
}

/** Completes TOTP enrolment and returns the secret. */
export async function enrolTotp(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/2fa\/enrol$/);
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel('6-digit code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return secret;
}

export async function verifyTotp(page: Page, secret: string) {
  await expect(page).toHaveURL(/\/2fa\/verify$/);
  await page.getByLabel('6-digit code').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Signs in as the seeded admin. The first call onboards (password change + TOTP) and saves the
 * credentials; later calls (other spec files) sign in with them and verify TOTP.
 */
export async function loginAsAdmin(page: Page) {
  const state = readAdminState();
  if (!state) {
    await login(page, ADMIN_EMAIL, ADMIN_SEED_PASSWORD);
    await changePassword(page, ADMIN_SEED_PASSWORD, ADMIN_NEW_PASSWORD);
    const totpSecret = await enrolTotp(page);
    saveAdminState({ password: ADMIN_NEW_PASSWORD, totpSecret });
    return;
  }
  await login(page, ADMIN_EMAIL, state.password);
  await verifyTotp(page, state.totpSecret);
}

/** Admin creates a user with one role; returns the temporary password shown once. */
export async function createUser(page: Page, name: string, email: string, roleLabel: string) {
  await page.goto('/admin/users');
  // Scope to the create form: each existing user also has role checkboxes on this page.
  const form = page.getByTestId('create-user-form');
  await form.getByLabel('Full name').fill(name);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel(roleLabel, { exact: true }).check();
  await form.getByRole('button', { name: 'Create user' }).click();
  const temp = page.getByTestId('temp-password');
  await expect(temp).toBeVisible();
  return ((await temp.textContent()) ?? '').trim();
}

/** First sign-in of a created user: forced password change, then TOTP enrolment if required. */
export async function firstLogin(
  page: Page,
  email: string,
  tempPassword: string,
  newPassword: string,
  opts: { requires2fa?: boolean } = {},
): Promise<string | null> {
  await login(page, email, tempPassword);
  await changePassword(page, tempPassword, newPassword);
  if (opts.requires2fa) return enrolTotp(page);
  await expect(page).toHaveURL(/\/dashboard/);
  return null;
}

/** Selects the first <option> whose text contains `text`. */
export async function selectOptionContaining(page: Page, selectName: string, text: string) {
  const select = page.locator(`select[name="${selectName}"]`);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  expect(value, `option containing "${text}" in ${selectName}`).toBeTruthy();
  await select.selectOption(value!);
}
