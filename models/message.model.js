import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, default: '' },
    attachments: { type: [String], default: [] },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveredAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const Message = mongoose.model('Message', messageSchema);
export default Message;
