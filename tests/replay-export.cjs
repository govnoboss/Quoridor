const assert = require('node:assert/strict');
const Export = require('../frontend/js/replay-export.js');
async function run() {
  const plan = Export.timeline(100);
  assert.equal(plan.frames, 3690);
  assert.equal(Export.frameAt(plan, 29).move, 0);
  assert.equal(Export.frameAt(plan, 30).move, 1);
  assert.equal(Export.frameAt(plan, 66).move, 2);
  let end = 0;
  for (let i = 0; i < plan.frames; i++) {
    const frame = Export.frameAt(plan, i);
    assert.equal(frame.timestamp, end);
    end += frame.duration;
  }
  assert.equal(end, 123000000);
  assert.equal(Export.frameAt(plan, plan.frames - 1).elapsed, 1200);
  assert.throws(() => Export.timeline(0));
  let closed = 0, framesClosed = 0, encoded = 0, finalized = 0, supported = true, fail = false;
  class Encoder {
    static async isConfigSupported(config) { assert.equal(config.framerate, 30); return { supported }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure() { this.state = 'configured'; }
    encode() { encoded++; if (fail) this.callbacks.error(new Error('encoder failed')); }
    async flush() {}
    close() { this.state = 'closed'; closed++; }
  }
  class Frame { close() { framesClosed++; } }
  class Muxer {
    constructor() { this.target = { buffer: new ArrayBuffer(8) }; }
    addVideoChunk() {}
    finalize() { finalized++; }
  }
  const env = { VideoEncoder: Encoder, VideoFrame: Frame, Mp4Muxer: { Muxer, ArrayBufferTarget: class {} } };
  const canvas = {};
  const blob = await Export.render({ canvas, moves: 1, width: 1080, draw() {} }, env);
  assert.equal(blob.type, 'video/mp4');
  assert.equal(encoded, 126);
  assert.equal(framesClosed, encoded);
  assert.equal(closed, 1);
  assert.equal(finalized, 1);
  assert.equal(canvas.width, 1);
  const controller = new AbortController();
  await assert.rejects(Export.render({ canvas, moves: 5, signal: controller.signal,
    draw() {}, onProgress() { controller.abort(); } }, env), { name: 'AbortError' });
  assert.equal(closed, 2);
  assert.equal(finalized, 1);
  supported = false;
  await assert.rejects(Export.render({ canvas, moves: 1, draw() {} }, env), /H.264/);
  assert.equal(closed, 2);
  supported = true;
  fail = true;
  await assert.rejects(Export.render({ canvas, moves: 1, draw() {} }, env), /encoder failed/);
  assert.equal(closed, 3);
  assert.equal(finalized, 1);
  fail = false;
  assert(Export.audioSamples(0, 48000, ['pawn', 'wall']).every(x => x === 0));
  assert(Export.audioSamples(48000, 4800, ['pawn', 'wall']).some(x => Math.abs(x) > .01));
  assert(Export.audioSamples(60000, 4800, ['pawn', 'wall']).every(x => x === 0));
  assert(Export.audioSamples(105600 + 4800, 1024, ['pawn', 'wall']).some(x => Math.abs(x) > .01));
  let audioClosed = 0, samples = 0, dataClosed = 0, audioFailure = false, audioSupported = true;
  class AudioEncoder {
    static async isConfigSupported() { return { supported: audioSupported }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure(config) { assert.equal(config.codec, 'mp4a.40.2'); this.state = 'configured'; }
    encode(data) {
      assert.equal(data.timestamp, Math.round(samples * 1000000 / 48000));
      samples += data.numberOfFrames;
      if (audioFailure) this.callbacks.error(new Error('audio failed'));
    }
    async flush() {}
    close() { this.state = 'closed'; audioClosed++; }
  }
  class AudioData {
    constructor(data) { Object.assign(this, data); assert.equal(data.data.length, data.numberOfFrames); }
    close() { dataClosed++; }
  }
  Object.assign(env, { AudioEncoder, AudioData });
  const audioOptions = { canvas, moves: 2, sound: true, moveTypes: ['pawn', 'wall'], draw() {} };
  await Export.render(audioOptions, env);
  assert.equal(samples, 259200); // exactly 5.4 seconds of PCM
  assert.equal(dataClosed, Math.ceil(samples / 1024));
  assert.equal(audioClosed, 1);
  samples = 0;
  const abortAudio = new AbortController();
  await assert.rejects(Export.render({ ...audioOptions, signal: abortAudio.signal,
    onProgress() { abortAudio.abort(); } }, env), { name: 'AbortError' });
  assert.equal(audioClosed, 2);
  samples = 0;
  audioFailure = true;
  await assert.rejects(Export.render(audioOptions, env), /audio failed/);
  assert.equal(audioClosed, 3);
  audioFailure = false;
  audioSupported = false;
  await assert.rejects(Export.render(audioOptions, env), /Turn off game sound/);
  await Export.render({ ...audioOptions, sound: false }, env);
  return 'PASS: timing, video/audio lifecycle, PCM sound timing, cancellation, retry, unsupported codecs and cleanup';
}
module.exports = run;
if (require.main === module) run().then(console.log).catch(err => { console.error(err); process.exitCode = 1; });
