/**
 * Messaging configuration (email + SMS). Pure: reads from an env-like object so it can be tested.
 *
 * MESSAGING_MODE=outbox (default) never sends anything: every message is stored in the outbox
 * (/admin/messages) so it can be reviewed. MESSAGING_MODE=live sends through SMTP (email) and
 * Africa's Talking (SMS); a channel without configuration fails with a clear error.
 */

export type MessagingMode = 'outbox' | 'live';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export interface SmsConfig {
  username: string;
  apiKey: string;
  senderId: string | null;
  sandbox: boolean;
}

export interface MessagingConfig {
  mode: MessagingMode;
  smtp: SmtpConfig | null;
  sms: SmsConfig | null;
  /** Public base URL used in payslip links, without a trailing slash. */
  baseUrl: string;
  /** How long a payslip link stays valid. */
  linkDays: number;
}

export class MessagingConfigError extends Error {
  override name = 'MessagingConfigError';
}

type Env = Record<string, string | undefined>;

const DEFAULT_LINK_DAYS = 7;
const MAX_LINK_DAYS = 90;
const DEFAULT_SMTP_PORT = 587;
const SMTPS_PORT = 465;

function trimmed(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

export function readMessagingConfig(env: Env): MessagingConfig {
  const modeRaw = (trimmed(env, 'MESSAGING_MODE') ?? 'outbox').toLowerCase();
  if (modeRaw !== 'outbox' && modeRaw !== 'live') {
    throw new MessagingConfigError(`MESSAGING_MODE must be "outbox" or "live", not "${modeRaw}".`);
  }

  const host = trimmed(env, 'SMTP_HOST');
  const from = trimmed(env, 'SMTP_FROM');
  let smtp: SmtpConfig | null = null;
  if (host && from) {
    const port = Number(trimmed(env, 'SMTP_PORT') ?? DEFAULT_SMTP_PORT);
    if (!Number.isInteger(port) || port <= 0)
      throw new MessagingConfigError('SMTP_PORT must be a port number.');
    smtp = {
      host,
      port,
      secure: port === SMTPS_PORT,
      user: trimmed(env, 'SMTP_USER'),
      pass: trimmed(env, 'SMTP_PASS'),
      from,
    };
  }

  const username = trimmed(env, 'AT_USERNAME');
  const apiKey = trimmed(env, 'AT_API_KEY');
  const sms: SmsConfig | null =
    username && apiKey
      ? {
          username,
          apiKey,
          senderId: trimmed(env, 'AT_SENDER_ID'),
          sandbox: username === 'sandbox',
        }
      : null;

  const baseUrl = (
    trimmed(env, 'APP_BASE_URL') ??
    trimmed(env, 'AUTH_URL') ??
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const daysRaw = Number(trimmed(env, 'PAYSLIP_LINK_DAYS') ?? DEFAULT_LINK_DAYS);
  const linkDays =
    Number.isInteger(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, MAX_LINK_DAYS) : DEFAULT_LINK_DAYS;

  return { mode: modeRaw, smtp, sms, baseUrl, linkDays };
}

export type Channel = 'EMAIL' | 'SMS';

/** Which provider handles a channel. Throws when live mode lacks that channel's settings. */
export function providerFor(
  config: MessagingConfig,
  channel: Channel,
): 'outbox' | 'smtp' | 'africastalking' {
  if (config.mode === 'outbox') return 'outbox';
  if (channel === 'EMAIL') {
    if (!config.smtp) {
      throw new MessagingConfigError(
        'Email is not configured: set SMTP_HOST and SMTP_FROM, or use MESSAGING_MODE=outbox.',
      );
    }
    return 'smtp';
  }
  if (!config.sms) {
    throw new MessagingConfigError(
      "SMS is not configured: set AT_USERNAME and AT_API_KEY (Africa's Talking), or use MESSAGING_MODE=outbox.",
    );
  }
  return 'africastalking';
}
