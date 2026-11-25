import { describe, expect, it } from 'vitest';
import { MessagingConfigError, providerFor, readMessagingConfig } from '../config';
import { payslipEmail, payslipSms, redactLinks } from '../templates';

const TOKEN = 'abcDEF0123456789_-abcDEF0123456789_-abcdefg';

describe('readMessagingConfig', () => {
  it('defaults to outbox mode with sensible link settings', () => {
    const c = readMessagingConfig({});
    expect(c).toMatchObject({
      mode: 'outbox',
      smtp: null,
      sms: null,
      baseUrl: 'http://localhost:3000',
      linkDays: 7,
    });
  });
  it('reads SMTP and Africa’s Talking settings and trims the base URL', () => {
    const c = readMessagingConfig({
      MESSAGING_MODE: 'LIVE',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      SMTP_FROM: 'Payroll <payroll@example.com>',
      AT_USERNAME: 'sandbox',
      AT_API_KEY: 'key',
      APP_BASE_URL: 'https://payroll.example.com/',
      PAYSLIP_LINK_DAYS: '400',
    });
    expect(c.mode).toBe('live');
    expect(c.smtp).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true, user: 'u' });
    expect(c.sms).toMatchObject({ username: 'sandbox', sandbox: true, senderId: null });
    expect(c.baseUrl).toBe('https://payroll.example.com');
    expect(c.linkDays).toBe(90);
  });
  it('rejects an unknown mode and a bad port; ignores a bad link-days value', () => {
    expect(() => readMessagingConfig({ MESSAGING_MODE: 'smtp' })).toThrow(MessagingConfigError);
    expect(() => readMessagingConfig({ SMTP_HOST: 'h', SMTP_FROM: 'f', SMTP_PORT: 'x' })).toThrow(
      /SMTP_PORT/,
    );
    expect(readMessagingConfig({ PAYSLIP_LINK_DAYS: '-3' }).linkDays).toBe(7);
  });
});

describe('providerFor', () => {
  it('uses the outbox for every channel in outbox mode', () => {
    const c = readMessagingConfig({});
    expect(providerFor(c, 'EMAIL')).toBe('outbox');
    expect(providerFor(c, 'SMS')).toBe('outbox');
  });
  it('uses SMTP and Africa’s Talking in live mode, and fails clearly when unconfigured', () => {
    const live = readMessagingConfig({ MESSAGING_MODE: 'live' });
    expect(() => providerFor(live, 'EMAIL')).toThrow(/SMTP_HOST/);
    expect(() => providerFor(live, 'SMS')).toThrow(/AT_USERNAME/);
    const full = readMessagingConfig({
      MESSAGING_MODE: 'live',
      SMTP_HOST: 'h',
      SMTP_FROM: 'f',
      AT_USERNAME: 'acme',
      AT_API_KEY: 'k',
    });
    expect(providerFor(full, 'EMAIL')).toBe('smtp');
    expect(providerFor(full, 'SMS')).toBe('africastalking');
  });
});

describe('payslip message templates', () => {
  const args = {
    companyName: 'Magezi Harvest Limited',
    firstName: 'Grace <b>',
    periodLabel: 'November 2026',
    link: `https://payroll.example.com/p/${TOKEN}`,
    expiresOn: '2 Dec 2026',
  };
  it('builds an email with the link and escaped HTML', () => {
    const m = payslipEmail(args);
    expect(m.subject).toBe('Your payslip for November 2026 – Magezi Harvest Limited');
    expect(m.text).toContain(args.link);
    expect(m.html).toContain('Grace &lt;b&gt;');
    expect(m.html).not.toContain('<b>');
  });
  it('builds a short SMS', () => {
    const sms = payslipSms(args);
    expect(sms).toContain(args.link);
    expect(sms.length).toBeLessThanOrEqual(160);
  });
  it('redacts link tokens for storage', () => {
    expect(redactLinks(`see https://x/p/${TOKEN} now`)).toBe('see https://x/p/•••••••• now');
    expect(redactLinks('no link')).toBe('no link');
  });
});
