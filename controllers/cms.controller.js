import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import Blog from '../models/blog.model.js';
import Faq from '../models/faq.model.js';
import CmsPage from '../models/cmsPage.model.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';

// =========== Blog ===========
export const listBlogs = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { isPublished: true };
  if (req.query.type) filter.type = req.query.type;
  const total = await Blog.countDocuments(filter);
  const items = await Blog.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const getBlog = catchAsync(async (req, res) => {
  const blog = await Blog.findById(req.params.id).lean();
  if (!blog) throw new ApiError(StatusCodes.NOT_FOUND, 'Blog not found');
  return sendResponse(res, { data: blog });
});

export const createBlog = catchAsync(async (req, res) => {
  const data = { ...req.body };
  if (req.files?.profile) {
    const r = await uploadBufferToCloudinary(req.files.profile[0].buffer, 'blog-author', 'image');
    data.profilePicture = r.secure_url;
  }
  if (req.files?.thumbnail) {
    const r = await uploadBufferToCloudinary(req.files.thumbnail[0].buffer, 'blog-thumbnails', 'image');
    data.thumbnail = r.secure_url;
  }
  const blog = await Blog.create(data);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: blog });
});

export const updateBlog = catchAsync(async (req, res) => {
  const data = { ...req.body };
  if (req.files?.profile) {
    const r = await uploadBufferToCloudinary(req.files.profile[0].buffer, 'blog-author', 'image');
    data.profilePicture = r.secure_url;
  }
  if (req.files?.thumbnail) {
    const r = await uploadBufferToCloudinary(req.files.thumbnail[0].buffer, 'blog-thumbnails', 'image');
    data.thumbnail = r.secure_url;
  }
  const blog = await Blog.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!blog) throw new ApiError(StatusCodes.NOT_FOUND, 'Blog not found');
  return sendResponse(res, { data: blog });
});

export const deleteBlog = catchAsync(async (req, res) => {
  const blog = await Blog.findByIdAndDelete(req.params.id);
  if (!blog) throw new ApiError(StatusCodes.NOT_FOUND, 'Blog not found');
  return sendResponse(res, { message: 'Blog deleted' });
});

// =========== FAQ ===========
export const listFaqs = catchAsync(async (_req, res) => {
  const items = await Faq.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return sendResponse(res, { data: items });
});

export const adminListFaqs = catchAsync(async (_req, res) => {
  const items = await Faq.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return sendResponse(res, { data: items });
});

export const createFaq = catchAsync(async (req, res) => {
  const f = await Faq.create(req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: f });
});

export const updateFaq = catchAsync(async (req, res) => {
  const f = await Faq.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!f) throw new ApiError(StatusCodes.NOT_FOUND, 'FAQ not found');
  return sendResponse(res, { data: f });
});

export const deleteFaq = catchAsync(async (req, res) => {
  const f = await Faq.findByIdAndDelete(req.params.id);
  if (!f) throw new ApiError(StatusCodes.NOT_FOUND, 'FAQ not found');
  return sendResponse(res, { message: 'FAQ deleted' });
});

// =========== Pages ===========
const PAGE_SLUGS = ['privacy_policy', 'terms_of_service', 'about_app'];

export const getPage = catchAsync(async (req, res) => {
  const slug = req.params.slug;
  if (!PAGE_SLUGS.includes(slug)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid page slug');
  const page = await CmsPage.findOne({ slug });
  return sendResponse(res, { data: page });
});

export const upsertPage = catchAsync(async (req, res) => {
  const { slug } = req.params;
  if (!PAGE_SLUGS.includes(slug)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid page slug');
  const { title = slug, content = '' } = req.body;
  const page = await CmsPage.findOneAndUpdate(
    { slug },
    { $set: { title, content }, $setOnInsert: { slug } },
    { upsert: true, new: true }
  );
  return sendResponse(res, { data: page });
});
