import 'server-only';
import nodemailer from 'nodemailer';
import type { SmsConfig, SmtpConfig } from './config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface ProviderResult {
  providerRef: string | null;
}

export class ProviderError extends Error {
  override name = 'ProviderError';
}

export async function sendSmtp(config: SmtpConfig, msg: EmailMessage): Promise<ProviderResult> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
  });
  try {
    const info = await transport.sendMail({
      from: config.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments,
    });
    return { providerRef: info.messageId ?? null };
  } catch (e) {
    throw new ProviderError(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const AT_LIVE = 'https://api.africastalking.com/version1/messaging';
const AT_SANDBOX = 'https://api.sandbox.africastalking.com/version1/messaging';

/** Sends one SMS through Africa's Talking. `to` is international format without "+", e.g. 2567XXXXXXXX. */
export async function sendAfricasTalking(
  config: SmsConfig,
  to: string,
  text: string,
): Promise<ProviderResult> {
  const body = new URLSearchParams({ username: config.username, to: `+${to}`, message: text });
  if (config.senderId) body.set('from', config.senderId);
  let res: Response;
  try {
    res = await fetch(config.sandbox ? AT_SANDBOX : AT_LIVE, {
      method: 'POST',
      headers: {
        apiKey: config.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ProviderError(`SMS failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    SMSMessageData?: { Recipients?: Array<{ status?: string; messageId?: string }> };
  } | null;
  const recipient = json?.SMSMessageData?.Recipients?.[0];
  if (!res.ok || !recipient || recipient.status !== 'Success') {
    throw new ProviderError(`SMS failed: ${recipient?.status ?? `HTTP ${res.status}`}`);
  }
  return { providerRef: recipient.messageId ?? null };
}
