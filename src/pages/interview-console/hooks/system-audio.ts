export type SystemAudioCapture = {
  label: string;
  stop: () => Promise<void>;
};

/** Captures only browser-selected display/system audio and emits 16 kHz mono PCM chunks. */
export async function startSystemAudioCapture(
  handleChunk: (chunk: ArrayBuffer) => void,
  handleEnded: () => void,
): Promise<SystemAudioCapture> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("当前浏览器不支持系统音频共享，请使用最新版 Chrome。 ");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("没有获取到系统音频。共享时请勾选“同时分享系统音频”。");
  }

  const audioContext = new AudioContext({ sampleRate: 16_000 });
  await audioContext.audioWorklet.addModule("/pcm-capture.worklet.js");
  const sourceNode = audioContext.createMediaStreamSource(
    new MediaStream([audioTrack]),
  );
  const processorNode = new AudioWorkletNode(audioContext, "pcm-capture");
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  processorNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    handleChunk(event.data);
  };
  sourceNode.connect(processorNode).connect(silentGain).connect(audioContext.destination);
  audioTrack.addEventListener("ended", handleEnded, { once: true });

  /** Releases every browser capture resource without touching microphone devices. */
  async function stop() {
    audioTrack.removeEventListener("ended", handleEnded);
    processorNode.disconnect();
    sourceNode.disconnect();
    silentGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    if (audioContext.state !== "closed") {
      await audioContext.close();
    }
  }

  return { label: audioTrack.label || "共享的系统音频", stop };
}
