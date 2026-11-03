// Shared add-on prices. Usage blocks are editable from Credits, while the
// legacy Settings form sends sessionRecording for both audio and video.
export const resolveCreditUsage = (usage = {}) => {
  const recording = Number(usage.sessionRecording ?? 5);
  return {
    chatTranscript: Number(usage.chatTranscript ?? 5),
    videoRecording: Number(usage.videoRecording ?? recording),
    audioRecording: Number(usage.audioRecording ?? recording),
    sessionRecording: recording
  };
};

export const recordingUnlockPrice = (type, usage) =>
  Math.ceil(type === 'video' ? usage.videoRecording : usage.audioRecording);

export const sessionUnlockPrices = (session, usage) => ({
  unlockChargeRecording: session.recordingPriceUnlocked
    ? session.unlockChargeRecording : recordingUnlockPrice(session.type, usage),
  unlockChargeTranscript: session.transcriptPriceUnlocked
    ? session.unlockChargeTranscript : Math.ceil(usage.chatTranscript)
});

export const syncUsageBlockPrices = (blocks, usage) => {
  const prices = {
    session_recording: usage.sessionRecording,
    video_recording: usage.videoRecording,
    audio_recording: usage.audioRecording,
    chat_transcript: usage.chatTranscript
  };
  return blocks.map((block) => ({
    ...(typeof block.toObject === 'function' ? block.toObject() : block),
    ...(Object.hasOwn(prices, block.id) ? { credits: prices[block.id] } : {})
  }));
};

export const updatedCreditUsage = (current, { blocks, patch } = {}) => {
  const usage = resolveCreditUsage(current);
  if (blocks) {
    const values = new Map(blocks.map((block) => [block.id, block.credits]));
    if (values.has('session_recording')) {
      usage.sessionRecording = usage.videoRecording = usage.audioRecording = values.get('session_recording');
    }
    if (values.has('video_recording')) usage.videoRecording = values.get('video_recording');
    if (values.has('audio_recording')) usage.audioRecording = values.get('audio_recording');
    if (values.has('chat_transcript')) usage.chatTranscript = values.get('chat_transcript');
  }
  if (patch) {
    for (const field of Object.keys(usage)) {
      if (!Object.hasOwn(patch, field)) continue;
      const value = Number(patch[field]);
      if (patch[field] == null || patch[field] === '' || !Number.isFinite(value) || value < 0) {
        throw Object.assign(new Error('Credit usage values must be non-negative numbers'), { statusCode: 400 });
      }
      usage[field] = value;
    }
    if (Object.hasOwn(patch, 'sessionRecording')) {
      if (!Object.hasOwn(patch, 'videoRecording')) usage.videoRecording = usage.sessionRecording;
      if (!Object.hasOwn(patch, 'audioRecording')) usage.audioRecording = usage.sessionRecording;
    }
  }
  usage.sessionRecording = Math.max(usage.videoRecording, usage.audioRecording);
  return usage;
};
