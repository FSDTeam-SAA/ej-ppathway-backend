import mongoose from 'mongoose';

const { Schema } = mongoose;

const favoriteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    advisor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, advisor: 1 }, { unique: true });

const Favorite = mongoose.model('Favorite', favoriteSchema);
export default Favorite;
