import mongoose from 'mongoose';

const { Schema } = mongoose;

const blogSchema = new Schema(
  {
    authorName: { type: String, required: true },
    authorTitle: { type: String, default: '' },
    authorPhoto: { type: String, default: '' },
    type: { type: String, default: 'Meditation & Mindfulness' },
    title: { type: String, required: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    profilePicture: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    readMinutes: { type: Number, default: 6 },
    publishedAt: { type: Date, default: Date.now },
    isPublished: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

const Blog = mongoose.model('Blog', blogSchema);
export default Blog;
