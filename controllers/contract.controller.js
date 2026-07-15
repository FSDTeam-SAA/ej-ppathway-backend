import { StatusCodes } from 'http-status-codes';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { verifyAccessToken } from '../utils/jwt.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import User from '../models/user.model.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { createNotification, broadcastSocket } from '../services/notification.service.js';
import { sendEmail } from '../services/email.service.js';

// Resolve the advisor application from a `contract-sign` token (used by the
// public, login-less signing page reached from the email link).
const resolveApplicationFromToken = async (token) => {
  if (!token) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Missing contract token');
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'This signing link is invalid or has expired');
  }
  if (payload?.type !== 'contract-sign' || !payload?.contractId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid contract token');
  }
  const app = await AdvisorApplication.findById(payload.contractId).populate(
    'user',
    'name email phone country state city dateOfBirth'
  );
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  return app;
};

const resolveOnboardingApplicationFromToken = async (token) => {
  if (!token) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Missing onboarding token');
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'This onboarding link is invalid or has expired');
  }
  if (payload?.type !== 'advisor-onboarding' || !payload?.applicationId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid onboarding token');
  }
  const app = await AdvisorApplication.findById(payload.applicationId).populate(
    'user',
    'name email phone country state city dateOfBirth timezone'
  );
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  return app;
};

export const getContractDetails = catchAsync(async (req, res) => {
  const token = req.query.token || req.body?.token;
  const app = await resolveApplicationFromToken(token);
  return sendResponse(res, {
    data: {
      applicantName: app.user?.name || '',
      contractUrl: app.contract?.url || '',
      signed: !!app.contract?.signedAt,
      signedAt: app.contract?.signedAt || null
    }
  });
});

export const getAdvisorOnboardingDetails = catchAsync(async (req, res) => {
  const token = req.query.token || req.body?.token;
  const app = await resolveOnboardingApplicationFromToken(token);
  return sendResponse(res, {
    data: {
      applicationId: app._id,
      user: app.user,
      applicantDetails: app.applicantDetails,
      professionalTitle: app.professionalTitle,
      bio: app.bio,
      detailedDescription: app.detailedDescription,
      yearsOfExperience: app.yearsOfExperience,
      expertise: app.expertise,
      styles: app.styles,
      languages: app.languages,
      status: app.status
    }
  });
});

export const completeAdvisorOnboarding = catchAsync(async (req, res) => {
  const token = req.body?.token || req.query.token;
  const app = await resolveOnboardingApplicationFromToken(token);
  const body = req.body || {};
  const user = await User.findById(app.user?._id || app.user).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  if (body.name) user.name = String(body.name).trim();
  if (body.phone) user.phone = String(body.phone).trim();
  if (body.country) user.country = String(body.country).trim().toUpperCase();
  if (body.state) user.state = String(body.state).trim();
  if (body.city) user.city = String(body.city).trim();
  if (body.timezone) user.timezone = String(body.timezone).trim();
  if (body.password) {
    if (String(body.password).length < 6) throw new ApiError(StatusCodes.BAD_REQUEST, 'Password must be at least 6 characters');
    user.password = String(body.password);
    user.mustChangePassword = false;
  }
  user.role = 'advisor';
  user.status = 'pending_verification';
  user.isVerified = true;
  await user.save();

  app.professionalTitle = body.professionalTitle || app.professionalTitle;
  app.bio = body.bio || app.bio;
  app.detailedDescription = body.detailedDescription || app.detailedDescription;
  app.yearsOfExperience = body.yearsOfExperience || app.yearsOfExperience;
  app.languages = Array.isArray(body.languages) ? body.languages : app.languages;
  app.expertise = Array.isArray(body.expertise) ? body.expertise : app.expertise;
  app.styles = Array.isArray(body.styles) ? body.styles : app.styles;
  app.status = 'pending_review';
  await app.save();

  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        professionalTitle: app.professionalTitle,
        bio: app.bio,
        detailedDescription: app.detailedDescription,
        yearsOfExperience: app.yearsOfExperience,
        languages: app.languages,
        expertise: app.expertise,
        styles: app.styles,
        profileReviewStatus: 'pending_review',
        profileSubmittedAt: new Date(),
        profileRejectionReason: ''
      },
      $setOnInsert: { user: user._id }
    },
    { upsert: true, new: true }
  );

  await createNotification({
    recipient: user._id,
    type: 'admin_announcement',
    title: 'Advisor onboarding submitted',
    body: 'Your advisor onboarding form was submitted for admin review.',
    data: { applicationId: app._id, profileId: profile._id }
  });

  return sendResponse(res, { message: 'Onboarding completed', data: { application: app, profile } });
});

const dataUrlToBuffer = (dataUrl) => {
  const match = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
};

// Guard the server-side fetch against SSRF: only public http(s) URLs, never
// loopback/link-local/private ranges.
const isSafeRemoteUrl = (u) => {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
};

// ISO alpha-2 country code -> English country name (built-in, no deps). Returns
// the input unchanged if it's already a name or an unknown code.
const countryName = (code) => {
  const c = String(code || '').trim();
  if (!c) return '';
  if (c.length !== 2) return c;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c.toUpperCase()) || c;
  } catch {
    return c;
  }
};

// Append a designed "Electronic Signature Certificate" page to the original
// contract PDF, including the advisor's details. Best-effort: returns null if
// the original isn't a fetchable/parseable PDF (e.g. a Google Doc link).
const buildSignedPdf = async (originalUrl, { signerName, signedAt, ip, signatureBuffer, advisor = {} }) => {
  if (!originalUrl || !isSafeRemoteUrl(originalUrl)) return null;
  try {
    const resp = await fetch(originalUrl);
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([612, 792]); // US Letter
    const { width, height } = page.getSize();

    // Palette
    const BRAND = rgb(0.055, 0.455, 0.565); // #0E7490
    const BRAND_SOFT = rgb(0.901, 0.965, 0.98);
    const INK = rgb(0.13, 0.15, 0.18);
    const LABEL = rgb(0.42, 0.45, 0.5);
    const HAIR = rgb(0.86, 0.88, 0.91);
    const PANEL = rgb(0.975, 0.985, 0.99);
    const WHITE = rgb(1, 1, 1);

    const M = 56; // page margin
    const contentW = width - M * 2;

    const text = (str, x, yy, { size = 11, f = font, color = INK } = {}) =>
      page.drawText(String(str ?? ''), { x, y: yy, size, font: f, color });

    const wrap = (str, maxW, size, f) => {
      const words = String(str ?? '').split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    // --- Header band -------------------------------------------------------
    const bandH = 110;
    page.drawRectangle({ x: 0, y: height - bandH, width, height: bandH, color: BRAND });
    text('Prophetic Pathway', M, height - 52, { size: 22, f: fontBold, color: WHITE });
    text('Electronic Signature Certificate', M, height - 78, {
      size: 12,
      color: rgb(0.85, 0.95, 0.98)
    });

    let y = height - bandH - 40;

    // --- Intro -------------------------------------------------------------
    const intro =
      'This document certifies that the advisor named below has reviewed and electronically signed the Advisor Service Agreement with Prophetic Pathway.';
    for (const ln of wrap(intro, contentW, 11, font)) {
      text(ln, M, y, { size: 11, color: rgb(0.3, 0.33, 0.38) });
      y -= 16;
    }
    y -= 18;

    // --- Section helper ----------------------------------------------------
    const sectionHeader = (title) => {
      text(title, M, y, { size: 10.5, f: fontBold, color: BRAND });
      page.drawLine({
        start: { x: M, y: y - 7 },
        end: { x: width - M, y: y - 7 },
        thickness: 1,
        color: HAIR
      });
      y -= 28;
    };

    // --- Advisor information ------------------------------------------------
    sectionHeader('ADVISOR INFORMATION');

    const loc = [...new Set([advisor.city, advisor.state, countryName(advisor.country)].filter(Boolean))].join(', ');
    const exp = advisor.yearsOfExperience
      ? `${advisor.yearsOfExperience} year${String(advisor.yearsOfExperience) === '1' ? '' : 's'}`
      : '';
    const langs = Array.isArray(advisor.languages) ? advisor.languages.join(', ') : advisor.languages;

    const rows = [
      ['Full Name', advisor.name || signerName],
      ['Professional Title', advisor.professionalTitle],
      ['Email', advisor.email],
      ['Phone', advisor.phone],
      ['Date of Birth', advisor.dateOfBirth],
      ['Location', loc],
      ['Experience', exp],
      ['Languages', langs]
    ].filter(([, v]) => v != null && String(v).trim() !== '');

    const labelW = 135;
    const valueW = contentW - labelW;
    for (const [lbl, val] of rows) {
      const lines = wrap(val, valueW, 11, fontBold);
      text(lbl, M, y, { size: 10, color: LABEL });
      lines.forEach((ln, i) => text(ln, M + labelW, y - i * 14, { size: 11, f: fontBold }));
      y -= Math.max(22, lines.length * 14 + 8);
    }

    y -= 12;

    // --- Signature ---------------------------------------------------------
    sectionHeader('SIGNATURE');

    const boxH = 130;
    const boxY = y - boxH;
    page.drawRectangle({
      x: M,
      y: boxY,
      width: contentW,
      height: boxH,
      color: PANEL,
      borderColor: HAIR,
      borderWidth: 1
    });

    if (signatureBuffer) {
      try {
        const png = await pdf.embedPng(signatureBuffer);
        const maxW = 260;
        const maxH = boxH - 40;
        let w = maxW;
        let h = (png.height / png.width) * w;
        if (h > maxH) {
          h = maxH;
          w = (png.width / png.height) * h;
        }
        page.drawImage(png, {
          x: M + (contentW - w) / 2,
          y: boxY + (boxH - h) / 2,
          width: w,
          height: h
        });
      } catch {
        /* bad signature image — keep the box but skip the image */
      }
    }
    y = boxY - 26;

    text('Signed by', M, y, { size: 10, color: LABEL });
    text(advisor.name || signerName, M + labelW, y, { size: 12, f: fontBold });
    y -= 20;
    text('Date (UTC)', M, y, { size: 10, color: LABEL });
    text(new Date(signedAt).toUTCString(), M + labelW, y, { size: 11 });
    if (ip) {
      y -= 20;
      text('IP address', M, y, { size: 10, color: LABEL });
      text(ip, M + labelW, y, { size: 11 });
    }

    // --- Footer ------------------------------------------------------------
    const footY = 64;
    page.drawRectangle({ x: 0, y: 0, width, height: 40, color: BRAND_SOFT });
    page.drawLine({
      start: { x: M, y: footY + 14 },
      end: { x: width - M, y: footY + 14 },
      thickness: 1,
      color: HAIR
    });
    const footNote =
      'This electronic signature is legally binding and was captured with the signer’s consent.';
    text(footNote, M, footY - 4, { size: 8.5, color: LABEL });
    if (advisor.applicationId) {
      text(`Document ref: ${advisor.applicationId}`, M, 14, { size: 8, color: LABEL });
    }
    const copy = '© 2026 Prophetic Pathway';
    text(copy, width - M - font.widthOfTextAtSize(copy, 8), 14, { size: 8, color: LABEL });

    const out = await pdf.save();
    return Buffer.from(out);
  } catch (e) {
    console.error('[contract] buildSignedPdf failed:', e?.message || e);
    return null;
  }
};

export const signContract = catchAsync(async (req, res) => {
  const { token, signerName, signatureImage, agreed } = req.body;
  const app = await resolveApplicationFromToken(token);

  if (app.contract?.signedAt) {
    return sendResponse(res, {
      message: 'Contract already signed',
      data: { signedAt: app.contract.signedAt, alreadySigned: true }
    });
  }

  const name = (signerName || '').trim().slice(0, 120);
  if (!name) throw new ApiError(StatusCodes.BAD_REQUEST, 'Your full name is required');
  if (!agreed) throw new ApiError(StatusCodes.BAD_REQUEST, 'You must agree to the contract terms');
  // Cap the signature payload before decoding to avoid memory-exhaustion DoS.
  if (typeof signatureImage !== 'string' || signatureImage.length > 4_000_000) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or oversized signature');
  }
  const signatureBuffer = dataUrlToBuffer(signatureImage);
  if (!signatureBuffer) throw new ApiError(StatusCodes.BAD_REQUEST, 'A signature is required');

  const signedAt = new Date();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

  // Store the captured signature image (best-effort).
  let signatureImageUrl = '';
  try {
    const r = await uploadBufferToCloudinary(signatureBuffer, 'contract-signatures', 'image', {
      contentType: 'image/png',
      filename: `signature-${app._id}.png`
    });
    signatureImageUrl = r.secure_url;
  } catch (e) {
    console.error('[contract] signature upload failed:', e?.message || e);
  }

  // Generate + store the signed copy (best-effort).
  const advisor = {
    name: app.user?.name,
    email: app.user?.email,
    phone: app.user?.phone,
    professionalTitle: app.professionalTitle,
    yearsOfExperience: app.yearsOfExperience,
    languages: app.languages,
    dateOfBirth: app.user?.dateOfBirth || app.applicantDetails?.dateOfBirth,
    city: app.user?.city || app.applicantDetails?.city,
    state: app.user?.state || app.applicantDetails?.state,
    country: app.user?.country || app.applicantDetails?.country,
    applicationId: String(app._id)
  };
  let signedPdfUrl = '';
  const signedBuf = await buildSignedPdf(app.contract?.url, { signerName: name, signedAt, ip, signatureBuffer, advisor });
  if (signedBuf) {
    try {
      const r = await uploadBufferToCloudinary(signedBuf, 'advisor-contracts-signed', 'auto', {
        contentType: 'application/pdf',
        filename: `signed-contract-${app._id}.pdf`
      });
      signedPdfUrl = r.secure_url;
    } catch (e) {
      console.error('[contract] signed pdf upload failed:', e?.message || e);
    }
  }

  if (!app.contract) app.contract = {};
  app.contract.signedAt = signedAt;
  app.contract.signerName = name;
  app.contract.signerIp = ip;
  app.contract.signatureImageUrl = signatureImageUrl;
  app.contract.signedPdfUrl = signedPdfUrl;
  app.markModified('contract');
  app.status = 'awaiting_approval';
  await app.save();

  // Notify admins (bell + best-effort email).
  const io = req.app.get('io');
  const admins = await User.find({ role: 'admin' }).select('_id email').lean();
  for (const admin of admins) {
    const notif = await createNotification({
      recipient: admin._id,
      type: 'admin_announcement',
      title: 'Advisor contract signed',
      body: `${name} has signed their advisor contract.`,
      data: { applicationId: String(app._id) }
    });
    if (io && notif) {
      broadcastSocket(io, admin._id, 'notification:new', {
        _id: String(notif._id),
        type: 'admin_announcement',
        title: notif.title,
        body: notif.body
      });
    }
    if (admin.email) {
      sendEmail({
        to: admin.email,
        subject: 'Advisor contract signed',
        html: `<p>${name} has signed their advisor contract. Please review and approve in the admin dashboard.</p>`
      }).catch((e) => console.error('[contract] admin email failed:', e?.message || e));
    }
  }

  return sendResponse(res, { message: 'Contract signed', data: { signedAt } });
});

export default { getContractDetails, signContract };
