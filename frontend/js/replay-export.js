(function (root) {
  'use strict';
  const FPS = 30;
  const SAMPLE_RATE = 48000;
  // Same soft triangle click / sine thud as UI.AudioManager, generated in
  // small PCM blocks so long replays don't allocate an entire audio buffer.
  function audioSamples(start, count, moveTypes) {
    const pcm = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const time = (start + i) / SAMPLE_RATE - 1;
      const move = Math.floor(time / 1.2);
      if (move < 0 || move >= moveTypes.length) continue;
      const t = time - move * 1.2;
      const wall = moveTypes[move] === 'wall';
      const duration = wall ? .05 : .1, frequency = wall ? 300 : 400;
      if (t < duration) {
        const phase = frequency * duration / Math.LN2 * (1 - Math.pow(.5, t / duration));
        // Fundamental plus filtered odd harmonics of the game's triangle wave.
        for (let h = 1; h <= 7; h += 2) pcm[i] += .2 * Math.pow(.05, t / duration) *
          8 / (Math.PI * Math.PI) * (h % 4 === 1 ? 1 : -1) *
          Math.sin(2 * Math.PI * phase * h) / (h * h * Math.sqrt(1 + Math.pow(frequency * h / 1000, 2)));
      }
      if (wall && t >= .03 && t < .18) pcm[i] += (.2 - .19 * (t - .03) / .15) * Math.sin(2 * Math.PI * 150 * (t - .03));
    }
    return pcm;
  }
  function timeline(moves) {
    if (!Number.isInteger(moves) || moves < 1) throw new Error('No moves to export');
    return { moves, frames: 30 + moves * 36 + 60 };
  }
  function frameAt(plan, n) {
    if (n < 0 || n >= plan.frames) throw new RangeError('Invalid frame');
    const timestamp = Math.round(n * 1000000 / FPS);
    const duration = Math.round((n + 1) * 1000000 / FPS) - timestamp;
    if (n < 30) return { move: 0, elapsed: 0, timestamp, duration };
    const offset = n - 30;
    return { move: Math.min(plan.moves, Math.floor(offset / 36) + 1),
      elapsed: offset >= plan.moves * 36 ? 1200 : (offset % 36) * 1000 / FPS,
      timestamp, duration };
  }
  async function render(options, env = root) {
    const { canvas, moves, draw, signal, onProgress = function () {} } = options;
    const width = options.width === 1080 ? 1080 : 720;
    const height = width * 16 / 9;
    const plan = timeline(moves);
    let encoder, audioEncoder, failure;
    const check = () => {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (failure) throw failure;
    };
    const wait = () => new Promise(resolve => setTimeout(resolve, 0));
    const abort = () => {
      for (const codec of [encoder, audioEncoder]) if (codec && codec.state !== 'closed') codec.close();
    };
    try {
      check();
      if (!env.VideoEncoder || !env.VideoFrame || !env.Mp4Muxer) throw new Error('MP4 export is not supported in this browser. Try current Chrome or Edge.');
      const config = { codec: 'avc1.420028', width, height, framerate: FPS,
        bitrate: width === 1080 ? 8000000 : 4000000, avc: { format: 'avc' } };
      const support = await env.VideoEncoder.isConfigSupported(config);
      check();
      if (!support.supported) throw new Error('H.264 export at this resolution is unavailable. Try 720p or another browser.');
      const audioConfig = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 96000 };
      if (options.sound) {
        if (!env.AudioEncoder || !env.AudioData || !(await env.AudioEncoder.isConfigSupported(audioConfig)).supported)
          throw new Error('Sound export is unavailable in this browser. Turn off game sound to export MP4.');
        if (!Array.isArray(options.moveTypes) || options.moveTypes.length !== moves) throw new Error('Missing move sounds');
        check();
      }
      canvas.width = width;
      canvas.height = height;
      const muxer = new env.Mp4Muxer.Muxer({ target: new env.Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width, height },
        ...(options.sound ? { audio: { codec: 'aac', sampleRate: SAMPLE_RATE, numberOfChannels: 1 } } : {}),
        fastStart: 'in-memory' });
      encoder = new env.VideoEncoder({ output(chunk, meta) {
        try { muxer.addVideoChunk(chunk, meta); } catch (err) { failure = err; }
      }, error(err) { failure = err; } });
      if (signal) signal.addEventListener('abort', abort, { once: true });
      encoder.configure(config);
      if (options.sound) {
        audioEncoder = new env.AudioEncoder({ output(chunk, meta) {
          try { muxer.addAudioChunk(chunk, meta); } catch (err) { failure = err; }
        }, error(err) { failure = err; } });
        audioEncoder.configure(audioConfig);
      }
      let audioPosition = 0;
      let lastDrain = Date.now();
      for (let n = 0; n < plan.frames; n++) {
        check();
        while (encoder.encodeQueueSize >= 4) {
          check();
          if (Date.now() - lastDrain > 30000) throw new Error('Video encoder stalled. Try 720p.');
          await wait();
        }
        lastDrain = Date.now();
        const info = frameAt(plan, n);
        draw(info, width, height);
        const frame = new env.VideoFrame(canvas, { timestamp: info.timestamp, duration: info.duration });
        try { encoder.encode(frame, { keyFrame: n % 60 === 0 }); } finally { frame.close(); }
        while (audioEncoder && audioPosition < (n + 1) * SAMPLE_RATE / FPS) {
          while (audioEncoder.encodeQueueSize >= 4) {
            check();
            if (Date.now() - lastDrain > 30000) throw new Error('Audio encoder stalled. Turn off game sound and retry.');
            await wait();
          }
          check();
          const count = Math.min(1024, plan.frames * SAMPLE_RATE / FPS - audioPosition);
          const data = new env.AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE,
            numberOfFrames: count, numberOfChannels: 1, timestamp: Math.round(audioPosition * 1000000 / SAMPLE_RATE),
            data: audioSamples(audioPosition, count, options.moveTypes) });
          try { audioEncoder.encode(data); } finally { data.close(); }
          audioPosition += count;
          lastDrain = Date.now();
        }
        if (n % 6 === 0) { onProgress(n / plan.frames * 95, 'Rendering'); await wait(); }
      }
      check();
      onProgress(95, 'Finalizing');
      let timeout;
      try {
        await Promise.race([Promise.all([encoder.flush(), ...(audioEncoder ? [audioEncoder.flush()] : [])]), new Promise((_, reject) => {
          timeout = setTimeout(() => { abort(); reject(new Error('Finalization timed out')); }, 30000);
        })]);
      } finally { clearTimeout(timeout); }
      check();
      muxer.finalize();
      onProgress(100, 'Ready');
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } catch (err) {
      check();
      throw err;
    } finally {
      if (signal) signal.removeEventListener('abort', abort);
      abort();
      canvas.width = canvas.height = 1;
    }
  }
  const api = { timeline, frameAt, render, audioSamples };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReplayExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
