import 'server-only';
import { db } from '@/lib/db';
import { providerFor, readMessagingConfig, type Channel, type MessagingConfig } from './config';
import { sendAfricasTalking, sendSmtp, type EmailMessage } from './providers';
import { redactLinks } from './templates';

export { MessagingConfigError, readMessagingConfig } from './config';
export type { Channel, MessagingConfig } from './config';

export function messagingConfig(): MessagingConfig {
  return readMessagingConfig(process.env);
}

export interface OutgoingMessage {
  channel: Channel;
  to: string;
  subject?: string;
  text: string;
  html?: string;
  attachments?: EmailMessage['attachments'];
}

/**
 * Sends a message and records it in `outbound_messages` (the outbox). Never throws for a provider
 * failure: the stored message is marked FAILED with the reason. Configuration errors do throw.
 *
 * In live mode the stored copy has payslip link tokens redacted, so the database never holds a
 * usable link. In outbox mode the outbox IS the delivery channel (development and review), so the
 * full text is kept.
 */
export async function sendMessage(
  msg: OutgoingMessage,
  createdById: string | null,
  config: MessagingConfig = messagingConfig(),
) {
  const provider = providerFor(config, msg.channel);
  const stored = provider === 'outbox' ? msg.text : redactLinks(msg.text);
  const record = await db.outboundMessage.create({
    data: {
      channel: msg.channel,
      recipient: msg.to,
      subject: msg.subject ?? null,
      body: msg.attachments?.length
        ? `${stored}\n\n[Attachments: ${msg.attachments.map((a) => a.filename).join(', ')}]`
        : stored,
      status: 'QUEUED',
      provider,
      createdById,
    },
  });
  try {
    let providerRef: string | null = null;
    if (provider === 'smtp') {
      providerRef = (
        await sendSmtp(config.smtp!, {
          to: msg.to,
          subject: msg.subject ?? '',
          text: msg.text,
          html: msg.html,
          attachments: msg.attachments,
        })
      ).providerRef;
    } else if (provider === 'africastalking') {
      providerRef = (await sendAfricasTalking(config.sms!, msg.to, msg.text)).providerRef;
    }
    return db.outboundMessage.update({
      where: { id: record.id },
      data: { status: 'SENT', sentAt: new Date(), providerRef },
    });
  } catch (e) {
    return db.outboundMessage.update({
      where: { id: record.id },
      data: {
        status: 'FAILED',
        error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
      },
    });
  }
}
