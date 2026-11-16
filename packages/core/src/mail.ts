import { EmailClient } from "@azure/communication-email";
import nodemailer from "nodemailer";

// Azure: ACS_CONNECTION_STRING + MAIL_ABSENDER (DoNotReply@<azure-domain>).
// Lokal: SMTP_URL=smtp://localhost:1025 (Mailpit).

export type Mail = { an: string; betreff: string; text: string; anhang?: { name: string; daten: Uint8Array } };

let acs: EmailClient | undefined;
let smtp: nodemailer.Transporter | undefined;

export async function mailSenden(m: Mail) {
  const absender = process.env.MAIL_ABSENDER ?? "tickets@klangwerk.test";
  if (process.env.ACS_CONNECTION_STRING) {
    acs ??= new EmailClient(process.env.ACS_CONNECTION_STRING);
    const poller = await acs.beginSend({
      senderAddress: absender,
      recipients: { to: [{ address: m.an }] },
      content: { subject: m.betreff, plainText: m.text },
      attachments: m.anhang
        ? [{ name: m.anhang.name, contentType: "application/pdf", contentInBase64: Buffer.from(m.anhang.daten).toString("base64") }]
        : undefined,
    });
    await poller.pollUntilDone();
    return;
  }
  smtp ??= nodemailer.createTransport(process.env.SMTP_URL ?? "smtp://localhost:1025");
  await smtp.sendMail({
    from: absender,
    to: m.an,
    subject: m.betreff,
    text: m.text,
    attachments: m.anhang ? [{ filename: m.anhang.name, content: Buffer.from(m.anhang.daten) }] : undefined,
  });
}
