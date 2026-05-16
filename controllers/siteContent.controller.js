import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import SiteContent, { SITE_CONTENT_SLUGS } from '../models/siteContent.model.js';
import {
  validateSiteContent,
  isValidSlug
} from '../validators/siteContent.schemas.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';

const ensureSlug = (slug) => {
  if (!isValidSlug(slug)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid page slug. Must be one of: ${SITE_CONTENT_SLUGS.join(', ')}`);
  }
};

const titleCase = (slug) =>
  slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const listSiteContent = catchAsync(async (_req, res) => {
  const items = await SiteContent.find().lean();
  return sendResponse(res, { data: items });
});

export const getSiteContent = catchAsync(async (req, res) => {
  ensureSlug(req.params.pageSlug);
  let doc = await SiteContent.findOne({ pageSlug: req.params.pageSlug }).lean();
  if (!doc) {
    // Auto-create empty document so first read never 404s.
    doc = await SiteContent.create({
      pageSlug: req.params.pageSlug,
      pageName: titleCase(req.params.pageSlug),
      sections: {}
    });
    doc = doc.toObject();
  }
  return sendResponse(res, { data: doc });
});

export const upsertSiteContent = catchAsync(async (req, res) => {
  const { pageSlug } = req.params;
  ensureSlug(pageSlug);

  let validated;
  try {
    validated = validateSiteContent(pageSlug, req.body?.sections ?? {});
  } catch (err) {
    const issues = err?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || err.message;
    throw new ApiError(StatusCodes.BAD_REQUEST, `Section validation failed — ${issues}`);
  }

  const pageName = req.body?.pageName || titleCase(pageSlug);

  const doc = await SiteContent.findOneAndUpdate(
    { pageSlug },
    {
      $set: {
        pageName,
        sections: validated,
        updatedBy: req.user?._id
      },
      $setOnInsert: { pageSlug }
    },
    { upsert: true, new: true }
  );

  return sendResponse(res, { data: doc, message: 'Site content updated' });
});

/**
 * Generic media upload helper used by admin forms.
 * Accepts a single file field named `file`; returns Cloudinary secure_url.
 * Folder defaults to `site-content/<pageSlug>/<sectionKey>`.
 */
export const uploadSiteContentMedia = catchAsync(async (req, res) => {
  const { pageSlug } = req.params;
  ensureSlug(pageSlug);

  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded (expected field name: file)');
  }

  const sectionKey = (req.body?.sectionKey || 'misc').replace(/[^a-z0-9-]/gi, '_').slice(0, 64);
  const folder = `site-content/${pageSlug}/${sectionKey}`;
  const isVideo = req.file.mimetype.startsWith('video/');
  const resourceType = isVideo ? 'video' : 'image';

  const result = await uploadBufferToCloudinary(req.file.buffer, folder, resourceType);

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    data: {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes
    },
    message: 'Upload complete'
  });
});
