import { createTransport } from "nodemailer"
import { config } from "../config.ts"

// Outgoing email behind one small interface, so the service can be swapped. Two providers:
// - "log" prints each message: local development, tests, and deployments without a mail service yet.
// - "smtp" sends through any SMTP service (Resend, Postmark, Amazon SES, Mailgun, …): switching services means
//   changing SMTP_URL, not code. On Vercel use port 465 or 587 (25 is blocked).
// A provider that needs its own HTTP API can be added as another case in emailProvider().

export interface Email {
  to: string
  subject: string
  text: string
  html?: string
  /** A calendar invitation or cancellation (lib/ics.ts renderInvite), sent the way Gmail and Outlook recognise it. */
  invite?: { method: "REQUEST" | "CANCEL"; ics: string }
}

export interface EmailProvider {
  send(email: Email & { from: string }): Promise<void>
}

const logProvider: EmailProvider = {
  async send(e) {
    console.log(
      `[email] ${e.to}: ${e.subject}${e.invite ? ` (invitation ${e.invite.method})` : ""}`
    )
  },
}

function smtpProvider(url: string): EmailProvider {
  const transport = createTransport(url)
  return {
    async send(e) {
      await transport.sendMail({
        from: e.from,
        to: e.to,
        subject: e.subject,
        text: e.text,
        html: e.html,
        // Nodemailer adds the invitation twice, as a text/calendar alternative and as an .ics attachment, which
        // is the structure both Gmail and Outlook turn into a calendar entry.
        icalEvent: e.invite && {
          method: e.invite.method,
          content: e.invite.ics,
          filename: "invite.ics",
        },
      })
    },
  }
}

export function emailProvider(c = config.email): EmailProvider {
  switch (c.provider) {
    case "log":
      return logProvider
    case "smtp":
      if (!c.smtpUrl) throw new Error("EMAIL_PROVIDER=smtp needs SMTP_URL.")
      return smtpProvider(c.smtpUrl)
    default:
      throw new Error(
        `Unknown EMAIL_PROVIDER "${c.provider}" (use log or smtp).`
      )
  }
}

let provider: EmailProvider | undefined

/** Sends from EMAIL_FROM through the configured provider. */
export function sendEmail(email: Email): Promise<void> {
  provider ??= emailProvider()
  return provider.send({ ...email, from: config.email.from })
}

/** EMAIL_FROM split into the organizer an invitation needs. */
export function sender(): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(config.email.from)
  return match
    ? { name: match[1] || match[2]!, email: match[2]! }
    : { name: config.email.from, email: config.email.from }
}
