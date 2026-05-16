import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import ContactMessage, {
  CONTACT_CATEGORIES,
  CONTACT_STATUSES
} from '../models/contactMessage.model.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import { sendEmail } from '../services/email.service.js';

const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const submitContactMessage = catchAsync(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    subject,
    category,
    message
  } = req.body || {};

  if (!firstName || !email || !message) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'firstName, email and message are required');
  }
  if (category && !CONTACT_CATEGORIES.includes(category)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid category. Must be one of: ${CONTACT_CATEGORIES.join(', ')}`);
  }

  const doc = await ContactMessage.create({
    firstName: String(firstName).trim(),
    lastName: lastName ? String(lastName).trim() : '',
    email: String(email).trim().toLowerCase(),
    phone: phone || '',
    subject: subject || '',
    category: category || 'General Inquiry',
    message: String(message)
  });

  // Fire-and-forget notification — don't fail the public request if mail dies.
  const adminInbox = process.env.SUPPORT_EMAIL || process.env.SUPER_ADMIN_EMAIL || 'admin@propheticpathway.com';
  sendEmail({
    to: adminInbox,
    subject: `[Contact] ${doc.category}: ${doc.subject || '(no subject)'}`,
    html: `
      <h2>New contact message</h2>
      <p><b>From:</b> ${escapeHtml(doc.firstName)} ${escapeHtml(doc.lastName)} &lt;${escapeHtml(doc.email)}&gt;</p>
      ${doc.phone ? `<p><b>Phone:</b> ${escapeHtml(doc.phone)}</p>` : ''}
      <p><b>Category:</b> ${escapeHtml(doc.category)}</p>
      ${doc.subject ? `<p><b>Subject:</b> ${escapeHtml(doc.subject)}</p>` : ''}
      <hr/>
      <p style="white-space:pre-wrap">${escapeHtml(doc.message)}</p>
    `
  }).catch((e) => console.warn('[contact] email notification failed:', e?.message));

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    data: { id: doc._id },
    message: 'Message received. We will get back to you within 24-48 business hours.'
  });
});

export const adminListContactMessages = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status && CONTACT_STATUSES.includes(req.query.status)) {
    filter.status = req.query.status;
  }
  if (req.query.q) {
    const re = new RegExp(String(req.query.q).trim(), 'i');
    filter.$or = [{ firstName: re }, { lastName: re }, { email: re }, { subject: re }, { message: re }];
  }
  const [items, total] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ContactMessage.countDocuments(filter)
  ]);
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const adminGetContactMessage = catchAsync(async (req, res) => {
  const doc = await ContactMessage.findById(req.params.id).lean();
  if (!doc) throw new ApiError(StatusCodes.NOT_FOUND, 'Message not found');
  return sendResponse(res, { data: doc });
});

export const adminUpdateContactMessage = catchAsync(async (req, res) => {
  const update = {};
  if (req.body.status !== undefined) {
    if (!CONTACT_STATUSES.includes(req.body.status)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid status');
    }
    update.status = req.body.status;
    if (req.body.status !== 'new') {
      update.handledBy = req.user?._id;
      update.handledAt = new Date();
    }
  }
  if (req.body.adminNote !== undefined) update.adminNote = String(req.body.adminNote);

  const doc = await ContactMessage.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!doc) throw new ApiError(StatusCodes.NOT_FOUND, 'Message not found');
  return sendResponse(res, { data: doc, message: 'Message updated' });
});

export const adminDeleteContactMessage = catchAsync(async (req, res) => {
  const doc = await ContactMessage.findByIdAndDelete(req.params.id);
  if (!doc) throw new ApiError(StatusCodes.NOT_FOUND, 'Message not found');
  return sendResponse(res, { message: 'Message deleted' });
});

export const getContactMeta = catchAsync(async (_req, res) =>
  sendResponse(res, { data: { categories: CONTACT_CATEGORIES, statuses: CONTACT_STATUSES } })
);
