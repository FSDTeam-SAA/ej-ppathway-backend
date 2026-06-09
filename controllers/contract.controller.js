import { StatusCodes } from 'http-status-codes';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { verifyAccessToken } from '../utils/jwt.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
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
  const app = await AdvisorApplication.findById(payload.contractId).populate('user', 'name email');
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

// Append a signature page to the original contract PDF. Best-effort: returns
// null if the original isn't a fetchable/parseable PDF (e.g. a Google Doc link).
const buildSignedPdf = async (originalUrl, { signerName, signedAt, ip, signatureBuffer }) => {
  if (!originalUrl || !isSafeRemoteUrl(originalUrl)) return null;
  try {
    const resp = await fetch(originalUrl);
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage();
    const { height } = page.getSize();
    let y = height - 60;
    const line = (text, size, f = font, color = rgb(0.12, 0.12, 0.12)) => {
      page.drawText(String(text), { x: 50, y, size, font: f, color });
      y -= size + 10;
    };
    line('Electronic Signature', 18, fontBold, rgb(0.05, 0.45, 0.56));
    y -= 6;
    line('This advisor contract was reviewed and electronically signed.', 11);
    y -= 4;
    line(`Signed by: ${signerName}`, 12, fontBold);
    line(`Date: ${new Date(signedAt).toUTCString()}`, 11);
    if (ip) line(`IP address: ${ip}`, 11);
    y -= 14;
    if (signatureBuffer) {
      try {
        const png = await pdf.embedPng(signatureBuffer);
        const w = 220;
        const h = Math.min((png.height / png.width) * w, 90);
        line('Signature:', 11);
        page.drawImage(png, { x: 50, y: y - h, width: w, height: h });
      } catch {
        /* bad signature image — skip the image but keep the text */
      }
    }
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
    const r = await uploadBufferToCloudinary(signatureBuffer, 'contract-signatures', 'image');
    signatureImageUrl = r.secure_url;
  } catch (e) {
    console.error('[contract] signature upload failed:', e?.message || e);
  }

  // Generate + store the signed copy (best-effort).
  let signedPdfUrl = '';
  const signedBuf = await buildSignedPdf(app.contract?.url, { signerName: name, signedAt, ip, signatureBuffer });
  if (signedBuf) {
    try {
      const r = await uploadBufferToCloudinary(signedBuf, 'advisor-contracts-signed', 'auto');
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
