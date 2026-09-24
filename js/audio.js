/* Pixel Dash — chiptune music and sound effects, synthesised with Web Audio. */
(function (root) {
  'use strict';

  let ac = null, master = null, musicBus = null, musicFilter = null, noiseBuf = null, analyser = null;
  let pulse25 = null, pulse12 = null;
  let muted = false;
  const MUSIC = 0.75; // music volume relative to effects
  const FX = 1.4;     // effects boost so they sit on top of the music
  try { muted = root.localStorage && localStorage.getItem('pd-muted') === '1'; } catch (e) { /* storage blocked */ }

  function pulseWave(duty) {
    const n = 40;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    return ac.createPeriodicWave(real, imag);
  }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ac.destination);
    analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    musicFilter = ac.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 9000;
    musicBus = ac.createGain();
    musicBus.gain.value = MUSIC;
    musicBus.connect(musicFilter);
    musicFilter.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    pulse25 = pulseWave(0.25);
    pulse12 = pulseWave(0.125);
    // pause everything while the tab is hidden (the race pauses too)
    document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      if (document.hidden) ac.suspend(); else ac.resume();
    });
  }

  function osc(type, freq, t, dur, vol, dest, opts) {
    opts = opts || {};
    const o = ac.createOscillator();
    const g = ac.createGain();
    if (type === 'p25') o.setPeriodicWave(pulse25);
    else if (type === 'p12') o.setPeriodicWave(pulse12);
    else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + dur);
    const a = opts.attack || 0.008;
    let end = t + dur;
    if (opts.hold) {
      // musical note: quick attack, settle to a held level, short release at the end
      const rel = opts.release || 0.04;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + a);
      g.gain.setTargetAtTime(vol * opts.hold, t + a, 0.05);
      g.gain.setTargetAtTime(0, Math.max(t + a + 0.01, t + dur - rel), rel / 3);
      end = t + dur + rel;
    } else {
      // plucky effect: decays over the whole duration
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    if (opts.vibrato && dur > 0.25) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(freq * 0.006, t + 0.2);
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(end + 0.05);
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // noise burst at absolute audio time t
  function noiseAt(t, dur, vol, freq, type, sweepTo, dest) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(freq || 2000, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // noise burst `when` seconds from now
  function noise(dur, vol, freq, type, when, sweepTo) {
    if (!ac) return;
    noiseAt(ac.currentTime + (when || 0), dur, (vol || 0.3) * FX, freq, type, sweepTo, master);
  }
  function tone(freq, dur, type, vol, slideTo, when) {
    if (!ac) return;
    osc(type || 'square', freq, ac.currentTime + (when || 0), dur, (vol || 0.15) * FX, master, { slideTo });
  }

  // ================================================================ the song
  // "Pixel Dash Theme": 16 bars, 112 BPM, C major. A section, then a B section that lifts.
  const BPM = 112;
  const STEP = 60 / BPM / 4; // one 16th note
  const PROG = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm|G', 'C', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C|G'];
  const CHORD = { C: [60, 64, 67], Am: [57, 60, 64], F: [57, 60, 65], G: [55, 59, 62], Dm: [57, 62, 65], Em: [55, 59, 64] };
  const ROOT = { C: 36, Am: 33, F: 41, G: 43, Dm: 38, Em: 40 };
  // melody per bar: [midi note (0 = rest), length in eighth notes]
  const MELODY = [
    [[67, 1], [72, 1], [76, 2], [74, 1], [72, 1], [74, 2]],
    [[76, 2], [69, 2], [72, 3], [0, 1]],
    [[69, 1], [72, 1], [77, 2], [76, 1], [74, 1], [72, 2]],
    [[74, 4], [71, 2], [67, 2]],
    [[67, 1], [72, 1], [76, 2], [74, 1], [72, 1], [74, 2]],
    [[76, 2], [79, 2], [76, 3], [0, 1]],
    [[77, 2], [76, 1], [74, 1], [71, 2], [74, 2]],
    [[72, 6], [0, 2]],
    [[81, 2], [79, 1], [77, 1], [72, 2], [77, 2]],
    [[79, 2], [77, 1], [76, 1], [74, 4]],
    [[76, 2], [74, 1], [71, 1], [67, 2], [71, 2]],
    [[72, 2], [71, 1], [69, 1], [76, 4]],
    [[81, 2], [79, 1], [77, 1], [72, 2], [77, 2]],
    [[79, 2], [81, 1], [79, 1], [77, 2], [74, 2]],
    [[76, 2], [79, 2], [84, 3], [0, 1]],
    [[79, 1], [76, 1], [74, 1], [72, 1], [74, 2], [67, 2]],
  ];
  const BARS = PROG.length;
  const melodyAt = {}; // absolute step -> [note, steps]
  MELODY.forEach((bar, b) => {
    let s = b * 16;
    for (const [note, len] of bar) { if (note) melodyAt[s] = [note, len * 2]; s += len * 2; }
  });

  const music = { timer: null, step: 0, next: 0, hype: false, loops: 0 };

  function playStep(step, t) {
    const bar = Math.floor(step / 16) % BARS, s = step % 16;
    const parts = PROG[bar].split('|');
    const ch = parts.length > 1 && s >= 8 ? parts[1] : parts[0];
    // bouncy bass: root / octave / fifth / octave on eighth notes
    if (s % 2 === 0) {
      const pat = [0, 12, 7, 12, 0, 12, 7, 12];
      osc('triangle', hz(ROOT[ch] + pat[s / 2]), t, STEP * 1.8, 0.34, musicBus, { hold: 0.7, release: 0.03 });
    }
    // off-beat chord stabs
    if (s % 4 === 2) for (const n of CHORD[ch]) osc('p12', hz(n), t, STEP * 1.3, 0.03, musicBus, { hold: 0.5, release: 0.03 });
    // melody (second time round it drops an octave for the A section, for variety)
    const m = melodyAt[(step % (BARS * 16))];
    if (m) {
      const oct = music.loops % 2 === 1 && bar < 8 ? -12 : 0;
      osc('p25', hz(m[0] + oct), t, m[1] * STEP * 0.95, 0.07, musicBus, { vibrato: true, hold: 0.75, release: 0.05 });
    }
    // drums
    if (s === 0 || s === 8 || (music.hype && s === 10)) osc('sine', 150, t, 0.14, 0.5, musicBus, { slideTo: 42 });
    if (s === 4 || s === 12) { noiseAt(t, 0.12, 0.16, 1800, 'bandpass', null, musicBus); osc('triangle', 190, t, 0.07, 0.1, musicBus); }
    if (s % 2 === 0 || music.hype) noiseAt(t, 0.03, s % 4 === 2 ? 0.06 : 0.035, 7500, 'highpass', null, musicBus);
    if (s === 0 && bar === 0 && music.loops > 0) noiseAt(t, 0.6, 0.08, 5000, 'highpass', null, musicBus);
  }

  function schedule() {
    if (!ac) return;
    if (music.next < ac.currentTime - 0.1) music.next = ac.currentTime + 0.02;
    while (music.next < ac.currentTime + 0.15) {
      playStep(music.step, music.next);
      music.next += STEP;
      music.step++;
      if (music.step % (BARS * 16) === 0) music.loops++;
    }
  }

  const Sfx = {
    init,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('pd-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ac.currentTime, 0.05);
    },

    // ---- music controls
    musicStart() {
      if (!ac) return;
      Sfx.musicStop();
      music.step = 0; music.loops = 0; music.hype = false;
      music.next = ac.currentTime + 0.05;
      musicBus.gain.cancelScheduledValues(ac.currentTime);
      musicBus.gain.setValueAtTime(MUSIC, ac.currentTime);
      musicFilter.frequency.setValueAtTime(9000, ac.currentTime);
      music.timer = setInterval(schedule, 25);
      schedule();
    },
    musicStop() {
      if (music.timer) clearInterval(music.timer);
      music.timer = null;
    },
    musicHype(on) { music.hype = !!on; },
    // level 0..1 of the normal music volume; muffle = slow-motion underwater feel
    musicMix(level, muffle) {
      if (!ac) return;
      musicBus.gain.setTargetAtTime(MUSIC * level, ac.currentTime, 0.15);
      musicFilter.frequency.setTargetAtTime(muffle ? 650 : 9000, ac.currentTime, 0.12);
    },

    // ---- effects
    beep() { tone(660, 0.14, 'square', 0.12); },
    go() { tone(990, 0.35, 'square', 0.12); },
    bang() { noise(0.45, 0.55, 3000, 'lowpass', 0, 300); tone(90, 0.3, 'sine', 0.35, 35); },
    whistle() { tone(2100, 0.18, 'sine', 0.2); tone(2250, 0.35, 'sine', 0.2, 2100, 0.2); },
    thud() { tone(120, 0.18, 'sine', 0.4, 50); noise(0.12, 0.25, 600); },
    slip() { tone(900, 0.35, 'sine', 0.18, 180); },
    boing() { tone(180, 0.3, 'sine', 0.25, 620); },
    zap() { tone(1400, 0.6, 'sawtooth', 0.05, 180); tone(700, 0.6, 'square', 0.035, 1200); },
    bark() { tone(520, 0.07, 'square', 0.13, 380); tone(560, 0.08, 'square', 0.13, 400, 0.14); },
    buzz() { tone(210, 0.5, 'sawtooth', 0.045, 240); tone(230, 0.5, 'sawtooth', 0.045, 205); },
    whoosh() { noise(0.4, 0.25, 400, 'bandpass', 0, 3500); },
    gulp() { tone(300, 0.08, 'sine', 0.25, 160); tone(280, 0.08, 'sine', 0.25, 150, 0.14); },
    pop() { tone(500, 0.08, 'square', 0.12, 900); },
    click() { noise(0.05, 0.35, 5000, 'highpass'); tone(1800, 0.03, 'square', 0.05); },
    sneeze() { noise(0.35, 0.45, 1800, 'bandpass', 0, 500); },
    quack() { tone(420, 0.1, 'sawtooth', 0.07, 300); },
    ring() { for (let k = 0; k < 3; k++) { tone(1320, 0.07, 'square', 0.06, null, k * 0.16); tone(1100, 0.07, 'square', 0.06, null, k * 0.16 + 0.07); } },
    // short burst of applause (no continuous crowd noise)
    cheer(strength) {
      if (!ac) return;
      const n = Math.round(45 * (strength || 1));
      for (let k = 0; k < n; k++) {
        const w = Math.pow(Math.random(), 1.6) * 1.6;
        noise(0.015 + Math.random() * 0.02, 0.05 + Math.random() * 0.06, 1200 + Math.random() * 2600, 'bandpass', w);
      }
    },
    drumroll(dur) {
      if (!ac) return;
      for (let t = 0; t < dur; t += 0.045) noise(0.05, 0.1 + 0.18 * (t / dur), 900, 'lowpass', t);
      noise(0.8, 0.22, 6000, 'highpass', dur);
    },
    fanfare() {
      const notes = [[523, 0], [659, 0.13], [784, 0.26], [1047, 0.42], [784, 0.62], [1047, 0.75]];
      notes.forEach(([f, w], i) => tone(f, i === notes.length - 1 ? 0.8 : 0.16, 'square', 0.1, null, w));
      notes.forEach(([f, w], i) => tone(f / 2, i === notes.length - 1 ? 0.8 : 0.16, 'triangle', 0.14, null, w));
    },
    firework() { noise(0.6, 0.25, 1500, 'lowpass', 0, 200); },
    tick() { tone(1200, 0.04, 'square', 0.06); },
    // current output loudness (RMS), handy for checking that sound is playing
    level() {
      if (!analyser) return 0;
      const d = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(d);
      let sum = 0, peak = 0;
      for (const x of d) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
      return { rms: Math.sqrt(sum / d.length), peak };
    },
  };
  root.Sfx = Sfx;
})(typeof self !== 'undefined' ? self : this);
