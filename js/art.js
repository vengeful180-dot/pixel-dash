/* Pixel Dash — pixel art.
 * Runners are drawn from a tiny skeleton (joint angles -> chunky pixel limbs)
 * so every gag can have its own pose without hand-drawing hundreds of frames.
 * Props are small hand-made pixel maps. Everything gets a dark outline so it
 * stays readable on the busy track. */
(function (root) {
  'use strict';

  const OUTLINE = [20, 12, 28];

  // ---------------------------------------------------------------- colour helpers
  function rgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex(c) {
    return '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  }
  function shade(hex, f) {
    const c = rgb(hex);
    return toHex(f < 1 ? c.map((x) => x * f) : c.map((x) => x + (255 - x) * (f - 1)));
  }
  function mix(a, b, t) {
    const ca = rgb(a), cb = rgb(b);
    return toHex(ca.map((x, i) => x + (cb[i] - x) * t));
  }

  function canvas(w, h) {
    const c = typeof OffscreenCanvas !== 'undefined' && !root.document
      ? new OffscreenCanvas(w, h)
      : root.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Adds a 1px dark outline around every opaque pixel.
  function outline(c, color) {
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) src[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    const col = color || OUTLINE;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i]) continue;
        if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) {
          d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Pixel map -> canvas. rows: array of strings, pal: {char: '#hex'}; '.' = transparent.
  function pixmap(rows, pal, doOutline) {
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    const pad = doOutline ? 1 : 0;
    const c = canvas(w + pad * 2, h + pad * 2);
    const ctx = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.' || ch === ' ' || !pal[ch]) continue;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x + pad, y + pad, 1, 1);
      }
    }
    if (doOutline) outline(c);
    return c;
  }

  // ---------------------------------------------------------------- 3x5 pixel font
  const GLYPHS = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', '!': '010010010000010', '?': '110001010000010', '.': '000000000000010', '-': '000000111000000',
    ':': '000010000010000', "'": '010010000000000', '/': '001001010100100', '+': '000010111010000', '$': '011110010011110',
    '*': '101111111010000', '#': '101111101111101', '&': '010101010101011', ',': '000000000010100', ' ': '000000000000000',
  };
  function textWidth(s, scale) {
    scale = scale || 1;
    return Math.max(0, s.length * 4 * scale - scale);
  }
  function drawText(ctx, s, x, y, color, scale) {
    scale = scale || 1;
    // on the hi-res world canvas, snap to its finer grid; elsewhere to whole pixels
    const k = ctx === Art.worldCtx ? Art.K || 1 : 1;
    const R = (v) => Math.round(v * k) / k;
    ctx.fillStyle = color;
    s = String(s).toUpperCase();
    for (let n = 0; n < s.length; n++) {
      const g = GLYPHS[s[n]];
      if (!g) continue;
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') ctx.fillRect(R(x + (n * 4 + (i % 3)) * scale), R(y + Math.floor(i / 3) * scale), scale, scale);
      }
    }
  }

  // ---------------------------------------------------------------- runner looks
  const JERSEYS = [
    '#e53935', '#1e63d6', '#fbc02d', '#2e9e4f', '#8e44ad', '#ff6fae', '#00a8c6', '#ff8a1f', '#9ccc2a', '#f4f4f4',
    '#3a3a4a', '#8a5a33', '#00c4a0', '#b0b8c8', '#c21858', '#0d2b7a', '#d4a017', '#7ec8ff', '#5d8a3a', '#a0e7e5',
  ];
  const SKINS = ['#f7d5b5', '#eab98f', '#d39a6a', '#b27449', '#8a5433', '#5e3822'];
  const HAIRS = ['#2a1b12', '#4a2d1a', '#7a4a22', '#d9a441', '#e8d27a', '#b6482a', '#9e9e9e', '#151515', '#3b6fd9', '#e85aa8', '#f2f2f2'];
  const STYLES = ['short', 'spiky', 'afro', 'pony', 'bald', 'mohawk', 'long', 'bun', 'buzz', 'short', 'pony', 'curly'];
  const SHOES = ['#ffffff', '#ff3b30', '#ffd60a', '#32d74b', '#0a84ff', '#ff9f0a', '#bf5af2', '#1c1c1e', '#64d2ff'];
  const ACCS = ['none', 'none', 'none', 'headband', 'shades', 'headband', 'shades+band', 'mustache', 'wristband'];

  function makeLooks(names, seed, Planner) {
    const rng = Planner.makeRng((seed ^ 0x51ab1e) >>> 0);
    const jerseys = rng.shuffle(JERSEYS);
    return names.map((name, i) => {
      const r = Planner.makeRng((Planner.hashStr(name) ^ (i * 7919) ^ seed) >>> 0);
      const jersey = jerseys[i % jerseys.length];
      const light = rgb(jersey).reduce((a, b) => a + b) > 520;
      let hair = r.pick(HAIRS);
      const style = r.pick(STYLES);
      const acc = r.pick(ACCS);
      return {
        id: i,
        color: jersey,
        jersey,
        jerseyShade: shade(jersey, 0.72),
        trim: light ? '#2a2a3a' : '#ffffff',
        shorts: r.pick([shade(jersey, 0.45), '#1d1d2b', '#f0f0f0', '#23324f']),
        skin: r.pick(SKINS),
        hair,
        style,
        shoes: r.pick(SHOES),
        acc,
        band: r.pick(['#ffffff', '#ff3b30', '#ffd60a', '#32d74b', '#0a84ff']),
        cache: new Map(),
      };
    });
  }

  // ---------------------------------------------------------------- poses
  // Angles are measured from "straight down", positive = rotated forward (to the right).
  // legs/arms: [front, back]; each leg = [thigh, kneeBend], each arm = [shoulder, elbowBend].
  const PI = Math.PI;
  function base() {
    return { lean: 0, legs: [[0.06, 0.05], [-0.06, 0.05]], arms: [[0.18, 0.35], [-0.12, 0.35]], rot: 0, flip: false, ground: true, eyes: 'open', mouth: null, held: null, noShoe: false, headDy: 0 };
  }
  const Pose = {
    run(ph, effort) {
      effort = effort == null ? 1 : effort;
      const p = base();
      const leg = (a) => [0.1 + 0.72 * effort * Math.sin(a), 0.15 + 1.55 * effort * Math.max(0, Math.cos(a + 0.3))];
      p.lean = 0.24 * Math.min(1.2, effort);
      p.legs = [leg(ph), leg(ph + PI)];
      p.arms = [[-0.95 * effort * Math.sin(ph), 1.45], [0.95 * effort * Math.sin(ph), 1.45]];
      if (effort > 1.15) p.mouth = 'open';
      return p;
    },
    panic(ph) {
      const p = Pose.run(ph, 1.25);
      p.arms = [[2.7 + 0.35 * Math.sin(ph * 2), 0.3], [3.5 - 0.35 * Math.sin(ph * 2), -0.3]];
      p.mouth = 'open';
      return p;
    },
    stand(b) {
      const p = base();
      p.headDy = b ? 1 : 0;
      return p;
    },
    jogInPlace(ph) {
      const p = Pose.run(ph, 0.35);
      p.lean = 0.05;
      return p;
    },
    stretch(ph) {
      const p = base();
      p.arms = [[2.9 + 0.1 * Math.sin(ph), 0.1], [3.4 - 0.1 * Math.sin(ph), -0.1]];
      p.legs = [[0.35, 0.0], [-0.35, 0.0]];
      return p;
    },
    crouch() { // on your marks
      const p = base();
      p.lean = 1.25;
      p.legs = [[1.55, 2.35], [0.55, 2.0]];
      p.arms = [[-0.05, 0.0], [0.05, 0.0]];
      p.groundHands = true;
      return p;
    },
    set() {
      const p = base();
      p.lean = 1.15;
      p.legs = [[1.2, 1.45], [0.2, 0.55]];
      p.arms = [[-0.08, 0.0], [0.08, 0.0]];
      p.groundHands = true;
      return p;
    },
    sleepy(ph) {
      const p = Pose.crouch();
      p.eyes = 'closed';
      p.headDy = ph > PI ? 1 : 0;
      return p;
    },
    stumble() {
      const p = Pose.run(0.5, 1);
      p.lean = 0.85;
      p.arms = [[1.9, 0.2], [1.6, 0.2]];
      p.mouth = 'open';
      return p;
    },
    fallen() { // face down, head to the right
      const p = base();
      p.arms = [[2.9, 0.1], [3.1, 0.1]];
      p.legs = [[0.1, 0.4], [-0.1, 0.9]];
      p.rot = PI / 2;
      p.eyes = 'closed';
      return p;
    },
    slip(ph) { // feet fly up
      const p = base();
      p.legs = [[1.9, 0.2], [1.4, 0.4]];
      p.arms = [[2.4 + 0.4 * Math.sin(ph * 3), 0.2], [3.6 - 0.4 * Math.sin(ph * 3), 0.2]];
      p.rot = -0.9;
      p.mouth = 'open';
      p.ground = false;
      return p;
    },
    onBack() {
      const p = base();
      p.arms = [[2.2, 0.2], [3.8, 0.2]];
      p.legs = [[0.25, 0.1], [-0.25, 0.1]];
      p.rot = -PI / 2;
      p.eyes = 'closed';
      return p;
    },
    kneel(ph) {
      const p = base();
      p.lean = 0.95;
      p.legs = [[1.45, 1.65], [0.15, 1.75]];
      p.arms = [[0.95 + 0.1 * Math.sin(ph * 4), 0.3], [0.8 - 0.1 * Math.sin(ph * 4), 0.3]];
      return p;
    },
    celebrate(ph) {
      const p = base();
      p.arms = [[2.7 + 0.15 * Math.sin(ph * 2), 0.1], [3.55 - 0.15 * Math.sin(ph * 2), -0.1]];
      p.legs = [[0.2, 0.3], [-0.2, 0.3]];
      p.mouth = 'open';
      p.eyes = 'happy';
      return p;
    },
    runCelebrate(ph) {
      const p = Pose.run(ph, 0.55);
      p.arms = [[2.7 + 0.2 * Math.sin(ph), 0.1], [3.55 - 0.2 * Math.sin(ph), -0.1]];
      p.mouth = 'open';
      p.eyes = 'happy';
      p.lean = 0;
      return p;
    },
    wave(ph) {
      const p = Pose.run(ph, 0.6);
      p.arms[0] = [2.55 + 0.35 * Math.sin(ph * 3), 0.5];
      p.mouth = 'smile';
      return p;
    },
    phone(ph) {
      const p = Pose.run(ph, 0.45);
      p.arms[0] = [0.35, 2.7];
      p.held = 'phone';
      p.lean = 0.05;
      return p;
    },
    selfie(ph) {
      const p = base();
      p.arms = [[2.25, 0.0], [-0.2, 0.4]];
      p.held = 'phone';
      p.mouth = 'smile';
      p.eyes = ph > PI ? 'happy' : 'open';
      return p;
    },
    eat(ph) {
      const p = base();
      p.arms = [[0.45, 2.35 + 0.2 * Math.sin(ph * 3)], [-0.1, 0.4]];
      p.held = 'hotdog';
      p.mouth = Math.sin(ph * 3) > 0 ? 'open' : null;
      return p;
    },
    drink(ph) {
      const p = Pose.run(ph, 0.5);
      p.arms[0] = [0.6, 2.4];
      p.held = 'can';
      p.lean = -0.1;
      return p;
    },
    flex(ph) {
      const p = base();
      const f = 0.1 * Math.sin(ph * 2);
      p.arms = [[PI / 2 + f, PI / 2], [-PI / 2 - f, -PI / 2]];
      p.legs = [[0.3, 0.1], [-0.3, 0.1]];
      p.mouth = 'smile';
      return p;
    },
    sign() {
      const p = base();
      p.arms = [[1.25, 0.6], [0.9, 0.9]];
      p.held = 'paper';
      p.mouth = 'smile';
      return p;
    },
    hop(ph) {
      const p = base();
      p.legs = [[0.05, 0.1], [-0.35, 2.4]];
      p.arms = [[-0.6, 0.6], [-0.5, 0.6]];
      p.lean = 0.25;
      p.mouth = 'open';
      p.hopDy = Math.abs(Math.sin(ph)) * 3;
      return p;
    },
    tired(ph) {
      const p = Pose.run(ph, 0.5);
      p.lean = 0.55;
      p.arms = [[0.25 + 0.2 * Math.sin(ph), 0.2], [0.1 - 0.2 * Math.sin(ph), 0.2]];
      p.mouth = 'open';
      p.eyes = 'half';
      return p;
    },
    lifted(ph) {
      const p = base();
      p.legs = [[0.25 * Math.sin(ph * 2), 0.6], [-0.25 * Math.sin(ph * 2), 0.6]];
      p.arms = [[2.6 + 0.4 * Math.sin(ph * 3), 0.3], [3.6 - 0.4 * Math.sin(ph * 3), 0.3]];
      p.mouth = 'open';
      p.ground = false;
      return p;
    },
    star(rot) {
      const p = base();
      p.arms = [[2.4, 0], [3.9, 0]];
      p.legs = [[0.55, 0], [-0.55, 0]];
      p.rot = rot;
      p.mouth = 'open';
      return p;
    },
    moonwalk(ph) {
      const p = base();
      const s = Math.sin(ph);
      p.legs = s > 0 ? [[0.05, 0.0], [0.35, 1.1]] : [[0.35, 1.1], [0.05, 0.0]];
      p.arms = [[0.3, 1.2], [-0.2, 0.3]];
      p.lean = -0.08;
      p.mouth = 'smile';
      return p;
    },
    sneezeWindup() {
      const p = base();
      p.lean = -0.3;
      p.eyes = 'closed';
      p.mouth = 'open';
      return p;
    },
    handsKnees(b) {
      const p = base();
      p.lean = 1.0;
      p.legs = [[0.35, 0.65], [-0.05, 0.45]];
      p.arms = [[0.55, 0.0], [0.4, 0.0]];
      p.mouth = b ? 'open' : null;
      return p;
    },
  };

  // ---------------------------------------------------------------- runner rasteriser
  const SW = 56, SH = 58, OX = 28, OY = 50; // sprite size and ground anchor
  const HEAD = ['.####.', '######', '######', '######', '######', '.####.'];
  const HAIR = {
    short: ['.####.', '#####.', '##....', '#.....'],
    spiky: ['#.#.#.', '.####.', '#####.', '##....', '#.....'],
    afro: ['..####..', '.######.', '########', '#####...', '####....', '###.....', '##......'],
    pony: ['.####.', '#####.', '##....', '#.....'],
    bald: [],
    mohawk: ['..##..', '..##..', '.####.'],
    long: ['.####.', '#####.', '##....', '##....', '##....', '##....', '.#....'],
    bun: ['##....', '##....', '.####.', '#####.', '##....', '#.....'],
    buzz: ['.####.', '#.....'],
    curly: ['.#.##.', '######', '####..', '##....', '#.....'],
  };
  const HAIR_OFF = { afro: [-1, -3], spiky: [0, -1], mohawk: [0, -3], bun: [-1, -2], curly: [0, -1] };

  function rotPt(x, y, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }
  const dir = (a) => [Math.sin(a), Math.cos(a)];

  function skeleton(pose) {
    const hip = [0, -13];
    const legs = pose.legs.map(([th, kn]) => {
      const k = [hip[0] + 6 * dir(th)[0], hip[1] + 6 * dir(th)[1]];
      const s = th - kn;
      const a = [k[0] + 6 * dir(s)[0], k[1] + 6 * dir(s)[1]];
      const toe = [a[0] + 3 * Math.cos(s), a[1] - 3 * Math.sin(s)];
      return { hip, knee: k, ankle: a, toe };
    });
    const up = [Math.sin(pose.lean), -Math.cos(pose.lean)];
    const neck = [hip[0] + 8 * up[0], hip[1] + 8 * up[1]];
    const sh = [neck[0] - up[0] * 1, neck[1] - up[1] * 1];
    const arms = pose.arms.map(([a, e]) => {
      const el = [sh[0] + 4 * dir(a)[0], sh[1] + 4 * dir(a)[1]];
      const hand = [el[0] + 4 * dir(a + e)[0], el[1] + 4 * dir(a + e)[1]];
      return { sh, el, hand };
    });
    const hl = pose.lean * 0.6;
    const head = [neck[0] + 3.4 * Math.sin(hl), neck[1] - 3.4 * Math.cos(hl) + (pose.headDy || 0)];
    const sk = { hip, legs, arms, neck, head };
    // whole body rotation about the belly
    if (pose.rot) {
      const pv = [0, -9];
      const R = (p) => { const r = rotPt(p[0] - pv[0], p[1] - pv[1], pose.rot); return [r[0] + pv[0], r[1] + pv[1]]; };
      sk.hip = R(hip); sk.neck = R(neck); sk.head = R(head);
      sk.legs = legs.map((l) => ({ hip: R(l.hip), knee: R(l.knee), ankle: R(l.ankle), toe: R(l.toe) }));
      sk.arms = arms.map((a) => ({ sh: R(a.sh), el: R(a.el), hand: R(a.hand) }));
    }
    // put the lowest point on the ground
    let lowest = -Infinity;
    const consider = (p) => { if (p[1] > lowest) lowest = p[1]; };
    if (pose.rot) {
      sk.legs.forEach((l) => { consider(l.knee); consider(l.ankle); consider(l.toe); });
      sk.arms.forEach((a) => { consider(a.el); consider(a.hand); });
      consider([sk.head[0], sk.head[1] + 3]);
      consider(sk.hip);
    } else {
      sk.legs.forEach((l) => { consider([l.ankle[0], l.ankle[1] + 1]); consider([l.toe[0], l.toe[1] + 1]); });
      if (pose.groundHands) sk.arms.forEach((a) => consider(a.hand));
      if (pose.groundKnees !== false && !pose.groundHands) sk.legs.forEach((l) => consider(l.knee));
    }
    sk.dy = pose.ground === false ? 0 : -lowest - 0.5;
    return sk;
  }

  function renderRunner(look, pose) {
    const c = canvas(SW, SH);
    const ctx = c.getContext('2d');
    const sk = skeleton(pose);
    const fx = pose.flip ? -1 : 1;
    const X = (x) => OX + fx * x;
    const Y = (y) => OY + y + sk.dy + (pose.hopDy ? -pose.hopDy : 0);
    const dot = (x, y, w, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(X(x) - w / 2), Math.round(Y(y) - w / 2), w, w);
    };
    const line = (a, b, w, col) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
      for (let s = 0; s <= steps; s++) dot(a[0] + (dx * s) / steps, a[1] + (dy * s) / steps, w, col);
    };
    const back = 0.74;
    const skinB = shade(look.skin, back);

    const drawLeg = (l, dark, idx) => {
      const skin = dark ? skinB : look.skin;
      const shorts = dark ? shade(look.shorts, back) : look.shorts;
      line(l.knee, l.ankle, 2, skin);
      const mid = [l.hip[0] + (l.knee[0] - l.hip[0]) * 0.55, l.hip[1] + (l.knee[1] - l.hip[1]) * 0.55];
      line(mid, l.knee, 2, skin);
      line(l.hip, mid, 3, shorts);
      const shoe = pose.noShoe && idx === 0 ? '#f4f4f4' : dark ? shade(look.shoes, 0.8) : look.shoes;
      line(l.ankle, l.toe, 2, shoe);
    };
    const drawArm = (a, dark) => {
      const skin = dark ? skinB : look.skin;
      line(a.sh, a.el, 2, skin);
      line(a.el, a.hand, 2, skin);
      if (look.acc === 'wristband') dot(a.hand[0] * 0.75 + a.el[0] * 0.25, a.hand[1] * 0.75 + a.el[1] * 0.25, 2, look.band);
    };

    drawArm(sk.arms[1], true);
    drawLeg(sk.legs[1], true, 1);
    // torso
    line(sk.hip, sk.neck, 4, look.jersey);
    const mid = [(sk.hip[0] + sk.neck[0]) / 2, (sk.hip[1] + sk.neck[1]) / 2];
    // side stripe + bib
    line([sk.hip[0] - 1.2, sk.hip[1]], [sk.neck[0] - 1.2, sk.neck[1] + 1], 1, look.jerseyShade);
    dot(mid[0] + 1, mid[1], 2, '#fbfbf2');
    dot(sk.hip[0], sk.hip[1] + 0.5, 4, look.shorts);
    drawLeg(sk.legs[0], false, 0);

    // head
    const hx = Math.round(X(sk.head[0]) - 3), hy = Math.round(Y(sk.head[1]) - 3);
    const rotSteps = Math.round((pose.rot || 0) / (PI / 2)) & 3;
    const hairPix = (rows, ox, oy, col) => {
      ctx.fillStyle = col;
      rows.forEach((r, y) => {
        for (let x = 0; x < r.length; x++) {
          if (r[x] !== '#') continue;
          let px = x + ox - 2.5, py = y + oy - 2.5;
          for (let k = 0; k < rotSteps; k++) { const t = px; px = -py; py = t; }
          if (fx < 0) px = -px;
          ctx.fillRect(Math.round(hx + 2.5 + px), Math.round(hy + 2.5 + py), 1, 1);
        }
      });
    };
    // ponytail / long hair swing behind the head
    if (look.style === 'pony') {
      const sway = pose.ph != null ? Math.round(Math.sin(pose.ph)) : 0;
      hairPix(['##..', '.##.', '..#.'].map((r) => r.split('').reverse().join('')), -3, 1 + sway, look.hair);
    }
    hairPix(HEAD, 0, 0, look.skin);
    // nose + ear
    hairPix(['#'], 6, 3, look.skin);
    hairPix(['#'], 2, 3, shade(look.skin, 0.8));
    // hair
    if (look.style !== 'bald') {
      const off = HAIR_OFF[look.style] || [0, 0];
      hairPix(HAIR[look.style] || HAIR.short, off[0], off[1], look.hair);
    } else {
      hairPix(['#'], 3, 0, shade(look.skin, 1.25));
    }
    if (look.acc === 'headband' || look.acc === 'shades+band') hairPix(['######'], 0, 1, look.band);
    // eyes
    const eyeCol = '#1a1422';
    if (pose.eyes === 'closed' || pose.eyes === 'happy') hairPix(['##'], 4, 2, eyeCol);
    else if (pose.eyes === 'half') hairPix(['##'], 4, 2, shade(look.skin, 0.6));
    else hairPix(['#'], 4, 2, eyeCol);
    if (look.acc === 'shades' || look.acc === 'shades+band') hairPix(['###'], 3, 2, '#101018');
    if (look.acc === 'mustache') hairPix(['##'], 4, 4, look.hair === '#f2f2f2' ? '#9e9e9e' : look.hair);
    if (pose.mouth === 'open') hairPix(['#', '#'], 5, 4, '#5a1020');
    else if (pose.mouth === 'smile') hairPix(['##'], 4, 4, '#5a1020');

    // front arm last so it overlaps the torso
    drawArm(sk.arms[0], false);
    // held item
    const hand = sk.arms[0].hand;
    if (pose.held === 'phone') { dot(hand[0], hand[1] - 1, 2, '#111'); dot(hand[0], hand[1] - 2, 1, '#8ef'); }
    else if (pose.held === 'hotdog') { dot(hand[0] + 1, hand[1] - 1, 2, '#e3a857'); dot(hand[0] + 2, hand[1] - 1, 1, '#c8322d'); dot(hand[0] + 3, hand[1] - 1, 1, '#e3a857'); }
    else if (pose.held === 'can') { dot(hand[0], hand[1] - 1, 2, '#e53935'); dot(hand[0], hand[1] - 3, 1, '#ddd'); }
    else if (pose.held === 'paper') { dot(hand[0] + 1, hand[1], 3, '#ffffff'); }

    outline(c);
    return c;
  }

  // Cached sprite for look + pose key.
  function runnerSprite(look, key, makePose) {
    let c = look.cache.get(key);
    if (!c) {
      c = renderRunner(look, makePose());
      look.cache.set(key, c);
    }
    return c;
  }

  // ---------------------------------------------------------------- props
  const PAL = {
    y: '#ffd83a', Y: '#e0a91f', k: '#6b4a16', b: '#9c6433', B: '#b97a45', D: '#5c3a1c', n: '#141414', e: '#141414', t: '#ff7a9a',
    G: '#8f96a3', g: '#6d7482', w: '#d5dae3', o: '#e08a2e', W: '#ffffff', c: '#bfe9ff', C: '#8fd3ff', s: '#9aa3b5', S: '#c7cfdd', l: '#ffe066',
    r: '#e53935', R: '#b71c1c', h: '#e3a857', d: '#2a2a2a', v: '#3a8a3a', V: '#2f6f2f', p: '#ff9eb8', q: '#f6f0dc', m: '#d83b2d',
  };
  const P = {};
  function buildProps() {
    P.banana = pixmap([
      '......k',
      '.....yY',
      'y...yyY',
      'yyyyyY.',
      '.YYYY..',
    ], PAL, true);
    P.dog = [
      pixmap([
        '..........DD.',
        '.........BBBB',
        'D.......BBeBn',
        '.D.....BBBBB.',
        '..BBBBBBBBt..',
        '..BBBBBBBB...',
        '.B.B....B..B.',
        'B...B..B....B',
      ], PAL, true),
      pixmap([
        '..........DD.',
        '.........BBBB',
        '.D......BBeBn',
        '..D....BBBBB.',
        '..BBBBBBBBt..',
        '..BBBBBBBB...',
        '...BB...BB...',
        '...B.B..B.B..',
      ], PAL, true),
    ];
    P.bird = [
      pixmap(['.ww......', '..www....', '...GGGGe.', '..GGGGGGo', '...gGGG..', '....o.o..'], PAL, true),
      pixmap(['.........', '.........', '...GGGGe.', '.wwGGGGGo', 'www.gGG..', '....o.o..'], PAL, true),
    ];
    P.cloud = pixmap([
      '.....wwww.......',
      '...wwwwwwww.ww..',
      '..wwwwwwwwwwwww.',
      '.wwwwwwwwwwwwwww',
      '.gwwwwwwwwwwwwwg',
      '..gggggggggggg..',
    ], { w: '#aab3c2', g: '#7c8596' }, true);
    P.whiteCloud = pixmap([
      '.......WWWW...........',
      '....WWWWWWWWW..WWW....',
      '..WWWWWWWWWWWWWWWWWW..',
      '.WWWWWWWWWWWWWWWWWWWW.',
      'WWWWWWWWWWWWWWWWWWWWWW',
      '.wwwwwwwwwwwwwwwwwwww.',
    ], { W: '#ffffff', w: '#dde7f2' }, false);
    P.ufo = pixmap([
      '........cccccc........',
      '.......cCCCCCCc.......',
      '......cCCCCCCCCc......',
      '..ssssssssssssssssss..',
      '.sSSSSSSSSSSSSSSSSSSs.',
      'ssSSSSSSSSSSSSSSSSSSss',
      '.ssssssssssssssssssss.',
      '....ss..........ss....',
    ], PAL, true);
    P.duck = pixmap(['..yy..', '.yyey.', '.yyyyo', 'yyyyy.', 'yyyyy.', '.o.o..'], { y: '#f2f2f2', e: '#141414', o: '#f29a2e' }, true);
    P.duckling = pixmap(['.yy.', 'yyeo', 'yyy.', '.o..'], { y: '#ffe14d', e: '#141414', o: '#f29a2e' }, true);
    P.chicken = [
      pixmap([
        '....rr......',
        '...rWWr.....',
        '...WWWWy....',
        '...WeWWyy...',
        '...WWWWr....',
        '..WWWWWW....',
        '.WWWWWWWW...',
        'WWqWWWWWWW..',
        'WWqqWWWWWW..',
        '.WWqqWWWW...',
        '..WWWWWW....',
        '....o..o....',
        '...o....o...',
        '..oo....oo..',
      ], { r: '#e53935', W: '#ffffff', q: '#dcdcdc', y: '#ffc12e', e: '#141414', o: '#f29a2e' }, true),
      pixmap([
        '....rr......',
        '...rWWr.....',
        '...WWWWy....',
        '...WeWWyy...',
        '...WWWWr....',
        '..WWWWWW....',
        '.WWWWWWWW...',
        'WWqWWWWWWW..',
        'WWqqWWWWWW..',
        '.WWqqWWWW...',
        '..WWWWWW....',
        '.....oo.....',
        '.....o.o....',
        '....oo.oo...',
      ], { r: '#e53935', W: '#ffffff', q: '#dcdcdc', y: '#ffc12e', e: '#141414', o: '#f29a2e' }, true),
    ];
    P.star = pixmap(['..y..', '.yyy.', 'yyyyy', '.yyy.', '.y.y.'], { y: '#ffe14d' }, false);
    P.shoe = pixmap(['.ss.', 'ssss'], { s: '#ffffff' }, true);
    P.can = pixmap(['sss', 'rrr', 'rWr', 'rrr', 'sss'], PAL, true);
    P.hotdog = pixmap(['.hhh.', 'rrrrr', '.hhh.'], PAL, true);
    P.bee = pixmap(['.w.', 'yky'], { w: '#e8f6ff', y: '#ffd83a', k: '#141414' }, false);
  }

  // Build a blimp with a message printed on it.
  function makeBlimp(msg) {
    msg = msg.toUpperCase().replace(/[^A-Z0-9!?.\-' ]/g, '');
    const tw = textWidth(msg, 1);
    const w = Math.max(48, tw + 16), h = 16;
    const c = canvas(w + 10, h + 8);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d9dde6';
    for (let y = 0; y < h; y++) {
      const t = (y - h / 2 + 0.5) / (h / 2);
      const half = Math.sqrt(Math.max(0, 1 - t * t)) * (w / 2);
      ctx.fillStyle = y < 4 ? '#eef1f6' : y > h - 4 ? '#b3bac8' : '#d9dde6';
      ctx.fillRect(Math.round(w / 2 - half) + 2, y + 1, Math.round(half * 2), 1);
    }
    ctx.fillStyle = '#e53935';
    ctx.fillRect(4, 3, 3, h - 5); ctx.fillRect(0, 1, 5, 4); ctx.fillRect(0, h - 3, 5, 4);
    ctx.fillStyle = '#23324f';
    ctx.fillRect(w / 2 - 6, h + 1, 12, 4);
    drawText(ctx, msg, Math.round((w + 4 - tw) / 2) + 2, 6, '#1e63d6', 1);
    outline(c);
    return c;
  }

  const Art = {
    rgb, shade, mix, canvas, outline, pixmap, drawText, textWidth,
    makeLooks, Pose, runnerSprite, P, buildProps, makeBlimp, SPRITE: { W: SW, H: SH, OX, OY }, JERSEYS,
  };
  root.Art = Art;
})(typeof self !== 'undefined' ? self : this);
