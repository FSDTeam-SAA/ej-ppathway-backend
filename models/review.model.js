import mongoose from 'mongoose';

const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    advisor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session', index: true },

    rating: { type: Number, min: 1, max: 5, required: true },
    breakdown: {
      accuracy: { type: Number, min: 0, max: 5, default: 0 },
      clarity: { type: Number, min: 0, max: 5, default: 0 },
      helpfulness: { type: Number, min: 0, max: 5, default: 0 },
      valuable: { type: Number, min: 0, max: 5, default: 0 },
      communication: { type: Number, min: 0, max: 5, default: 0 },
      professionalism: { type: Number, min: 0, max: 5, default: 0 },
      valueForMoney: { type: Number, min: 0, max: 5, default: 0 },
      expertise: { type: Number, min: 0, max: 5, default: 0 }
    },
    comment: { type: String, default: '' },
    sessionType: { type: String, enum: ['chat', 'call', 'video'] },

    // For admin-created showcase reviews (FAQ&Reviews mgmt)
    isAdminShowcase: { type: Boolean, default: false },
    showcaseName: { type: String },
    showcaseLocation: { type: String },
    showcasePhoto: { type: String }
  },
  { timestamps: true }
);

const Review = mongoose.model('Review', reviewSchema);
export default Review;
