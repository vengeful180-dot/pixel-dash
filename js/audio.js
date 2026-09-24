/* Pixel Dash — tiny chiptune sound effects, synthesised with Web Audio. */
(function (root) {
  'use strict';

  let ac = null, master = null, crowdGain = null, noiseBuf = null;
  let muted = false;
  try { muted = root.localStorage && localStorage.getItem('pd-muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // crowd murmur: looping filtered noise
    const src = ac.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    crowdGain = ac.createGain();
    crowdGain.gain.value = 0;
    src.connect(bp); bp.connect(crowdGain); crowdGain.connect(master);
    src.start();
  }

  function tone(freq, dur, type, vol, slideTo, when) {
    if (!ac) return;
    const t = ac.currentTime + (when || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, vol, freq, type, when, sweepTo) {
    if (!ac) return;
    const t = ac.currentTime + (when || 0);
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(freq || 2000, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const Sfx = {
    init,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('pd-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.05);
    },
    crowd(level) {
      if (!crowdGain) return;
      crowdGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.22, ac.currentTime, 0.4);
    },
    beep() { tone(660, 0.14, 'square', 0.12); },
    bang() { noise(0.45, 0.9, 3000, 'lowpass', 0, 300); tone(90, 0.3, 'sine', 0.5, 35); },
    whistle() { tone(2100, 0.18, 'sine', 0.2); tone(2250, 0.35, 'sine', 0.2, 2100, 0.2); },
    thud() { tone(120, 0.18, 'sine', 0.4, 50); noise(0.12, 0.25, 600); },
    slip() { tone(900, 0.35, 'sine', 0.18, 180); },
    boing() { tone(180, 0.3, 'sine', 0.25, 620); },
    zap() { tone(1400, 0.6, 'sawtooth', 0.06, 180); tone(700, 0.6, 'square', 0.04, 1200); },
    bark() { tone(520, 0.07, 'square', 0.15, 380); tone(560, 0.08, 'square', 0.15, 400, 0.14); },
    buzz() { tone(210, 0.5, 'sawtooth', 0.05, 240); tone(230, 0.5, 'sawtooth', 0.05, 205); },
    whoosh() { noise(0.4, 0.3, 400, 'bandpass', 0, 3500); },
    gulp() { tone(300, 0.08, 'sine', 0.25, 160); tone(280, 0.08, 'sine', 0.25, 150, 0.14); },
    pop() { tone(500, 0.08, 'square', 0.15, 900); },
    click() { noise(0.05, 0.4, 5000, 'highpass'); tone(1800, 0.03, 'square', 0.05); },
    sneeze() { noise(0.35, 0.5, 1800, 'bandpass', 0, 500); },
    quack() { tone(420, 0.1, 'sawtooth', 0.08, 300); },
    cheer() {
      if (!crowdGain) return;
      crowdGain.gain.setTargetAtTime(0.45, ac.currentTime, 0.05);
      crowdGain.gain.setTargetAtTime(0.12, ac.currentTime + 1.5, 0.8);
    },
    drumroll(dur) {
      if (!ac) return;
      for (let t = 0; t < dur; t += 0.05) noise(0.06, 0.12 + 0.2 * (t / dur), 900, 'lowpass', t);
    },
    fanfare() {
      const notes = [[523, 0], [659, 0.13], [784, 0.26], [1047, 0.42], [784, 0.62], [1047, 0.75]];
      notes.forEach(([f, w], i) => tone(f, i === notes.length - 1 ? 0.7 : 0.16, 'square', 0.11, null, w));
      notes.forEach(([f, w], i) => tone(f / 2, i === notes.length - 1 ? 0.7 : 0.16, 'triangle', 0.12, null, w));
    },
    firework() { noise(0.6, 0.35, 1500, 'lowpass', 0, 200); },
    tick() { tone(1200, 0.04, 'square', 0.06); },
  };
  root.Sfx = Sfx;
})(typeof self !== 'undefined' ? self : this);
