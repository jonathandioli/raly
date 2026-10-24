import nodemailer from "nodemailer";

export const emailConfigured = () => !!(process.env.SMTP_HOST && process.env.EMAIL_TO);

export async function sendReport(subject: string, html: string, text: string) {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
    to: process.env.EMAIL_TO,
    subject,
    html,
    text,
  });
}
