import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CONTACT_CATEGORIES = [
  'General Inquiry',
  'Technical Support',
  'Billing Question',
  'Advisor Application',
  'Report an issue',
  'Others'
];

export const CONTACT_STATUSES = ['new', 'in_progress', 'resolved', 'archived'];

const contactMessageSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: '', trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, default: '', trim: true },
    subject: { type: String, default: '', trim: true },
    category: { type: String, default: 'General Inquiry' },
    message: { type: String, required: true },

    status: { type: String, enum: CONTACT_STATUSES, default: 'new', index: true },
    adminNote: { type: String, default: '' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    handledAt: { type: Date }
  },
  { timestamps: true }
);

contactMessageSchema.index({ createdAt: -1 });

const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
export default ContactMessage;
