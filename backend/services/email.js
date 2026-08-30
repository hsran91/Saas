const { logInfo, logWarn, logError } = require("../utils/logger");

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO;

function isEmailConfigured() {
  if (!EMAIL_ENABLED) {
    return { ready: false, reason: "EMAIL_ENABLED is false" };
  }

  if (!EMAIL_PROVIDER) {
    return { ready: false, reason: "EMAIL_PROVIDER is required when EMAIL_ENABLED=true" };
  }

  if (!EMAIL_FROM) {
    return { ready: false, reason: "EMAIL_FROM is required when EMAIL_ENABLED=true" };
  }

  if (EMAIL_PROVIDER === "sendgrid" && !process.env.SENDGRID_API_KEY) {
    return { ready: false, reason: "SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid" };
  }

  if (EMAIL_PROVIDER === "postmark" && !process.env.POSTMARK_SERVER_TOKEN) {
    return { ready: false, reason: "POSTMARK_SERVER_TOKEN is required when EMAIL_PROVIDER=postmark" };
  }

  if (EMAIL_PROVIDER !== "sendgrid" && EMAIL_PROVIDER !== "postmark") {
    return { ready: false, reason: `Unsupported EMAIL_PROVIDER: ${EMAIL_PROVIDER}` };
  }

  return { ready: true, reason: null };
}

async function sendWithSendGrid({ to, subject, text, html }) {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: EMAIL_FROM },
      reply_to: EMAIL_REPLY_TO ? { email: EMAIL_REPLY_TO } : undefined,
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid send failed (${response.status}): ${body}`);
  }
}

async function sendWithPostmark({ to, subject, text, html }) {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      From: EMAIL_FROM,
      To: to,
      ReplyTo: EMAIL_REPLY_TO || undefined,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      MessageStream: "outbound"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Postmark send failed (${response.status}): ${body}`);
  }
}

async function sendEmail({ to, subject, text, html }) {
  const config = isEmailConfigured();
  if (!config.ready) {
    logWarn("Email delivery skipped", { reason: config.reason, to, subject });
    return false;
  }

  if (EMAIL_PROVIDER === "sendgrid") {
    await sendWithSendGrid({ to, subject, text, html });
  } else {
    await sendWithPostmark({ to, subject, text, html });
  }

  logInfo("Email delivered", { provider: EMAIL_PROVIDER, to, subject });
  return true;
}

async function sendUserProvisionedEmail({
  to,
  name,
  username,
  role,
  tenantId,
  issuedBy
}) {
  const subject = "Your eMAR account has been created";
  const text = [
    `Hi ${name},`,
    "",
    "Your account is ready.",
    `Username: ${username}`,
    `Role: ${role}`,
    "",
    "If this is unexpected, contact your administrator.",
    ""
  ].join("\n");

  const html = `
    <p>Hi ${name},</p>
    <p>Your account is ready.</p>
    <ul>
      <li><strong>Username:</strong> ${username}</li>
      <li><strong>Role:</strong> ${role}</li>
      <li><strong>Tenant:</strong> ${tenantId}</li>
      <li><strong>Created by:</strong> ${issuedBy}</li>
    </ul>
    <p>If this is unexpected, contact your administrator.</p>
  `;

  try {
    return await sendEmail({ to, subject, text, html });
  } catch (err) {
    logError("Failed to send user provisioning email", {
      error: err.message,
      to,
      role,
      tenantId
    });
    return false;
  }
}

module.exports = {
  sendEmail,
  sendUserProvisionedEmail,
  isEmailConfigured
};