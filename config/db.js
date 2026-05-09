import mongoose from 'mongoose';

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
};

export default connectDB;
