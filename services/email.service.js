import { getTransporter } from '../config/mailer.js';

const FROM = process.env.SMTP_FROM || 'Prophetic Pathway <no-reply@propheticpathway.com>';

const wrap = (title, body) => `
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; background:#f7fafc; padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#0E7490;color:#fff;padding:20px;font-size:18px;font-weight:bold;">Prophetic Pathway</div>
      <div style="padding:24px;color:#1a202c;line-height:1.6;font-size:15px;">
        <h2 style="margin-top:0">${title}</h2>
        ${body}
      </div>
      <div style="padding:16px;font-size:12px;color:#718096;text-align:center;border-top:1px solid #e2e8f0;">
        &copy; ${new Date().getFullYear()} Prophetic Pathway
      </div>
    </div>
  </body>
</html>`;

export const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_HOST) {
    console.warn(`[email] SMTP not configured — skipping email to ${to} | ${subject}`);
    return { skipped: true };
  }
  const transporter = getTransporter();
  return transporter.sendMail({ from: FROM, to, subject, html, text });
};

export const sendOtpEmail = async (to, otp, purpose = 'verification') => {
  const subject = purpose === 'reset' ? 'Your password reset OTP' : 'Your verification OTP';
  const body = `
    <p>Use the OTP below to ${purpose === 'reset' ? 'reset your password' : 'verify your account'}:</p>
    <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0E7490;text-align:center;padding:16px;background:#f0fdfa;border-radius:8px;margin:16px 0;">
      ${otp}
    </div>
    <p>This code expires in 10 minutes. If you didn't request it, ignore this email.</p>`;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendInterviewScheduledEmail = async (to, { name, datetime, joinUrl }) => {
  const subject = 'Live Interview Scheduled';
  const body = `
    <p>Hi ${name || ''},</p>
    <p>Your live interview has been scheduled.</p>
    <p><b>Date & Time:</b> ${datetime}</p>
    ${joinUrl ? `<p><a href="${joinUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Join Interview</a></p>` : ''}
  `;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendAdvisorContractEmail = async (to, { name, contractUrl }) => {
  const subject = 'Your Advisor Contract';
  const body = `
    <p>Hi ${name || ''},</p>
    <p>Please review and sign your advisor contract.</p>
    ${contractUrl ? `<p><a href="${contractUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review &amp; Sign Contract</a></p>` : ''}
  `;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendAdvisorDecisionEmail = async (to, { name, approved, reason }) => {
  const subject = approved ? 'Advisor Application Approved 🎉' : 'Advisor Application Update';
  const body = approved
    ? `<p>Hi ${name || ''},</p><p>Congratulations! Your advisor application has been <b>approved</b>. You can now sign in to start advising.</p>`
    : `<p>Hi ${name || ''},</p><p>Your advisor application was not approved at this time.</p>${reason ? `<p>Reason: ${reason}</p>` : ''}`;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendAdvisorOnboardingEmail = async (to, { name, onboardingUrl }) => {
  const subject = 'Complete Your Advisor Profile';
  const body = `
    <p>Hi ${name || ''},</p>
    <p>Your advisor contract has been received. Please complete your advisor profile for admin review.</p>
    ${onboardingUrl ? `<p><a href="${onboardingUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Start Onboarding</a></p>` : ''}
    <p>Your profile will not be visible to clients until it is reviewed and approved.</p>
  `;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendAdvisorProfileDecisionEmail = async (to, { name, approved, reason, loginUrl }) => {
  const subject = approved ? 'Your Advisor Profile Is Approved' : 'Advisor Profile Update Required';
  const body = approved
    ? `<p>Hi ${name || ''},</p><p>Your advisor profile has been approved and is now visible to clients.</p>${loginUrl ? `<p><a href="${loginUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Advisor Dashboard</a></p>` : ''}`
    : `<p>Hi ${name || ''},</p><p>Your advisor profile needs updates before it can be approved.</p>${reason ? `<p><b>Reason and requested corrections:</b></p><p>${reason}</p>` : ''}<p>Please edit your profile and resubmit it for review. Your updated profile will return to Pending Review until an administrator approves it.</p>${loginUrl ? `<p><a href="${loginUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Edit Profile</a></p>` : ''}`;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export const sendAdvisorWelcomeEmail = async (to, { name, email, password, loginUrl }) => {
  const subject = 'Your Advisor Account Is Ready';
  const body = `
    <p>Hi ${name || ''},</p>
    <p>An advisor account has been created for you on Prophetic Pathway. You can log in immediately using the credentials below.</p>
    <table style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:6px 12px;font-weight:bold;color:#4a5568;">Email</td><td style="padding:6px 12px;">${email}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;color:#4a5568;">Password</td><td style="padding:6px 12px;">${password}</td></tr>
    </table>
    ${loginUrl ? `<p><a href="${loginUrl}" style="background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Login to Advisor Dashboard</a></p>` : ''}
    <p style="color:#718096;font-size:13px;">Please change your password after your first login.</p>`;
  return sendEmail({ to, subject, html: wrap(subject, body) });
};

export default {
  sendEmail,
  sendOtpEmail,
  sendInterviewScheduledEmail,
  sendAdvisorContractEmail,
  sendAdvisorDecisionEmail,
  sendAdvisorOnboardingEmail,
  sendAdvisorProfileDecisionEmail,
  sendAdvisorWelcomeEmail
};
