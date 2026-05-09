export const generateOTP = (length = 4) => {
  const max = Math.pow(10, length);
  const num = Math.floor(Math.random() * max);
  return num.toString().padStart(length, '0');
};

export default generateOTP;
