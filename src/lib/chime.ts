// Tessera's startup sound, synthesised on the spot (no audio file, no licence):
// six soft plucks climb a D-major pentatonic as the mosaic tiles land, then a
// slow Dadd9 chord blooms under them in a long, warm room.

type Bus = (n: AudioNode) => void;

function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function pluck(ctx: AudioContext, bus: Bus, freq: number, at: number, level: number, length = 1.3) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(4200, at);
  lp.frequency.exponentialRampToValueAtTime(900, at + length);
  lp.connect(g);
  bus(g);
  for (const [type, mult, vol] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3.01, 0.08]] as const) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = vol;
    o.connect(og).connect(lp);
    o.start(at);
    o.stop(at + length + 0.05);
  }
}

function pad(ctx: AudioContext, bus: Bus, freq: number, at: number, length: number, level: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.55);
  g.gain.setValueAtTime(level, at + length * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(260, at);
  lp.frequency.exponentialRampToValueAtTime(1900, at + 1.1);
  lp.frequency.exponentialRampToValueAtTime(700, at + length);
  lp.connect(g);
  bus(g);
  for (const cents of [-5, 5]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = cents;
    const og = ctx.createGain();
    og.gain.value = 0.5;
    o.connect(og).connect(lp);
    o.start(at);
    o.stop(at + length + 0.05);
  }
}

export function playChime(volume: number) {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || volume <= 0) return;
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return; }
  ctx.resume().catch(() => { /* autoplay blocked: stay silent */ });
  const t = ctx.currentTime + 0.06;

  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume) * 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  master.connect(comp).connect(ctx.destination);

  const room = ctx.createConvolver();
  room.buffer = impulse(ctx, 3.4, 2.8);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  room.connect(wet).connect(master);
  const dry = ctx.createGain();
  dry.gain.value = 0.75;
  dry.connect(master);
  const bus: Bus = (n) => { n.connect(dry); n.connect(room); };

  // the tiles landing: D5 E5 F#5 A5 B5 D6
  [587.33, 659.25, 739.99, 880, 987.77, 1174.66].forEach((f, i) => pluck(ctx, bus, f, t + i * 0.085, 0.15 - i * 0.012));
  // the bloom: D3 A3 D4 F#4 A4 E5
  [146.83, 220, 293.66, 369.99, 440, 659.25].forEach((f, i) => pad(ctx, bus, f, t + 0.7 + i * 0.025, 3.2, i < 2 ? 0.1 : 0.06));
  // one high note on top as the name appears
  pluck(ctx, bus, 1479.98, t + 1.05, 0.05, 2.4);

  window.setTimeout(() => { ctx.close().catch(() => {}); }, 6000);
}
