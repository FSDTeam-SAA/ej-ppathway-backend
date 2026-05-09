import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CHAT_KIND = ['session', 'admin']; // session = in-session chat; admin = user<->admin support

const chatSchema = new Schema(
  {
    kind: { type: String, enum: CHAT_KIND, required: true, index: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    session: { type: Schema.Types.ObjectId, ref: 'Session' },

    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date },
    unreadCounts: { type: Map, of: Number, default: {} } // userId -> count
  },
  { timestamps: true }
);

chatSchema.index({ participants: 1 });

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
