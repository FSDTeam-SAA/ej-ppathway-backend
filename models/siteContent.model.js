import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SITE_CONTENT_SLUGS = [
  'global',
  'home',
  'how-it-works',
  'advisors',
  'advisor-detail',
  'login',
  'signup',
  'join-as-advisor',
  'advisor-application',
  'ethical-standards',
  'reviews',
  'blogs',
  'about',
  'contact'
];

const siteContentSchema = new Schema(
  {
    pageSlug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      enum: SITE_CONTENT_SLUGS
    },
    pageName: { type: String, required: true },
    sections: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true, minimize: false }
);

const SiteContent = mongoose.model('SiteContent', siteContentSchema);
export default SiteContent;
