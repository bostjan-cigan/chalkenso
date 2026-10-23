import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import { absoluteUrl, PRODUCT_NAME } from './site';

/**
 * Sending email, by what's set:
 * - an SMTP server (`SMTP_HOST`, `SMTP_PORT`; `SMTP_USER` / `SMTP_PASSWORD` when it needs them): Mailpit in
 *   development and the tests (`yarn mail:up`, inbox on http://localhost:8025), or any mail provider. It
 *   wins over Resend, so a Resend key copied into a development environment never sends real email;
 * - Resend's API (`RESEND_API_KEY`), when no SMTP server is set;
 * - neither: the email is written to the server log, so a fresh installation still works.
 * The sender is `MAIL_FROM`.
 */

/** A calendar invitation (an .ics file) sent with an email, its iTIP method so mail apps offer to add it. */
export type MailCalendar = { method: 'REQUEST' | 'PUBLISH' | 'CANCEL'; content: string };

export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string; calendar?: MailCalendar };
export type MailResult = { ok: true; via: 'smtp' | 'resend' | 'log' } | { ok: false; error: string };

let transporter: Transporter | null | undefined;
let resendClient: Resend | null | undefined;

function resend(): Resend | null {
  if (resendClient === undefined) {
    const key = process.env.RESEND_API_KEY?.trim();
    resendClient = key && !process.env.SMTP_HOST?.trim() ? new Resend(key) : null;
  }
  return resendClient;
}

function smtp(): Transporter | null {
  if (transporter !== undefined) {
    return transporter;
  }
  const host = process.env.SMTP_HOST?.trim();
  if (host) {
    const port = Number(process.env.SMTP_PORT ?? 1025) || 1025;
    const user = process.env.SMTP_USER?.trim();
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass: process.env.SMTP_PASSWORD ?? '' } } : {}),
    });
  } else {
    transporter = null;
  }
  return transporter;
}

export function mailFrom() {
  return process.env.MAIL_FROM?.trim() || `${PRODUCT_NAME} <no-reply@chalkenso.com>`;
}

/** Sends one email. Never throws: a failure comes back (and is logged) so the caller can say so. */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const transport = smtp();
  const api = transport ? null : resend();
  if (api) {
    try {
      const { error } = await api.emails.send({
        from: mailFrom(),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        replyTo: mail.replyTo,
        ...(mail.calendar
          ? {
              attachments: [
                {
                  filename: 'invite.ics',
                  content: Buffer.from(mail.calendar.content, 'utf8'),
                  contentType: `text/calendar; charset=utf-8; method=${mail.calendar.method}`,
                },
              ],
            }
          : {}),
      });
      if (error) {
        console.error(`[mail] Resend refused the email to ${mail.to}: ${error.message}`);
        return { ok: false, error: error.message };
      }
      return { ok: true, via: 'resend' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mail] could not reach Resend for ${mail.to}: ${message}`);
      return { ok: false, error: message };
    }
  }
  if (!transport) {
    console.info(`[mail] (no SMTP set: logged, not sent) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return { ok: true, via: 'log' };
  }
  try {
    await transport.sendMail({
      from: mailFrom(),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: mail.replyTo,
      ...(mail.calendar ? { icalEvent: { method: mail.calendar.method, filename: 'invite.ics', content: mail.calendar.content } } : {}),
    });
    return { ok: true, via: 'smtp' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mail] could not send to ${mail.to}: ${message}`);
    return { ok: false, error: message };
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Who signs a personal email: a photo, a name and a role, under the message. */
export type MailSignature = { name: string; role: string; photoUrl?: string };

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * Every email the app sends, in one template (one look, so people learn what ours look like): the logo
 * on the page, a white card with the paragraphs, one button (the link) and any closing paragraphs, and
 * why they got it under the card. Personal ones are signed, with a photo. Tables, so Outlook keeps
 * the layout; light only, so dark-mode mail apps don't recolour it. The text version is the same words
 * with the link written out. The template's own words ("Or copy this link") are in `locale`, the
 * language of the rest of the email (English unless the caller says).
 */
export function composeMail(input: {
  to: string;
  subject: string;
  locale?: Locale;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Plain links under the button, one per line ("Move or cancel the call"). */
  links?: Array<{ label: string; url: string }>;
  /** After the button: what comes next, a line about replying. */
  closing?: string[];
  footer: string;
  signature?: MailSignature;
  replyTo?: string;
  /** An invitation to attach (the text of an .ics file). */
  calendar?: MailCalendar;
}): Mail {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const words = loadMessages(locale).email.layout;
  const text = [
    ...input.paragraphs,
    ...(input.action ? [`${input.action.label}: ${input.action.url}`] : []),
    ...(input.links ?? []).map((link) => `${link.label}: ${link.url}`),
    ...(input.closing ?? []),
    ...(input.signature ? [`${input.signature.name}\n${input.signature.role}`] : []),
    '—',
    input.footer,
  ].join('\n\n');
  const paragraph = (content: string) => `<p style="margin:0 0 14px">${escapeHtml(content)}</p>`;
  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 14px"><tr><td style="border-radius:8px;background:#1f4e79">
<a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(input.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 ${input.closing?.length ? '22px' : '4px'};font-size:13px;color:#5b6475">${escapeHtml(words.copyLink)} <span style="word-break:break-all">${escapeHtml(input.action.url)}</span></p>`
    : '';
  const links = (input.links ?? [])
    .map(
      (link) =>
        `<p style="margin:0 0 14px"><a href="${escapeHtml(link.url)}" style="color:#1f4e79;font-weight:600;text-decoration:none">${escapeHtml(link.label)}</a></p>`
    )
    .join('\n');
  const signature = input.signature
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:22px;border-top:1px solid #ecebe6"><tr>
${input.signature.photoUrl ? `<td width="56" style="padding-top:18px;vertical-align:middle"><img src="${escapeHtml(input.signature.photoUrl)}" width="44" height="44" alt="" style="display:block;border:0;border-radius:50%"></td>` : ''}
<td style="padding-top:18px;vertical-align:middle;font-family:${FONT}"><div style="font-size:15px;font-weight:600;color:#1d2433">${escapeHtml(input.signature.name)}</div><div style="font-size:13px;color:#7a8291">${escapeHtml(input.signature.role)}</div></td>
</tr></table>`
    : '';
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px"><img src="${escapeHtml(absoluteUrl('/brand/chalkenso-email-logo.png'))}" width="150" height="43" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;border:0"></td></tr>
<tr><td style="background:#ffffff;border-radius:12px;padding:28px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1d2433">
${input.paragraphs.map(paragraph).join('\n')}
${action}
${links}
${(input.closing ?? []).map(paragraph).join('\n')}
${signature}
</td></tr>
<tr><td style="padding:18px 12px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#7a8291;text-align:center">${escapeHtml(input.footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { to: input.to, subject: input.subject, text, html, replyTo: input.replyTo, calendar: input.calendar };
}
