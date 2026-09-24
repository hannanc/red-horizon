// Red Horizon: synthesised sound effects. WebAudio only, no sample files. Every sound goes through one bus with a
// compressor (a big battle doesn't clip), is panned and faded by where it happens relative to the camera, varies a
// little in pitch, and busy sounds are capped (a minimum gap and a most-at-once per type).
import {isoAt, settings, state} from './data.js';
import {VH, VW} from './render.js';

export let AC = null;
let bus = null;
// the live context, made on the first user gesture (browsers keep audio off until then)
export function audio(){
  if(!AC){
    AC = new (window.AudioContext || window.webkitAudioContext)();
    bus = makeBus(AC);
  }
  if(AC.state === 'suspended') AC.resume();
  return AC;
}
function makeBus(ac){
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
  const g = ac.createGain();
  g.gain.value = 0.55;
  g.connect(comp); comp.connect(ac.destination);
  return g;
}
// two seconds of white noise per context, looped with a random start
const noiseBufs = new WeakMap();
function noiseBuf(ac){
  let b = noiseBufs.get(ac);
  if(!b){
    b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = b.getChannelData(0);
    for(let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ac, b);
  }
  return b;
}

// ---------- building blocks ----------
// quick attack, exponential decay
function env(g, t, peak, a, d){
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
// an oscillator gliding from f0 to f1, with optional vibrato and a lowpass
function tone(ac, out, t, {type = 'sine', f0, f1 = f0, dur, vol, a = 0.004, vib = 0, vibF = 0, lp = 0}){
  const o = ac.createOscillator(), g = ac.createGain(), end = t + a + dur + 0.05;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if(f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + dur);
  if(vib){
    const l = ac.createOscillator(), lg = ac.createGain();
    l.frequency.value = vibF; lg.gain.value = vib;
    l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(end);
  }
  let node = o;
  if(lp){ const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
  env(g, t, vol, a, dur);
  node.connect(g); g.connect(out);
  o.start(t); o.stop(end);
}
// filtered noise, the filter sweeping f0 -> f1; `gate` chops it with a square wave (electric crackle)
function noise(ac, out, t, {dur, vol, type = 'lowpass', f0 = 1000, f1 = f0, q = 0.7, a = 0.003, gate = 0}){
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), end = t + a + dur + 0.05;
  s.buffer = noiseBuf(ac); s.loop = true;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if(f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + dur);
  env(g, t, vol, a, dur);
  s.connect(f); f.connect(g);
  if(gate){
    const m = ac.createGain(), l = ac.createOscillator(), lg = ac.createGain();
    m.gain.value = 0.5; lg.gain.value = 0.5; l.type = 'square'; l.frequency.value = gate;
    l.connect(lg); lg.connect(m.gain); g.connect(m); m.connect(out);
    l.start(t); l.stop(end);
  } else g.connect(out);
  s.start(t, Math.random() * 1.9); s.stop(end);
}
// a struck bell: the fundamental and two inharmonic partials
function bell(ac, out, t, f, vol, dur = 0.5){
  tone(ac, out, t, {f0: f, dur, vol});
  tone(ac, out, t, {f0: f * 2.76, dur: dur * 0.36, vol: vol * 0.35});
  tone(ac, out, t, {f0: f * 5.4, dur: dur * 0.16, vol: vol * 0.15});
}

// ---------- the sounds ----------
// each is (context, output, start time, pitch variation, size); `ui` sounds ignore position,
// `gap` is the least time between two of the kind, `max` how many may ring at once, `dur` how long one rings
const boomAt = (ac, o, t, v, sz) => {
  tone(ac, o, t, {f0: 85 * v, f1: 28, dur: 0.5 * sz, vol: 0.9});
  noise(ac, o, t, {dur: 0.8 * sz, vol: 0.8, f0: 2600 * v, f1: 160});
  noise(ac, o, t + 0.04, {dur: 0.12, vol: 0.22, type: 'highpass', f0: 1500});
};
export const SOUNDS = {
  shoot:   {gap: 0.03, max: 6, dur: 0.1, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.07, vol: 0.9, type: 'bandpass', f0: 1700 * v, q: 0.9});
    tone(ac, o, t, {type: 'square', f0: 160 * v, f1: 55, dur: 0.05, vol: 0.12, lp: 900});
  }},
  cannon:  {gap: 0.05, max: 4, dur: 0.35, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.03, vol: 0.35, type: 'highpass', f0: 2500});
    tone(ac, o, t, {f0: 110 * v, f1: 38, dur: 0.32, vol: 0.6});
    noise(ac, o, t, {dur: 0.28, vol: 0.55, f0: 1400 * v, f1: 220});
  }},
  rocket:  {gap: 0.06, max: 4, dur: 0.5, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.05, vol: 0.35, type: 'bandpass', f0: 900 * v});
    noise(ac, o, t + 0.02, {dur: 0.45, vol: 0.35, type: 'bandpass', f0: 500 * v, f1: 2600, q: 1.2, a: 0.04});
  }},
  flak:    {gap: 0.05, max: 4, dur: 0.15, play(ac, o, t, v){
    for(const d of [0, 0.09]){
      noise(ac, o, t + d, {dur: 0.045, vol: 0.45, type: 'highpass', f0: 2200 * v});
      tone(ac, o, t + d, {f0: 300 * v, f1: 120, dur: 0.05, vol: 0.2});
    }
  }},
  torpedo: {gap: 0.1, max: 3, dur: 0.55, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.5, vol: 0.3, f0: 500, f1: 200, a: 0.05});
    tone(ac, o, t, {f0: 240 * v, f1: 90, dur: 0.45, vol: 0.25, vib: 30, vibF: 18});
  }},
  zap:     {gap: 0.05, max: 4, dur: 0.25, play(ac, o, t, v){
    tone(ac, o, t, {type: 'sawtooth', f0: 1500 * v, f1: 950, dur: 0.2, vol: 0.16, lp: 3500, vib: 60, vibF: 40});
    tone(ac, o, t, {type: 'sawtooth', f0: 1512 * v, f1: 958, dur: 0.2, vol: 0.16, lp: 3500});
    tone(ac, o, t, {f0: 3000 * v, f1: 2200, dur: 0.15, vol: 0.08});
  }},
  arc:     {gap: 0.06, max: 3, dur: 0.32, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.3, vol: 0.5, type: 'bandpass', f0: 3200 * v, q: 1.5, gate: 55});
    tone(ac, o, t, {type: 'sawtooth', f0: 95 * v, dur: 0.28, vol: 0.12, lp: 1200});
  }},
  mind:    {gap: 0.2, max: 2, dur: 0.75, play(ac, o, t, v){
    tone(ac, o, t, {f0: 330 * v, f1: 880, dur: 0.6, vol: 0.09, a: 0.12, vib: 8, vibF: 6});
    tone(ac, o, t, {f0: 333 * v, f1: 886, dur: 0.6, vol: 0.09, a: 0.12});
  }},
  rad:     {gap: 0.08, max: 3, dur: 0.32, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.3, vol: 0.25, type: 'highpass', f0: 4500, gate: 90});
    tone(ac, o, t, {f0: 700 * v, f1: 500, dur: 0.25, vol: 0.1, vib: 40, vibF: 25});
  }},
  snipe:   {gap: 0.1, max: 2, dur: 0.5, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.025, vol: 0.7, type: 'highpass', f0: 1800});
    tone(ac, o, t, {f0: 1900 * v, f1: 180, dur: 0.12, vol: 0.25});
    for(const k of [1, 2]) noise(ac, o, t + 0.16 * k, {dur: 0.1, vol: 0.18 / k, type: 'bandpass', f0: 900});   // echo off the hills
  }},
  bite:    {gap: 0.08, max: 3, dur: 0.15, play(ac, o, t, v){
    tone(ac, o, t, {type: 'sawtooth', f0: 240 * v, f1: 110, dur: 0.12, vol: 0.2, lp: 1400});
    noise(ac, o, t, {dur: 0.06, vol: 0.2, f0: 900});
  }},
  bark:    {gap: 0.3, max: 1, dur: 0.3, play(ac, o, t, v){
    for(const d of [0, 0.15]) tone(ac, o, t + d, {type: 'sawtooth', f0: 520 * v, f1: 250, dur: 0.09, vol: 0.2, lp: 2000});
  }},
  chirp:   {gap: 0.2, max: 1, dur: 0.2, play(ac, o, t, v){
    for(let i = 0; i < 4; i++) tone(ac, o, t + i * 0.045, {type: 'square', f0: (i % 2 ? 1400 : 2100) * v, dur: 0.04, vol: 0.06, lp: 4000});
  }},
  latch:   {gap: 0.2, max: 2, dur: 0.2, play(ac, o, t, v){
    for(let i = 0; i < 4; i++) tone(ac, o, t + i * 0.045, {type: 'square', f0: (i % 2 ? 700 : 1050) * v, dur: 0.04, vol: 0.08, lp: 3000});
    noise(ac, o, t + 0.18, {dur: 0.08, vol: 0.3, type: 'bandpass', f0: 1200, q: 3});
  }},
  missile: {gap: 0.2, max: 2, dur: 1.05, play(ac, o, t, v){
    noise(ac, o, t, {dur: 1.0, vol: 0.4, type: 'bandpass', f0: 350 * v, f1: 1600, q: 1, a: 0.06});
    tone(ac, o, t, {type: 'sawtooth', f0: 70, dur: 0.6, vol: 0.12, lp: 300});
  }},
  bomb:    {gap: 0.2, max: 2, dur: 0.75, play(ac, o, t, v){
    tone(ac, o, t, {f0: 1500 * v, f1: 400, dur: 0.7, vol: 0.12, a: 0.05});
  }},
  explosion: {gap: 0.04, max: 6, dur: 0.9, play(ac, o, t, v, sz){ boomAt(ac, o, t, v, sz); }},
  collapse:  {gap: 0.1, max: 3, dur: 1.8, play(ac, o, t, v){
    boomAt(ac, o, t, v, 1.6);
    noise(ac, o, t + 0.1, {dur: 1.6, vol: 0.5, f0: 300, f1: 80, a: 0.1});
  }},
  death:   {gap: 0.05, max: 4, dur: 0.15, play(ac, o, t, v){
    noise(ac, o, t, {dur: 0.12, vol: 0.35, f0: 700 * v, f1: 200});
    tone(ac, o, t, {f0: 150 * v, f1: 70, dur: 0.1, vol: 0.25});
  }},
  blink:   {gap: 0.1, max: 3, dur: 0.3, play(ac, o, t, v){
    tone(ac, o, t, {f0: 300 * v, f1: 2400, dur: 0.25, vol: 0.15});
    tone(ac, o, t + 0.05, {type: 'triangle', f0: 1200 * v, f1: 4800, dur: 0.2, vol: 0.06});
  }},
  // interface and announcer cues
  ready:   {ui: true, gap: 0.15, max: 2, dur: 0.6, play(ac, o, t){ bell(ac, o, t, 660, 0.22); bell(ac, o, t + 0.13, 990, 0.2); }},
  built:   {ui: true, gap: 0.2, max: 1, dur: 0.8, play(ac, o, t){ [523, 659, 784].forEach((f, i) => bell(ac, o, t + i * 0.1, f, 0.18)); }},
  place:   {ui: true, gap: 0.1, max: 2, dur: 0.25, play(ac, o, t){
    tone(ac, o, t, {f0: 150, f1: 55, dur: 0.18, vol: 0.5});
    noise(ac, o, t, {dur: 0.12, vol: 0.35, f0: 700});
  }},
  deploy:  {ui: true, gap: 0.3, max: 1, dur: 1.2, play(ac, o, t){
    tone(ac, o, t, {type: 'sawtooth', f0: 60, f1: 130, dur: 0.5, vol: 0.15, lp: 500});
    for(const d of [0.1, 0.3, 0.55]) noise(ac, o, t + d, {dur: 0.05, vol: 0.3, type: 'bandpass', f0: 1200, q: 3});
    bell(ac, o, t + 0.65, 784, 0.18);
  }},
  cash:    {ui: true, gap: 0.12, max: 2, dur: 0.25, play(ac, o, t){
    tone(ac, o, t, {f0: 1320, dur: 0.08, vol: 0.12});
    tone(ac, o, t + 0.06, {f0: 1760, dur: 0.15, vol: 0.12});
    noise(ac, o, t, {dur: 0.02, vol: 0.1, type: 'highpass', f0: 5000});
  }},
  alert:   {ui: true, gap: 0.8, max: 1, dur: 0.75, play(ac, o, t){
    for(let i = 0; i < 4; i++) tone(ac, o, t + i * 0.18, {type: 'square', f0: i % 2 ? 330 : 440, dur: 0.16, vol: 0.1, lp: 1800});
  }},
  deny:    {ui: true, gap: 0.2, max: 1, dur: 0.3, play(ac, o, t){
    tone(ac, o, t, {type: 'sawtooth', f0: 120, dur: 0.12, vol: 0.15, lp: 800});
    tone(ac, o, t + 0.12, {type: 'sawtooth', f0: 90, dur: 0.14, vol: 0.15, lp: 800});
  }},
  click:   {ui: true, gap: 0.03, max: 2, dur: 0.05, play(ac, o, t){
    noise(ac, o, t, {dur: 0.012, vol: 0.2, type: 'highpass', f0: 4000});
    tone(ac, o, t, {f0: 1100, dur: 0.03, vol: 0.08});
  }},
  powerdown: {ui: true, gap: 1, max: 1, dur: 0.75, play(ac, o, t){ tone(ac, o, t, {type: 'sawtooth', f0: 500, f1: 90, dur: 0.7, vol: 0.12, lp: 1400}); }},
  win:     {ui: true, gap: 1, max: 1, dur: 1.4, play(ac, o, t){ [523, 659, 784, 1047].forEach((f, i) => bell(ac, o, t + i * 0.14, f, 0.2, i === 3 ? 1 : 0.5)); }},
  lose:    {ui: true, gap: 1, max: 1, dur: 1.2, play(ac, o, t){
    [392, 311, 262].forEach((f, i) => tone(ac, o, t + i * 0.25, {type: 'triangle', f0: f, dur: i === 2 ? 0.7 : 0.3, vol: 0.2, lp: 1500}));
  }},
};

// how loud and where: full volume in view, fading to nothing 1.5 screens beyond it; panned by screen x
function placeSound(at){
  if(!at) return {gain: 1, pan: 0};
  const p = isoAt(at.x, at.y), hw = Math.max(1, VW / 2), hh = Math.max(1, VH / 2);
  const dx = (p.x - state.camX - hw) / hw, dy = (p.y - state.camY - hh) / hh;
  const d = Math.hypot(dx, dy);
  return {gain: d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 1.5), pan: Math.max(-0.8, Math.min(0.8, dx * 0.6))};
}

// what played lately (for tests): {type, gain, pan} or {type, skip}
export const sfxLog = [];
const logSfx = e => { sfxLog.push(e); if(sfxLog.length > 300) sfxLog.shift(); };
const lastAt = {}, ringing = {};

// play a sound; `at` is where it happens in the world (a unit, building or {x, y}), left out for interface sounds
export function sfx(type, at, size = 1){
  const s = SOUNDS[type];
  if(!s) return;
  if(!state.sndOn || !state.started || settings.sfx < 0.01){ logSfx({type, skip: 'muted'}); return; }
  const {gain, pan} = placeSound(s.ui ? null : at);
  if(gain < 0.05){ logSfx({type, skip: 'far'}); return; }
  try{
    const ac = audio(), t = ac.currentTime, now = performance.now() / 1000;   // wall time: a suspended context's clock stands still
    const on = (ringing[type] || []).filter(e => e > now);
    if(now - (lastAt[type] ?? -1) < s.gap || on.length >= s.max){ ringing[type] = on; logSfx({type, skip: 'busy'}); return; }
    lastAt[type] = now; on.push(now + s.dur); ringing[type] = on;
    const out = ac.createGain();
    out.gain.value = gain * settings.sfx;
    if(pan && ac.createStereoPanner){ const p = ac.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(bus); }
    else out.connect(bus);
    s.play(ac, out, t + 0.005, s.ui ? 1 : 0.94 + Math.random() * 0.12, size);
    logSfx({type, gain, pan});
  }catch(e){ logSfx({type, skip: 'error'}); }
}

// render one sound offline (no speakers needed) and measure it, for tests: peak and RMS level, how long it rings
export async function renderSfx(type, size = 1){
  const rate = 22050, ac = new OfflineAudioContext(2, rate * 2.5, rate);
  SOUNDS[type].play(ac, makeBus(ac), 0.01, 1, size);
  const buf = await ac.startRendering(), d = buf.getChannelData(0);
  let peak = 0, sum = 0, last = 0;
  for(let i = 0; i < d.length; i++){ const a = Math.abs(d[i]); if(a > peak) peak = a; sum += a * a; if(a > 0.003) last = i; }
  return {peak, rms: Math.sqrt(sum / d.length), len: last / rate};
}
