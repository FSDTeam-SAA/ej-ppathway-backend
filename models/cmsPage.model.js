import mongoose from 'mongoose';

const { Schema } = mongoose;

// Stores: privacy_policy, terms_of_service, about_app
const cmsPageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    content: { type: String, default: '' }
  },
  { timestamps: true }
);

const CmsPage = mongoose.model('CmsPage', cmsPageSchema);
export default CmsPage;
