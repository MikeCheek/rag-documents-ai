// Whisper expects mono PCM audio at 16kHz as a plain Float32Array. A
// MediaRecorder produces a compressed blob (webm/opus in Chrome, mp4/aac
// in Safari) at whatever sample rate the mic captured — decoding through
// an AudioContext constructed with sampleRate: 16000 gets both the format
// conversion and the resampling in one step, since decodeAudioData
// resamples to match the context it's decoding into.
export async function blobToWhisperInput(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextCtor({ sampleRate: 16000 });

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    // Mono only — average all channels down to one rather than just
    // taking channel 0, so nothing is lost if a browser/device happens to
    // record in stereo.
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0);
    }

    const channels: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    const mono = new Float32Array(audioBuffer.length);
    for (let i = 0; i < audioBuffer.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      mono[i] = sum / channels.length;
    }
    return mono;
  } finally {
    audioContext.close();
  }
}
