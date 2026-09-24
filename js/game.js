/* Pixel Dash — game: rendering, screens, host panel, share links. */
(function () {
  'use strict';
  const { Planner, Art, Sfx } = window;

  const VW = 640, VH = 360;
  const PPM = 10;            // world pixels per meter
  const START_X = 90;        // world x of the start line
  const TRACK_TOP = 114;
  const DT = Planner.DT;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const $ = (id) => document.getElementById(id);

  // ================================================================ canvases
  const screen = $('screen');
  const sctx = screen.getContext('2d');
  // The world is drawn in 640x360 "pixel art" units, but onto a canvas K times
  // larger, so things can move in 1/K-pixel steps: smooth motion, crisp pixels.
  const world = document.createElement('canvas');
  const w = world.getContext('2d');
  const view = { s: 1, ox: 0, oy: 0, dpr: 1, cw: 1, ch: 1 };
  let K = 1;
  const sn = (v) => Math.round(v * K) / K;
  Art.worldCtx = w;

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.cw = window.innerWidth; view.ch = window.innerHeight;
    screen.width = Math.round(view.cw * view.dpr);
    screen.height = Math.round(view.ch * view.dpr);
    view.s = Math.min(view.cw / VW, view.ch / VH);
    view.ox = (view.cw - VW * view.s) / 2;
    view.oy = (view.ch - VH * view.s) / 2;
    K = clamp(Math.round(view.s * view.dpr), 1, 4);
    Art.K = K;
    world.width = VW * K; world.height = VH * K;
    w.imageSmoothingEnabled = false;
    const portrait = view.ch > view.cw && view.cw < 700;
    document.body.classList.toggle('portrait', portrait);
  }
  window.addEventListener('resize', resize);
  resize();

  Art.buildProps();

  // ================================================================ themes
  const THEMES = {
    day: {
      sky: ['#5fb4f5', '#b6e3ff'], back: '#27304d', seatA: '#394670', seatB: '#303b62', rail: '#d7dce6',
      tint: null, stars: false, lights: false, grass: ['#4da64a', '#459a42'], track: '#c4553b', lane: '#f3e9df', clouds: '#ffffff',
    },
    sunset: {
      sky: ['#40306e', '#ff9460'], back: '#2a2244', seatA: '#46406e', seatB: '#3b3662', rail: '#e8d2c4',
      tint: 'rgba(255,120,50,0.10)', stars: false, lights: true, grass: ['#4f9a45', '#478e3f'], track: '#c8583a', lane: '#fbe6d6', clouds: '#ffd2c2',
    },
    night: {
      sky: ['#050918', '#16204a'], back: '#141a33', seatA: '#232c52', seatB: '#1d2547', rail: '#aab4c8',
      tint: 'rgba(10,20,70,0.28)', stars: true, lights: true, grass: ['#3c8f3f', '#357f38'], track: '#b94f37', lane: '#f3e9df', clouds: null,
    },
  };
  const CROWD = ['#e53935', '#1e63d6', '#fbc02d', '#2e9e4f', '#8e44ad', '#ff6fae', '#00a8c6', '#ff8a1f', '#f4f4f4', '#9ccc2a', '#23324f', '#c21858'];
  const SKIN = ['#f7d5b5', '#eab98f', '#d39a6a', '#b27449', '#8a5433', '#5e3822'];
  const HAIRC = ['#2a1b12', '#4a2d1a', '#7a4a22', '#d9a441', '#151515', '#9e9e9e'];
  const ADS = ['PIXEL DASH', 'SPEEDY SHOES', 'DRINK WATER', 'BANANA CO.', 'HOT DOGS $2', 'NO BANANAS ON TRACK', 'GO GO GO!', 'SUPER SNEAKS', 'RUN FAST', 'EAT YOUR VEGGIES', 'PIGEON CONTROL', 'UFO FREE ZONE'];
  const ADCOL = [['#1e63d6', '#ffffff'], ['#ffd23f', '#1a1a2e'], ['#e53935', '#ffffff'], ['#2e9e4f', '#ffffff'], ['#1a1a2e', '#ffd23f'], ['#ff6fae', '#1a1a2e']];

  function h2(a, b) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ================================================================ state
  const G = {
    mode: 'setup', viewer: false, cfg: null, plan: null, looks: null, theme: THEMES.day,
    lanes: null, trackTile: null, skyTile: null, ads: [], banners: [],
    camX: 0, zoom: 1, now: 0, raceT: 0, timeScale: 1,
    particles: [], flash: 0, fade: 0, big: null, line: null, excite: 0.3, sfxQ: [], extraBubbles: [], words: [], shake: 0, hitStop: 0,
    gagPtr: 0, globPtr: 0, linePtr: 0, crossPtr: 0,
    marks: null, reveal: null, rowY: [], clockFrozen: null,
  };

  // ================================================================ race setup
  function loadRace(cfg) {
    G.cfg = cfg;
    G.plan = Planner.planRace(cfg);
    G.looks = Art.makeLooks(cfg.names, cfg.seed, Planner);
    const r = Planner.makeRng((cfg.seed ^ 0x7e3) >>> 0);
    G.theme = THEMES[r.pick(['day', 'day', 'sunset', 'night'])];
    buildLanes(cfg.names.length);
    buildTiles();
    // ad boards and fan banners along the whole straight
    G.ads = [];
    let x = -40, k = r.int(0, ADS.length - 1);
    const end = START_X + G.plan.D * PPM + 900;
    while (x < end) {
      const txt = ADS[k++ % ADS.length];
      const wdt = Art.textWidth(txt, 2) + 22;
      G.ads.push({ x, w: wdt, txt, col: ADCOL[k % ADCOL.length] });
      x += wdt + 2;
    }
    G.banners = [];
    for (let bx = 160; bx < end; bx += r.int(220, 380)) {
      const i = r.int(0, cfg.names.length - 1);
      const txt = r.pick(['GO ', 'WE LOVE ', 'RUN ', 'GO GO ', '']) + cfg.names[i].toUpperCase().replace(/[^A-Z0-9!?.\-' ]/g, '') + r.pick(['!', '!!', ' #1', '']);
      G.banners.push({ x: bx, row: r.int(1, 4), txt: txt.trim(), col: G.looks[i].color });
    }
    buildCrowdTile();
    buildAdBoards();
    const gb = G.plan.globals.find((g) => g.type === 'blimp');
    G.blimp = gb ? Art.makeBlimp('GO ' + cfg.names[gb.seed % cfg.names.length] + '!') : null;
    G.rowY = cfg.names.map((_, i) => i);
    G.dive = new Set();
    const ord = G.plan.order;
    for (let k = 0; k < Math.min(7, ord.length); k++) {
      const c = G.plan.crossT[ord[k]];
      const near = [ord[k - 1], ord[k + 1]].some((j) => j != null && Math.abs(G.plan.crossT[j] - c) < 0.12);
      if (near) G.dive.add(ord[k]);
    }
  }

  function buildLanes(N) {
    const laneH = Math.min(28, Math.floor(200 / N));
    const trackH = laneH * N;
    G.lanes = {
      N, laneH, trackH, bottom: TRACK_TOP + trackH,
      ground: (i) => TRACK_TOP + laneH * (i + 1) - Math.max(2, Math.round(laneH * 0.18)),
    };
  }

  function buildTiles() {
    const th = G.theme, L = G.lanes;
    const t = document.createElement('canvas');
    t.width = 64; t.height = L.trackH;
    const c = t.getContext('2d');
    c.fillStyle = th.track;
    c.fillRect(0, 0, 64, L.trackH);
    const rng = Planner.makeRng(99);
    for (let i = 0; i < (64 * L.trackH) / 5; i++) {
      c.fillStyle = rng.chance(0.5) ? Art.shade(th.track, 0.9) : Art.shade(th.track, 1.07);
      c.fillRect(rng.int(0, 63), rng.int(0, L.trackH - 1), 1, 1);
    }
    c.fillStyle = th.lane;
    c.globalAlpha = 0.85;
    for (let k = 1; k < L.N; k++) c.fillRect(0, k * L.laneH, 64, 1);
    c.globalAlpha = 1;
    G.trackTile = t;

    const s = document.createElement('canvas');
    s.width = 4; s.height = 34;
    const sc = s.getContext('2d');
    for (let y = 0; y < 34; y++) {
      const f = y / 33;
      // dithered two-colour gradient
      for (let x = 0; x < 4; x++) {
        const d = ((x + y * 2) % 4) / 4;
        sc.fillStyle = f + (d - 0.5) * 0.18 > 0.5 ? th.sky[1] : Art.mix(th.sky[0], th.sky[1], f * 0.8);
        sc.fillRect(x, y, 1, 1);
      }
    }
    G.skyTile = s;
  }

  // Position and speed of runner i at race time t.
  function rstate(i, t) {
    const P = G.plan, K = P.ticks;
    const f = Math.max(0, t) / DT;
    const k = Math.min(K - 2, Math.floor(f));
    const a = Math.min(1, f - k);
    const p0 = P.pos[i * K + k], p1 = P.pos[i * K + k + 1];
    return { p: p0 + (p1 - p0) * a, v: (p1 - p0) / DT };
  }
  function gagAt(i, t) {
    for (const g of G.plan.gags) {
      if (g.i === i && t >= g.t0 && t < g.t0 + g.dur) return g;
      if (g.t0 > t) break;
    }
    return null;
  }
  const runnerX = (p) => START_X + p * PPM - 3;
  const FINISH_X = () => START_X + G.plan.D * PPM;

  function standings(t) {
    const P = G.plan;
    const arr = [];
    for (let i = 0; i < P.N; i++) {
      const fin = P.crossT[i] <= t ? P.crossT[i] : Infinity;
      arr.push({ i, p: rstate(i, t).p, fin });
    }
    arr.sort((a, b) => (a.fin !== b.fin ? a.fin - b.fin : b.p - a.p));
    return arr.map((x) => x.i);
  }

  // ================================================================ particles
  function puff(x, y, n, col, spread, up) {
    for (let k = 0; k < n; k++) {
      G.particles.push({
        x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * (up || 10), g: 12,
        life: 0, max: 0.4 + Math.random() * 0.4, col: col || '#e8d9c4', size: 2, world: true,
      });
    }
  }
  function confetti(n, x0, x1, y0) {
    for (let k = 0; k < n; k++) {
      G.particles.push({
        x: lerp(x0, x1, Math.random()), y: y0 - Math.random() * 30, vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 25, g: 10,
        life: 0, max: 3 + Math.random() * 2, col: CROWD[k % CROWD.length], size: Math.random() < 0.3 ? 2 : 1, sway: Math.random() * TAU, world: false,
      });
    }
  }
  function firework(x, y) {
    const col = CROWD[Math.floor(Math.random() * CROWD.length)];
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU, sp = 40 + Math.random() * 30;
      G.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 20, drag: 1.6, life: 0, max: 1 + Math.random() * 0.5, col, size: 1, world: false, spark: true });
    }
    Sfx.firework();
  }
  function stepParticles(dt) {
    const out = [];
    for (const p of G.particles) {
      p.life += dt;
      if (p.life > p.max) continue;
      if (p.drag) { p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt); }
      p.vy += p.g * dt;
      p.x += (p.vx + (p.sway != null ? Math.sin(p.life * 5 + p.sway) * 10 : 0)) * dt;
      p.y += p.vy * dt;
      out.push(p);
    }
    G.particles = out.length > 1500 ? out.slice(-1500) : out;
  }
  function drawParticles(cam) {
    for (const p of G.particles) {
      const x = p.world ? p.x - cam : p.x;
      if (x < -4 || x > VW + 4) continue;
      w.globalAlpha = p.spark ? clamp(1 - p.life / p.max, 0, 1) : 1;
      w.fillStyle = p.col;
      w.fillRect(sn(x), sn(p.y), p.size, p.size);
    }
    w.globalAlpha = 1;
  }

  // ================================================================ world: background
  function drawSky(cam, t) {
    const th = G.theme;
    w.drawImage(G.skyTile, 0, 0, 4, 34, 0, 0, VW, 34);
    if (th.stars) {
      for (let k = 0; k < 40; k++) {
        const x = (h2(k, 7) % VW), y = h2(k, 9) % 30;
        w.fillStyle = (Math.sin(t * 2 + k) > 0.6) ? '#ffffff' : '#8a93c7';
        w.fillRect(x, y, 1, 1);
      }
    }
    if (th.clouds) {
      for (let k = 0; k < 4; k++) {
        const span = VW + 80;
        const x = ((k * 190 - cam * 0.15 - t * 3) % span + span) % span - 40;
        w.drawImage(Art.P.whiteCloud, sn(x), 4 + (k % 2) * 8);
      }
    }
    // light towers
    const par = 0.6;
    for (let k = Math.floor((cam * par) / 260) - 1; k < (cam * par) / 260 + 4; k++) {
      const x = sn(k * 260 + 120 - cam * par);
      w.fillStyle = '#3a4058'; w.fillRect(x + 7, 8, 2, 26);
      w.fillStyle = '#4b5270'; w.fillRect(x, 1, 16, 8);
      for (let j = 0; j < 4; j++) {
        w.fillStyle = th.lights ? '#fff7cf' : '#c9d0e0';
        w.fillRect(x + 1 + j * 4, 2, 2, 2); w.fillRect(x + 1 + j * 4, 5, 2, 2);
      }
      if (th.lights) {
        w.fillStyle = 'rgba(255,248,210,0.08)';
        w.beginPath(); w.moveTo(x, 9); w.lineTo(x + 16, 9); w.lineTo(x + 90, 114); w.lineTo(x - 70, 114); w.closePath(); w.fill();
      }
    }
  }

  // The crowd sits further back than the track, so it scrolls slower (parallax).
  // Seated fans are pre-drawn into a repeating tile; only raised arms are drawn live.
  const STAND_PAR = 0.75;
  const CT_W = 384; // crowd tile width, a multiple of the 6px seat pitch
  function crowdSeat(tc, r) {
    const hh = h2(tc, r);
    return hh % 100 < 14 ? 0 : hh;
  }
  function buildCrowdTile() {
    const th = G.theme;
    const c = document.createElement('canvas');
    c.width = CT_W; c.height = 68;
    const x2 = c.getContext('2d');
    x2.fillStyle = th.back; x2.fillRect(0, 0, CT_W, 68);
    x2.fillStyle = Art.shade(th.back, 0.7); x2.fillRect(0, 0, CT_W, 2);
    for (let r = 0; r < 8; r++) {
      const y = 6 + r * 8;
      x2.fillStyle = r % 2 ? th.seatA : th.seatB;
      x2.fillRect(0, y + 4, CT_W, 4);
      const off = (r % 2) * 3;
      for (let tc = 0; tc < CT_W / 6; tc++) {
        const hh = crowdSeat(tc, r);
        if (!hh) continue;
        for (const x of [tc * 6 + off, tc * 6 + off - CT_W]) {
          x2.fillStyle = CROWD[hh % CROWD.length]; x2.fillRect(x, y + 2, 5, 4);
          x2.fillStyle = SKIN[(hh >>> 5) % SKIN.length]; x2.fillRect(x + 1, y - 1, 3, 3);
          x2.fillStyle = HAIRC[(hh >>> 9) % HAIRC.length]; x2.fillRect(x + 1, y - 1, 3, 1);
        }
      }
    }
    if (th.tint) { x2.fillStyle = th.tint; x2.fillRect(0, 0, CT_W, 68); }
    G.crowdTile = c;
  }
  function buildAdBoards() {
    for (const a of G.ads) {
      const c = document.createElement('canvas');
      c.width = a.w; c.height = 13;
      const x2 = c.getContext('2d');
      x2.fillStyle = a.col[0]; x2.fillRect(0, 0, a.w, 13);
      x2.fillStyle = Art.shade(a.col[0], 0.75); x2.fillRect(0, 12, a.w, 1);
      Art.drawText(x2, a.txt, 11, 2, a.col[1], 2, true);
      a.img = c;
    }
  }

  function drawStands(cam, t) {
    const th = G.theme;
    const scroll = cam * STAND_PAR;
    const tileOff = ((scroll % CT_W) + CT_W) % CT_W;
    for (let x = -tileOff; x < VW; x += CT_W) w.drawImage(G.crowdTile, sn(x), 30);
    const wave = activeGlobal('crowdwave', G.raceT);
    const waveX = wave ? lerp(-60, VW + 60, wave.u) : -999;
    const ex = G.excite;
    // raised arms: a few fans at a time, slowly; more as the finish gets close
    const threshold = 1.2 - ex * 0.75;
    for (let r = 0; r < 8; r++) {
      const y = 36 + r * 8;
      const off = (r % 2) * 3;
      const c0 = Math.floor((scroll - off) / 6) - 1;
      for (let c = c0; c < c0 + VW / 6 + 3; c++) {
        const tc = ((c % (CT_W / 6)) + CT_W / 6) % (CT_W / 6);
        const hh = crowdSeat(tc, r);
        if (!hh) continue;
        const x = c * 6 + off - scroll;
        const up = Math.abs(x - waveX) < 22 || Math.sin(t * (1.6 + (hh % 7) * 0.25) + (hh % 29)) > threshold;
        if (!up) continue;
        w.fillStyle = SKIN[(hh >>> 5) % SKIN.length];
        w.fillRect(sn(x), y - 3, 1, 2); w.fillRect(sn(x + 4), y - 3, 1, 2);
      }
    }
    // fan banners (they bob gently)
    for (const b of G.banners) {
      const x = b.x - scroll;
      const bw = Art.textWidth(b.txt, 1) + 6;
      if (x > VW || x + bw < 0) continue;
      const y = 36 + b.row * 8 - 2 + (Math.sin(t * 2 + b.x) > 0.5 ? -1 : 0);
      w.fillStyle = '#f7f3e8'; w.fillRect(sn(x), y, bw, 9);
      w.fillStyle = b.col; w.fillRect(sn(x), y, bw, 1); w.fillRect(sn(x), y + 8, bw, 1);
      Art.drawText(w, b.txt, x + 3, y + 2, '#1a1a2e', 1);
    }
    // the odd camera flash near the end
    if (ex > 0.55 && Math.random() < ex * 0.12) { w.fillStyle = '#ffffff'; w.fillRect(Math.floor(Math.random() * VW), 36 + Math.floor(Math.random() * 56), 2, 2); }
    // railing + ad boards (right at the trackside, so they move with the track)
    w.fillStyle = th.rail; w.fillRect(0, 96, VW, 2);
    w.fillStyle = '#1a1a2e'; w.fillRect(0, 98, VW, 1);
    for (const a of G.ads) {
      const x = a.x - cam;
      if (x > VW || x + a.w < 0) continue;
      w.drawImage(a.img, sn(x), 99);
    }
  }

  function drawTrack(cam) {
    const th = G.theme, L = G.lanes;
    w.fillStyle = '#e9e4dc'; w.fillRect(0, TRACK_TOP - 2, VW, 2);
    const off = ((cam % 64) + 64) % 64;
    for (let x = -off; x < VW; x += 64) w.drawImage(G.trackTile, sn(x), TRACK_TOP);
    w.fillStyle = '#e9e4dc'; w.fillRect(0, L.bottom, VW, 2);
    w.fillStyle = 'rgba(0,0,0,0.25)'; w.fillRect(0, L.bottom + 2, VW, 1);
    // infield grass with mowing stripes
    const gy = L.bottom + 3;
    for (let x = -(((cam % 48) + 48) % 48) - 48; x < VW; x += 48) {
      w.fillStyle = th.grass[0]; w.fillRect(sn(x), gy, 24, VH - gy);
      w.fillStyle = th.grass[1]; w.fillRect(sn(x) + 24, gy, 24, VH - gy);
    }
    // distance lines + signs every 50 m
    const D = G.plan.D;
    for (let m = 50; m < D; m += 50) {
      const x = sn(START_X + m * PPM - cam);
      if (x < -20 || x > VW + 20) continue;
      w.fillStyle = 'rgba(255,255,255,0.35)'; w.fillRect(x, TRACK_TOP, 1, L.trackH);
      const label = (D - m) + 'M';
      Art.drawText(w, label, x + 3, TRACK_TOP + 2, 'rgba(255,255,255,0.7)', 1);
      Art.drawText(w, label, x + 3, L.bottom - 7, 'rgba(255,255,255,0.7)', 1);
    }
    // start line, lane numbers, blocks
    const sx = sn(START_X - cam);
    if (sx > -60 && sx < VW + 10) {
      w.fillStyle = '#ffffff'; w.fillRect(sx, TRACK_TOP, 2, L.trackH);
      const sc = L.laneH >= 16 ? 2 : 1;
      for (let i = 0; i < L.N; i++) {
        const num = String(i + 1);
        Art.drawText(w, num, sx - 34 - Art.textWidth(num, sc) / 2, TRACK_TOP + i * L.laneH + (L.laneH - 5 * sc) / 2, 'rgba(255,255,255,0.8)', sc);
        if (G.mode !== 'race' || G.raceT < 3) {
          const gyL = L.ground(i);
          w.fillStyle = '#9aa3b5'; w.fillRect(sx - 12, gyL - 3, 4, 3); w.fillRect(sx - 6, gyL - 2, 3, 2);
          w.fillStyle = '#5c6378'; w.fillRect(sx - 12, gyL, 10, 1);
        }
      }
    }
    // finish line
    const fx = sn(FINISH_X() - cam);
    if (fx > -20 && fx < VW + 20) {
      for (let y = 0; y < L.trackH; y += 2) {
        for (let k = 0; k < 2; k++) {
          w.fillStyle = ((y / 2 + k) % 2) ? '#141414' : '#ffffff';
          w.fillRect(fx + k * 2, TRACK_TOP + y, 2, 2);
        }
      }
    }
  }

  function drawFinishGantry(cam, t) {
    const fx = sn(FINISH_X() - cam);
    if (fx < -80 || fx > VW + 80) return;
    const L = G.lanes;
    // far posts + banner and clock above the stands
    w.fillStyle = '#c9ced9'; w.fillRect(fx - 30, 44, 3, TRACK_TOP - 44); w.fillRect(fx + 30, 44, 3, TRACK_TOP - 44);
    w.fillStyle = '#e53935'; w.fillRect(fx - 34, 38, 71, 16);
    w.fillStyle = '#b71c1c'; w.fillRect(fx - 34, 53, 71, 1);
    Art.drawText(w, 'FINISH', fx - 23 + 1, 41, '#ffffff', 2);
    w.fillStyle = '#101018'; w.fillRect(fx - 26, 56, 55, 14);
    const clk = G.clockFrozen != null ? G.clockFrozen : Math.max(0, G.mode === 'race' ? G.raceT : 0);
    const txt = G.clockFrozen != null ? fmtTime(clk) : fmtClock(clk);
    Art.drawText(w, txt, fx + 1 - Art.textWidth(txt, 2) / 2, 58, '#ffd23f', 2);
    // photo-finish camera + photographers on the infield
    const gy = L.bottom + 3;
    w.fillStyle = '#2a2a2a'; w.fillRect(fx + 1, gy + 4, 1, 8); w.fillRect(fx - 2, gy + 11, 7, 1);
    w.fillStyle = '#44475a'; w.fillRect(fx - 2, gy + 1, 6, 4);
    for (let k = 0; k < 4; k++) {
      const px = fx + 18 + k * 15, hh = h2(k, 31);
      w.fillStyle = CROWD[hh % CROWD.length]; w.fillRect(px, gy + 6, 5, 6);
      w.fillStyle = SKIN[hh % SKIN.length]; w.fillRect(px + 1, gy + 2, 3, 4);
      w.fillStyle = '#1a1a1a'; w.fillRect(px - 2, gy + 3, 3, 3);
      const near = G.mode === 'race' && G.plan.order.some((i) => Math.abs(G.plan.crossT[i] - G.raceT) < 0.25);
      if (near && Math.random() < 0.25) { w.fillStyle = '#ffffff'; w.fillRect(px - 4, gy + 2, 4, 4); }
    }
  }

  // ================================================================ globals (ducks, mascot...)
  function activeGlobal(type, t) {
    if (!G.plan || G.mode !== 'race') return null;
    for (const g of G.plan.globals) {
      if (g.type === type && t >= g.t0 && t < g.t0 + g.dur) return { g, u: (t - g.t0) / g.dur };
    }
    return null;
  }
  function drawGlobals(t) {
    const L = G.lanes;
    const gy = L.bottom + 4;
    const ducks = activeGlobal('ducks', G.raceT);
    if (ducks) {
      const x = VW + 30 - ducks.u * (VW + 100);
      const bob = Math.sin(t * 12) > 0 ? 1 : 0;
      w.drawImage(Art.P.duck, sn(x), gy + 1 + bob);
      for (let k = 0; k < 3; k++) w.drawImage(Art.P.duckling, sn(x + 12 + k * 8), gy + 4 + ((bob + k) % 2));
    }
    const mascot = activeGlobal('mascot', G.raceT);
    if (mascot) {
      const x = -30 + mascot.u * (VW + 60);
      const fr = Math.floor(t * 10) % 2;
      w.drawImage(Art.P.chicken[fr], sn(x), gy - 4 - (fr ? 1 : 0));
    }
    const blimp = activeGlobal('blimp', G.raceT);
    if (blimp && G.blimp) {
      const x = VW + 20 - blimp.u * (VW + G.blimp.width + 40);
      w.drawImage(G.blimp, sn(x), sn(40 + Math.sin(t * 1.5) * 2));
    }
  }

  // ================================================================ runners
  function pickPose(i, t) {
    const P = G.plan, look = G.looks[i];
    const st = rstate(i, t);
    const vref = P.vref;
    const res = { p: st.p, v: st.v, dy: 0, key: '', make: null, fx: null };
    const tph = t * 7;
    const q = (ph, n) => { n = n || 16; const f = ((Math.floor((ph / TAU) * n) % n) + n) % n; return [f, (f / n) * TAU]; };
    const run = (effort, flip, extra) => {
      const [f, ph] = q((st.p / 2.5) * TAU * (flip ? -1 : 1), 16);
      const e = effort != null ? effort : st.v < 0.4 * vref ? 0.45 : st.v > 1.12 * vref ? 1.3 : 1;
      res.key = 'r' + e + (flip ? 'f' : '') + (extra || '') + ':' + f;
      res.make = () => { const p = Art.Pose.run(ph, e); p.ph = ph; p.flip = !!flip; if (extra === 'ns') p.noShoe = true; return p; };
    };
    const timed = (name, n, fn) => {
      const [f, ph] = q(tph, n || 8);
      res.key = name + ':' + f;
      res.make = () => { const p = fn(ph); p.ph = ph; return p; };
    };
    const fixed = (name, fn) => { res.key = name; res.make = fn; };

    if (G.mode !== 'race') {
      run(1);
      return res;
    }
    const cross = P.crossT[i];
    if (G.dive && G.dive.has(i) && t > cross - 0.28 && t < cross + 0.55) {
      if (t < cross + 0.1) { fixed('dive', () => Art.Pose.dive()); res.dy = -2; }
      else fixed('fallen', () => Art.Pose.fallen());
      return res;
    }
    if (cross <= t) {
      if (st.v > 3.2) { run(); return res; }
      const place = P.order.indexOf(i);
      if (place < 5) {
        timed('cel', 8, (ph) => Art.Pose.celebrate(ph));
        res.dy = -sn(Math.abs(Math.sin(t * 6 + i)) * (place < 3 ? 5 : 3));
      } else {
        fixed('knees' + (Math.sin(t * 5) > 0 ? 1 : 0), () => Art.Pose.handsKnees(Math.sin(t * 5) > 0));
      }
      return res;
    }
    if (t < P.react[i]) {
      const g = gagAt(i, t);
      if (g && g.type === 'sleepy') timed('sleepy', 4, (ph) => Art.Pose.sleepy(ph));
      else fixed('set', () => Art.Pose.set());
      return res;
    }
    const g = gagAt(i, t);
    if (!g) { run(); return res; }
    const u = (t - g.t0) / g.dur;
    res.gag = g; res.u = u;
    switch (g.type) {
      case 'trip':
        if (u < 0.1) fixed('stumble', () => Art.Pose.stumble());
        else if (u < 0.72) fixed('fallen', () => Art.Pose.fallen());
        else if (u < 0.85) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      case 'banana':
        if (u < 0.3) { timed('slip', 6, (ph) => Art.Pose.slip(ph)); res.dy = -sn(Math.sin((u / 0.3) * Math.PI) * 8); }
        else if (u < 0.78) fixed('onback', () => Art.Pose.onBack());
        else if (u < 0.88) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      case 'laces':
      case 'hotdog':
        if (u < 0.1 || u > 0.9) run(0.45);
        else if (g.type === 'laces') timed('kneel', 8, (ph) => Art.Pose.kneel(ph));
        else timed('eat', 8, (ph) => Art.Pose.eat(ph));
        break;
      case 'selfie': timed('selfie', 4, (ph) => Art.Pose.selfie(ph)); break;
      case 'autograph': fixed('sign', () => Art.Pose.sign()); break;
      case 'phone': {
        const [f, ph] = q((st.p / 2.5) * TAU, 16);
        res.key = 'phone:' + f; res.make = () => Art.Pose.phone(ph);
        break;
      }
      case 'cramp': timed('hop', 8, (ph) => Art.Pose.hop(ph)); break;
      case 'wrongway':
        if (u < 0.62) run(1, true);
        else if (u < 0.8) fixed('standf', () => { const p = Art.Pose.stand(); p.flip = true; p.mouth = 'open'; return p; });
        else run(0.45);
        break;
      case 'moonwalk': timed('moon', 8, (ph) => Art.Pose.moonwalk(ph)); break;
      case 'pigeon':
      case 'dog':
      case 'bees': {
        const [f, ph] = q((Math.max(0, st.p) / 2.3) * TAU, 12);
        res.key = 'panic:' + f; res.make = () => Art.Pose.panic(ph);
        break;
      }
      case 'rain':
      case 'tired': {
        const [f, ph] = q((st.p / 2.5) * TAU, 16);
        res.key = 'tired:' + f; res.make = () => Art.Pose.tired(ph);
        break;
      }
      case 'flex': timed('flex', 8, (ph) => Art.Pose.flex(ph)); break;
      case 'shoe':
        if (u < 0.42) run(1, true, 'ns');
        else if (u < 0.78) fixed('kneelns', () => { const p = Art.Pose.kneel(0); p.noShoe = true; return p; });
        else run(0.45);
        break;
      case 'ufo':
      case 'ufogood': {
        const lift = smooth(0.25, 0.4, u) * (1 - smooth(0.78, 0.87, u));
        if (lift > 0.05) { timed('lifted', 8, (ph) => Art.Pose.lifted(ph)); res.dy = -sn(lift * 24 + Math.sin(t * 5) * 1.5); }
        else fixed('standlook', () => { const p = Art.Pose.stand(); p.mouth = 'open'; return p; });
        break;
      }
      case 'cartwheel': {
        const k = Math.floor(t * 12) % 8;
        fixed('star' + k, () => Art.Pose.star((k / 8) * TAU));
        break;
      }
      case 'wave': {
        const [f, ph] = q((st.p / 2.5) * TAU, 16);
        res.key = 'wave:' + f; res.make = () => Art.Pose.wave(ph);
        break;
      }
      case 'celebrate': {
        // at the finale they stop dead and dance before the line
        if (g.finale && u > 0.18 && u < 0.9) {
          timed('cel', 8, (ph) => Art.Pose.celebrate(ph));
          res.dy = -sn(Math.abs(Math.sin(t * 7)) * 5);
          break;
        }
        const [f, ph] = q((st.p / 2.5) * TAU, 16);
        res.key = 'rcel:' + f; res.make = () => Art.Pose.runCelebrate(ph);
        break;
      }
      case 'sleepy': timed('sleepy', 4, (ph) => Art.Pose.sleepy(ph)); break;
      case 'energy':
        if (u < 0.2) { const [f, ph] = q((st.p / 2.5) * TAU, 16); res.key = 'drink:' + f; res.make = () => Art.Pose.drink(ph); }
        else run(1.3);
        break;
      case 'sneeze':
        if (u < 0.3) fixed('sneeze', () => Art.Pose.sneezeWindup());
        else run(1.3);
        break;
      // ---- rides and props
      case 'scooter':
        if (u < 0.82) { fixed('scoot', () => Art.Pose.scoot()); res.dy = -3; }
        else run(0.45);
        break;
      case 'pogo':
        fixed('pogo', () => Art.Pose.pogo());
        res.dy = -sn(4 + Math.abs(Math.sin(t * 8)) * 9);
        break;
      case 'chickenhug':
        if (u < 0.2) run();
        else if (u < 0.85) timed('hugged', 4, (ph) => Art.Pose.hugged(ph));
        else run(0.45);
        break;
      // ---- runner vs runner
      case 'throw':
        if (g.role === 'a') {
          if (u < 0.12) fixed('twind', () => Art.Pose.throwWind());
          else if (u < 0.3) fixed('trel', () => Art.Pose.throwRelease());
          else if (g.laugh && u < 0.9) { const [f, ph] = q((st.p / 2.5) * TAU, 16); res.key = 'rcel:' + f; res.make = () => Art.Pose.runCelebrate(ph); }
          else run();
        } else if (u < Planner.DUO.throw.impact) run();
        else if (u < 0.8) timed('dazed', 8, (ph) => Art.Pose.dazed(ph));
        else run(0.45);
        break;
      case 'shove':
        if (g.role === 'a') { if (u < 0.3) fixed('shove', () => Art.Pose.shove()); else run(); }
        else if (u < 0.22) run();
        else if (u < 0.7) { fixed('stumble', () => Art.Pose.stumble()); res.dx = Math.sin(t * 40) * 1.5; }
        else run(0.45);
        break;
      case 'tripup':
        if (g.role === 'a') { if (u < 0.5) fixed('legout', () => Art.Pose.legOut()); else run(); }
        else if (u < 0.22) run();
        else if (u < 0.3) fixed('stumble', () => Art.Pose.stumble());
        else if (u < 0.75) fixed('fallen', () => Art.Pose.fallen());
        else if (u < 0.85) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      case 'fight':
        if (u < 0.12) fixed('shove', () => Art.Pose.shove());
        else if (u < 0.84) { res.hidden = true; fixed('stand0', () => Art.Pose.stand(false)); }
        else timed('dazed', 8, (ph) => Art.Pose.dazed(ph));
        break;
      case 'highfive':
        if (u > 0.25 && u < 0.55) fixed('hi5', () => Art.Pose.highFive());
        else run(0.6);
        break;
      case 'tackle':
        if (g.role === 'a' && u < 0.15) { fixed('dive', () => Art.Pose.dive()); res.dy = -3; }
        else if (g.role === 'b' && u < 0.15) run();
        else if (u < 0.8) fixed(g.role === 'a' ? 'fallen' : 'onback', () => (g.role === 'a' ? Art.Pose.fallen() : Art.Pose.onBack()));
        else if (u < 0.9) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      case 'bow':
        if (u < 0.15 || u > 0.88) run(0.45);
        else fixed('bow', () => Art.Pose.bow());
        break;
      case 'bazooka': {
        const bd = Planner.BAZOOKA;
        if (u < bd.fire) fixed('aim', () => Art.Pose.aim());
        else if (u < 0.8) { fixed('onback', () => Art.Pose.onBack()); res.dx = -Math.min(1, (u - bd.fire) / 0.1) * 6; }
        else if (u < 0.88) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      }
      case 'blast': {
        const imp = Planner.BAZOOKA.impact;
        if (u < imp) run();
        else if (u < 0.62) {
          // sent flying, spinning
          const k = (u - imp) / (0.62 - imp);
          const f = Math.floor(t * 14 + i) % 8;
          fixed('star' + f, () => Art.Pose.star((f / 8) * TAU));
          res.dy = -sn(Math.sin(k * Math.PI) * g.height);
          res.dx = g.dir * Math.sin(k * Math.PI) * 16;
        } else if (u < 0.84) fixed(i % 2 ? 'fallen' : 'onback', () => (i % 2 ? Art.Pose.fallen() : Art.Pose.onBack()));
        else if (u < 0.92) fixed('kneel0', () => Art.Pose.kneel(0));
        else run(0.45);
        break;
      }
      default: run(1.3);
    }
    return res;
  }

  function idlePose(i, t) {
    const look = G.looks[i];
    const cyc = (t * 0.4 + look.id * 0.37) % 3;
    const [f, ph] = (() => { const n = 8; const fr = Math.floor(((t * 6 + look.id) % TAU) / TAU * n); return [fr, (fr / n) * TAU]; })();
    if (cyc < 1) return { key: 'jog:' + f, make: () => Art.Pose.jogInPlace(ph) };
    if (cyc < 1.4) return { key: 'stretch:' + (f % 4), make: () => Art.Pose.stretch(ph) };
    return { key: 'stand' + (Math.sin(t * 2 + i) > 0 ? 1 : 0), make: () => Art.Pose.stand(Math.sin(t * 2 + i) > 0) };
  }

  function drawRunnerSprite(i, key, make, x, gy, dy) {
    const look = G.looks[i];
    const spr = Art.runnerSprite(look, key, make);
    const S = Art.SPRITE;
    w.fillStyle = 'rgba(0,0,0,0.28)';
    w.fillRect(sn(x) - 5, gy - 1, 11, 2);
    w.fillRect(sn(x) - 3, gy - 2, 7, 1);
    w.drawImage(spr, sn(x) - S.OX, sn(gy - S.OY + (dy || 0)));
  }

  // Draws every runner; returns their screen info for labels.
  function drawRunners(cam, t) {
    const P = G.plan, L = G.lanes, N = P.N;
    const info = [];
    for (let i = 0; i < N; i++) {
      const gy = L.ground(i);
      let x, pose, dy = 0, st = null;
      if (G.mode === 'race') {
        st = pickPose(i, G.raceT);
        x = runnerX(st.p) - cam + (st.dx || 0); pose = st; dy = st.dy || 0;
      } else if (G.mode === 'marks') {
        x = START_X - 3 - cam;
        const m = G.marks;
        if (m.fs && m.fs.i === i && m.t > m.fs.t0 && m.t < m.fs.back) {
          const k = m.t - m.fs.t0;
          const out = Math.min(34, k * 55);
          const ret = m.t > m.fs.t0 + 1.4 ? Math.min(out, (m.t - m.fs.t0 - 1.4) * 45) : 0;
          x += out - ret;
          const [f, ph] = [Math.floor(k * 10) % 12, ((Math.floor(k * 10) % 12) / 12) * TAU];
          pose = ret > 0 ? { key: 'jogb:' + f, make: () => { const p = Art.Pose.run(ph, 0.45); p.flip = true; return p; } } : { key: 'r1:' + f, make: () => Art.Pose.run(ph, 1) };
        } else if (m.phase === 'marks') pose = { key: 'crouch', make: () => Art.Pose.crouch() };
        else if (m.phase === 'set') pose = { key: 'set', make: () => Art.Pose.set() };
        else pose = idlePose(i, t);
      } else {
        x = START_X - 3 - cam;
        pose = idlePose(i, t);
      }
      info.push({ i, x, gy, dy, st, pose });
    }
    // effects that sit behind runners
    if (G.mode === 'race') {
      for (const r of info) drawGagBack(r, cam, t);
      drawBazookaFx(info, cam, t, 'back');
      drawNameTags(info);
      drawGhosts(info, cam);
    }
    for (const r of info) {
      if (r.x < -30 || r.x > VW + 30 || (r.st && r.st.hidden)) continue;
      drawRunnerSprite(r.i, r.pose.key, r.pose.make, r.x, r.gy, r.dy);
      if (G.mode === 'race' && r.st && r.st.v > 6 && Math.random() < 0.03) G.particles.push({ x: r.x - 5 + cam, y: r.gy - 1, vx: -8, vy: -6, g: 14, life: 0, max: 0.35, col: '#e8c9b4', size: 1, world: true, spark: true });
    }
    if (G.mode === 'race') {
      for (const r of info) drawGagFront(r, cam, t);
      drawDuos(info, cam, t);
      drawBazookaFx(info, cam, t, 'front');
    }
    return info;
  }

  // Props and effects tied to a gag.
  function drawGagBack(r, cam, t) {
    const P = G.plan;
    for (const g of P.gags) {
      if (g.i !== r.i) continue;
      if (g.t0 > G.raceT + 3) break;
      const u = (G.raceT - g.t0) / g.dur;
      if (g.type === 'banana' && u < 0.45) {
        if (!g._p) g._p = rstate(g.i, g.t0).p + 0.5;
        let bx = runnerX(g._p) - cam + 4, by = r.gy - 4;
        if (u > 0.05) { const k = (u - 0.05) / 0.4; bx += k * 40; by -= Math.sin(k * Math.PI) * 30 - k * 4; }
        if (G.raceT > g.t0 - 3) w.drawImage(Art.P.banana, sn(bx), sn(by));
      }
      if (g.type === 'shoe' && u > 0 && u < 0.45) {
        if (g._shoe == null) g._shoe = rstate(g.i, g.t0 + g.dur * 0.42).p;
        const k = clamp(u / 0.2, 0, 1);
        const start = rstate(g.i, g.t0).p;
        const sx = runnerX(lerp(start, g._shoe, k)) - cam - 2;
        const sy = r.gy - 3 - Math.sin(k * Math.PI) * 14;
        w.drawImage(Art.P.shoe, sn(sx), sn(sy));
      }
      if (g.type === 'dog' && u > -0.35 && u < 1.45) {
        const fr = Math.floor(t * 12) % 2;
        let dx = r.x - 22 + Math.sin(t * 4) * 3, dyy = r.gy - 9;
        if (u < 0) dx -= (-u) * g.dur * 90;
        if (u > 1) { dx += (u - 1) * g.dur * 60; dyy += (u - 1) * 40; }
        w.drawImage(Art.P.dog[fr], sn(dx), sn(dyy));
      }
      if ((g.type === 'energy' || g.type === 'rocket') && u > (g.type === 'energy' ? 0.2 : 0) && u < 1) {
        for (let k = 0; k < 6; k++) {
          w.fillStyle = k % 2 ? '#ffd23f' : '#ff6a2a';
          w.fillRect(sn(r.x - 7 - Math.random() * (g.type === 'rocket' ? 12 : 7)), sn(r.gy - 1 - Math.random() * 4), 2, 2);
        }
        if (g.type === 'rocket') {
          w.fillStyle = 'rgba(255,255,255,0.7)';
          for (let k = 0; k < 3; k++) w.fillRect(sn(r.x - 30 - Math.random() * 10), sn(r.gy - 8 - Math.random() * 14), 12, 1);
        }
      }
      if (g.type === 'scooter' && u > 0 && u < 1.6) drawScooter(g, r, u, cam, t);
      if (g.type === 'ufo' || g.type === 'ufogood') {
        if (u > -0.1 && u < 1.15) {
          const enter = smooth(-0.1, 0.2, u), leave = smooth(0.88, 1.15, u);
          const ux = r.x - 11;
          const uy = lerp(-20, r.gy - 76, enter) - leave * 90;
          if (u > 0.15 && u < 0.9) {
            w.fillStyle = 'rgba(255,240,120,0.35)';
            w.beginPath(); w.moveTo(ux + 7, uy + 8); w.lineTo(ux + 15, uy + 8); w.lineTo(ux + 22, r.gy + 1); w.lineTo(ux, r.gy + 1); w.closePath(); w.fill();
          }
          w.drawImage(Art.P.ufo, sn(ux), sn(uy));
          for (let k = 0; k < 5; k++) {
            w.fillStyle = (Math.floor(t * 8) + k) % 2 ? '#ffe066' : '#ff4d6d';
            w.fillRect(sn(ux + 4 + k * 4), sn(uy + 6), 2, 1);
          }
        }
      }
    }
  }

  function drawGagFront(r, cam, t) {
    const g = r.st && r.st.gag;
    // thrown items arrive just before the gag starts
    for (const gg of G.plan.gags) {
      if (gg.i !== r.i) continue;
      if (gg.t0 > G.raceT + 1) break;
      if ((gg.type === 'energy' || gg.type === 'hotdog') && G.raceT > gg.t0 - 0.6 && G.raceT < gg.t0) {
        const k = (G.raceT - (gg.t0 - 0.6)) / 0.6;
        const x = lerp(r.x + 50, r.x + 3, k), y = lerp(100, r.gy - 18, k) - Math.sin(k * Math.PI) * 30;
        w.drawImage(gg.type === 'energy' ? Art.P.can : Art.P.hotdog, sn(x), sn(y));
      }
    }
    if (!g) return;
    const u = r.st.u;
    const headY = r.gy - 28 + (r.dy || 0);
    switch (g.type) {
      case 'trip':
      case 'banana':
        if ((g.type === 'trip' && u > 0.12 && u < 0.72) || (g.type === 'banana' && u > 0.3 && u < 0.78)) {
          const cx = r.x + (g.type === 'trip' ? 9 : -9), cy = r.gy - 9;
          for (let k = 0; k < 3; k++) {
            const a = t * 7 + (k * TAU) / 3;
            w.drawImage(Art.P.star, sn(cx + Math.cos(a) * 7 - 2), sn(cy + Math.sin(a) * 2 - 2));
          }
          if (!g._puffed) { g._puffed = true; puff(r.x + cam, r.gy - 2, 10, '#e8d9c4', 30, 12); }
        }
        break;
      case 'pigeon': {
        const fr = Math.floor(t * 14) % 2;
        w.drawImage(Art.P.bird[fr], sn(r.x - 4 + Math.sin(t * 9) * 4), sn(headY - 9 + Math.sin(t * 13) * 2));
        break;
      }
      case 'rain': {
        const cx = r.x - 9, cy = headY - 16;
        w.drawImage(Art.P.cloud, sn(cx), sn(cy));
        w.fillStyle = '#7ec8ff';
        for (let k = 0; k < 6; k++) {
          const d = (t * 70 + k * 9) % 22;
          w.fillRect(sn(cx + 2 + k * 2.6), sn(cy + 8 + d), 1, 2);
        }
        break;
      }
      case 'bees':
        for (let k = 0; k < 6; k++) {
          const bx = r.x - 12 + Math.cos(t * 7 + k * 1.3) * 9, by = headY + 6 + Math.sin(t * 9 + k * 2.1) * 7;
          w.drawImage(Art.P.bee, sn(bx), sn(by));
        }
        break;
      case 'secondwind':
        for (let k = 0; k < 4; k++) {
          const sx = r.x + (Math.random() - 0.5) * 22, sy = r.gy - 4 - Math.random() * 26;
          w.fillStyle = k % 2 ? '#ffffff' : '#ffe066';
          w.fillRect(sn(sx), sn(sy) - 1, 1, 3); w.fillRect(sn(sx) - 1, sn(sy), 3, 1);
        }
        break;
      case 'selfie':
        if (u > 0.45 && u < 0.56) { w.fillStyle = 'rgba(255,255,255,0.9)'; w.fillRect(sn(r.x + 5), sn(headY - 6), 7, 7); }
        break;
      case 'sneeze':
        if (u > 0.28 && !g._puffed) { g._puffed = true; puff(r.x + 6 + cam, headY + 3, 8, '#ffffff', 40, 6); }
        break;
      case 'tired':
      case 'cramp':
        if (Math.random() < 0.15) G.particles.push({ x: r.x + cam, y: headY, vx: (Math.random() - 0.5) * 30, vy: -20, g: 60, life: 0, max: 0.5, col: '#8fd3ff', size: 1, world: true });
        break;
      case 'pogo': {
        // stick from the hands down to the ground, spring at the bottom
        const b = -(r.dy || 0) - 4;
        const sx = sn(r.x + 3);
        w.fillStyle = '#9aa3b5'; w.fillRect(sx, sn(r.gy - 19 - b), 1, 15);
        w.fillStyle = '#1a1a2e'; w.fillRect(sx - 2, sn(r.gy - 19 - b), 5, 1); w.fillRect(sx - 2, sn(r.gy - 5 - b), 5, 1);
        w.fillStyle = '#c9ced9';
        for (let k = 0; k < 3; k++) w.fillRect(sx - (k % 2), sn(r.gy - 4 - b + k), 2, 1);
        if (b < 1 && !g._dust) { g._dust = true; puff(r.x + cam, r.gy - 1, 3, '#e8d9c4', 16, 4); }
        if (b > 3) g._dust = false;
        break;
      }
      case 'sleepy':
        for (let k = 0; k < 3; k++) {
          const ph = (t * 0.8 + k / 3) % 1;
          Art.drawText(w, 'Z', sn(r.x + 6 + ph * 8), sn(r.gy - 18 - ph * 16), 'rgba(255,255,255,' + (1 - ph).toFixed(2) + ')', 1);
        }
        break;
      default:
    }
  }

  // Name tags live in the scene, drawn before the runners, so a runner passing
  // in front always covers the tag (never the other way round).
  function drawNameTags(info) {
    const u = view.s;
    const order = stableOrder();
    const place = new Array(G.plan.N);
    order.forEach((i, k) => { place[i] = k; });
    const fs = clamp(Math.min(6.4, G.lanes.laneH * 0.55), 9 / u, 17 / u);
    w.font = '700 ' + fs.toFixed(2) + 'px "Pixelify Sans", monospace';
    w.textBaseline = 'middle';
    w.textAlign = 'left';
    const maxName = Math.max(40, G.lanes.laneH * 5.5);
    for (const r of info) {
      if (r.x < 4 || r.x > VW + 10) continue;
      let name = G.cfg.names[r.i];
      while (name.length > 1 && w.measureText(name).width > maxName) name = name.slice(0, -1);
      if (name !== G.cfg.names[r.i]) name += '…';
      const label = (place[r.i] + 1) + '  ' + name;
      const wdt = w.measureText(label).width + fs * 0.9;
      const hgt = fs * 1.25;
      const bx = r.x - 8 - wdt, by = r.gy - Math.min(9, G.lanes.laneH * 0.45) - hgt / 2;
      const col = G.looks[r.i].color;
      const c = Math.max(1, u * 0.8) / u; // notched pixel corners
      w.fillStyle = 'rgba(10,10,24,0.85)';
      w.fillRect(bx + c, by - c, wdt - 2 * c, hgt + 2 * c);
      w.fillRect(bx - c, by + c, wdt + 2 * c, hgt - 2 * c);
      w.fillRect(bx, by, wdt, hgt);
      w.fillStyle = col;
      w.fillRect(bx + c, by, wdt - 2 * c, hgt);
      w.fillRect(bx, by + c, wdt, hgt - 2 * c);
      w.fillStyle = lum(col) > 0.62 ? '#10101a' : '#ffffff';
      w.fillText(label, bx + fs * 0.45, by + hgt / 2 + 0.3);
    }
  }

  // In slow motion, the runners in the shot leave faint afterimages.
  function drawGhosts(info, cam) {
    const cg = G.camGag;
    if (!cg || G.timeScale > 0.7) return;
    const who = new Set([cg.i]);
    if (cg.other != null) who.add(cg.other);
    if ((cg.type === 'bazooka' || cg.fan) && G.plan.bazooka) G.plan.bazooka.victims.forEach((v) => who.add(v));
    for (const i of who) {
      const r = info[i];
      if (!r || !r.st || r.st.hidden) continue;
      [[0.07, 0.3], [0.14, 0.14]].forEach(([d, a]) => {
        const x = runnerX(rstate(i, G.raceT - d).p) - cam + (r.st.dx || 0);
        if (Math.abs(x - r.x) < 1.5 && !r.dy) return;
        w.globalAlpha = a;
        const spr = Art.runnerSprite(G.looks[i], r.pose.key, r.pose.make);
        w.drawImage(spr, sn(x) - Art.SPRITE.OX, sn(r.gy - Art.SPRITE.OY + (r.dy || 0) * (1 - d * 3)));
        w.globalAlpha = 1;
      });
    }
  }

  // pixel-art filled circle
  function disc(cx, cy, r, col) {
    w.fillStyle = col;
    for (let y = -r; y <= r; y++) {
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
      w.fillRect(sn(cx - hw), sn(cy + y), hw * 2 + 1, 1);
    }
  }

  // Bazooka: dropped launcher + scorch mark behind, rocket + fireball + sooty faces in front.
  function drawBazookaFx(info, cam, t, layer) {
    const B = G.plan.bazooka;
    if (!B) return;
    const bd = Planner.BAZOOKA, dur = bd.dur;
    const u = (G.raceT - B.t0) / dur;
    if (u < -0.2) return;
    const bp = blastPoint();
    const ix = bp.x - cam, iy = bp.y;
    const E = G.raceT - (B.t0 + bd.impact * dur); // seconds since the blast
    if (layer === 'back') {
      if (E > 0) {
        w.globalAlpha = Math.max(0.25, 0.7 - E * 0.02);
        w.fillStyle = '#2b1d18';
        for (let y = -2; y <= 2; y++) w.fillRect(sn(ix - 16 + Math.abs(y) * 3), iy + 8 + y, 32 - Math.abs(y) * 6, 1);
        w.globalAlpha = 1;
      }
      if (B.shooter >= 0 && u > bd.fire && u < 1.6) {
        const sx = runnerX(rstate(B.shooter, B.t0 + bd.fire * dur).p) - cam - 16;
        w.drawImage(Art.P.bazooka, sn(sx), G.lanes.ground(B.shooter) - 6);
      }
      return;
    }
    // launcher on the shoulder while aiming (runner) or up in the stands (fan)
    if (u < bd.fire + 0.01) {
      const sp = bazookaFrom(G.raceT);
      w.drawImage(Art.P.bazooka, sn(sp.x - cam - 16), sn(sp.y - 3));
      if (B.shooter < 0) { w.fillStyle = '#ffd23f'; w.fillRect(sn(sp.x - cam - 20), sn(sp.y - 6), 3, 3); }
      if (u > bd.fire - 0.02) disc(sp.x - cam + 2, sp.y, 4, '#fff3b0');
    }
    // the rocket
    if (u >= bd.fire && u < bd.impact) {
      const k = (u - bd.fire) / (bd.impact - bd.fire);
      const sp = bazookaFrom(B.t0 + bd.fire * dur);
      const x = lerp(sp.x, bp.x, k) - cam, y = lerp(sp.y, iy, k) - Math.sin(k * Math.PI) * 10;
      w.drawImage(Art.P.rocket, sn(x - 4), sn(y - 3));
      w.fillStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff7a2a';
      w.fillRect(sn(x - 7), sn(y - 1), 3, 2);
      if (Math.random() < 0.7) G.particles.push({ x: x + cam - 6, y: y, vx: -6, vy: -4, g: -2, life: 0, max: 0.9, col: '#bdbdbd', size: 2, world: true, spark: true });
    }
    // fireball and shockwave
    if (E >= 0 && E < 1.2) {
      const grow = Math.sqrt(Math.min(1, E / 0.3));
      const R = 5 + 28 * grow;
      const fade = Math.max(0, 1 - E / 1.2);
      if (E < 0.45) {
        w.globalAlpha = Math.max(0, 1 - E / 0.45) * 0.8;
        w.strokeStyle = '#ffffff'; w.lineWidth = 1;
        w.beginPath(); w.arc(ix, iy, 12 + E * 170, 0, TAU); w.stroke();
        w.globalAlpha = 1;
      }
      if (E < 0.9) {
        disc(ix, iy, Math.round(R), E < 0.1 ? '#ffffff' : E < 0.5 ? '#ff7a2a' : '#8a3b1f');
        disc(ix, iy - 2, Math.round(R * 0.7), E < 0.15 ? '#fff3b0' : E < 0.55 ? '#ffd23f' : '#6b6b6b');
        if (E < 0.4) disc(ix, iy - 3, Math.round(R * 0.4), '#ffffff');
      }
      w.globalAlpha = fade;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + E * 2;
        disc(ix + Math.cos(a) * R * 0.9, iy - 4 + Math.sin(a) * R * 0.5 - E * 14, Math.round(4 + E * 6), k % 2 ? '#7d7d7d' : '#9a9a9a');
      }
      w.globalAlpha = 1;
    }
    // sooty faces (with big white eyes) on everyone who got blasted
    if (E > 0 && E < 6) {
      const a = Math.min(1, (6 - E) / 1.5);
      for (const v of B.victims.concat(B.shooter >= 0 ? [B.shooter] : [])) {
        const r = info[v];
        if (!r || r.x < -20 || r.x > VW + 20) continue;
        const hx = r.x - 1, hy = r.gy - 28 + (r.dy || 0);
        const flat = r.st && /fallen|onback|star/.test(r.pose.key);
        if (flat) continue;
        w.globalAlpha = a;
        w.fillStyle = '#262626'; w.fillRect(sn(hx), sn(hy), 7, 5);
        w.fillStyle = '#ffffff'; w.fillRect(sn(hx + 3), sn(hy + 1), 1, 1); w.fillRect(sn(hx + 5), sn(hy + 1), 1, 1);
        w.globalAlpha = 1;
        if (Math.random() < 0.05) G.particles.push({ x: r.x + cam + 1, y: hy - 2, vx: 0, vy: -10, g: -2, life: 0, max: 1, col: '#8d8d8d', size: 2, world: true, spark: true });
      }
    }
  }

  // ================================================================ referee, scooter, duos
  const REF = Art.makeReferee();
  // Referee runs in from the right, blows the whistle, shows a yellow card, runs off.
  function drawReferee(x, gy, k, say) {
    // k: 0..1 through the referee's visit
    const inX = x + lerp(70, 0, smooth(0, 0.25, k)) + (k > 0.9 ? (k - 0.9) * 700 : 0);
    let key, make;
    if (k < 0.25 || k > 0.9) {
      const f = Math.floor(G.now * 12) % 16, ph = (f / 16) * TAU, flip = k < 0.25;
      key = 'refrun' + (flip ? 'f' : '') + f;
      make = () => { const p = Art.Pose.run(ph, 1); p.flip = flip; return p; };
    } else if (k < 0.55) { key = 'refwh'; make = () => Art.Pose.refWhistle(); }
    else { key = 'refcard'; make = () => Art.Pose.refCard(); }
    const spr = Art.runnerSprite(REF, key, make);
    const S = Art.SPRITE;
    w.fillStyle = 'rgba(0,0,0,0.28)'; w.fillRect(sn(inX) - 5, gy - 1, 11, 2);
    w.drawImage(spr, sn(inX) - S.OX, sn(gy - S.OY));
    if (say && k > 0.25 && k < 0.85) G.extraBubbles.push({ x: inX, y: gy - 36, text: say });
  }

  function drawScooter(g, r, u, cam, t) {
    const riding = u < 0.82;
    let x = r.x, gy = r.gy;
    if (!riding) {
      if (g.variant === 'referee') return; // confiscated
      if (g._park == null) g._park = runnerX(rstate(g.i, g.t0 + g.dur * 0.82).p);
      x = g._park - cam;
      if (u > 1.5) return;
    }
    const lime = '#7ed957';
    // deck, wheels, stem, handlebar
    const ol = '#10101a';
    if (riding) {
      // outline first, then the parts: deck, wheels, stem, handlebar, headlight
      w.fillStyle = ol;
      w.fillRect(sn(x - 11), gy - 6, 20, 4); w.fillRect(sn(x + 5), gy - 22, 5, 18); w.fillRect(sn(x + 2), gy - 23, 10, 4);
      w.fillRect(sn(x - 11), gy - 3, 5, 4); w.fillRect(sn(x + 4), gy - 3, 5, 4);
      w.fillStyle = lime; w.fillRect(sn(x - 10), gy - 5, 18, 2);
      w.fillStyle = '#2f3a2a'; w.fillRect(sn(x - 10), gy - 4, 18, 1);
      w.fillStyle = lime; w.fillRect(sn(x + 6), gy - 21, 3, 16);
      w.fillStyle = '#2a2a2a'; w.fillRect(sn(x + 3), gy - 22, 8, 2);
      w.fillStyle = '#ffe066'; w.fillRect(sn(x + 9), gy - 17, 2, 2);
      w.fillStyle = '#3a3a3a'; w.fillRect(sn(x - 10), gy - 2, 3, 2); w.fillRect(sn(x + 5), gy - 2, 3, 2);
    } else {
      // tipped over on the track
      w.fillStyle = ol; w.fillRect(sn(x - 11), gy - 4, 34, 5);
      w.fillStyle = lime; w.fillRect(sn(x - 10), gy - 3, 18, 2); w.fillRect(sn(x + 8), gy - 3, 14, 2);
      w.fillStyle = '#3a3a3a'; w.fillRect(sn(x - 10), gy - 1, 3, 1); w.fillRect(sn(x + 4), gy - 1, 3, 1);
    }
    if (riding && u > 0.1 && u < 0.62) {
      w.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 3; k++) w.fillRect(sn(x - 26 - Math.random() * 10), sn(gy - 4 - Math.random() * 18), 10, 1);
    }
    if (g.variant === 'battery' && u > 0.62 && u < 0.82 && Math.random() < 0.3) {
      G.particles.push({ x: x - 8 + cam, y: gy - 4, vx: -6, vy: -14, g: -4, life: 0, max: 0.8, col: '#9a9a9a', size: 2, world: true, spark: true });
    }
    if (g.variant === 'referee' && u > 0.58 && u < 1.1) drawReferee(x + 20, gy + 2, (u - 0.58) / 0.52, 'NO SCOOTERS!');
  }

  // Effects for two-runner gags, drawn on top of everyone.
  function drawDuos(info, cam, t) {
    const P = G.plan, DUO = Planner.DUO;
    for (const g of P.gags) {
      if (g.t0 > G.raceT + 0.5) break;
      if (g.type === 'chickenhug') { drawChickenHug(g, info[g.i], cam, t); continue; }
      if (!g.duo || g.role !== 'a') continue;
      const u = (G.raceT - g.t0) / g.dur;
      if (u < 0 || u > 1.3) continue;
      const ra = info[g.i], rb = info[g.other];
      const imp = DUO[g.type].impact;
      if (g.type === 'throw') {
        if (u >= 0.18 && u < imp) {
          const k = (u - 0.18) / (imp - 0.18);
          const sx = ra.x + 4, sy = ra.gy - 24 + ra.dy, ex = rb.x + 1, ey = rb.gy - 27 + rb.dy;
          const img = Art.P.throwables[g.variant];
          const x = lerp(sx, ex, k), y = lerp(sy, ey, k) - Math.sin(k * Math.PI) * (12 + Math.abs(ex - sx) * 0.15);
          w.drawImage(img, sn(x - img.width / 2), sn(y - img.height / 2));
        }
        if (u >= imp && u < 0.85) {
          const hx = rb.x - 1, hy = rb.gy - 28 + rb.dy;
          if (!g._hit) {
            g._hit = true;
            const col = { pie: '#fffaf0', balloon: '#3aa0ff', tomato: '#e5372b', chicken: '#ffd23f' }[g.variant];
            puff(rb.x + 2 + cam, hy + 2, g.variant === 'balloon' ? 18 : 10, col, 50, 22);
          }
          const drip = Math.min(5, (u - imp) * 14);
          if (g.variant === 'pie' || g.variant === 'tomato') {
            w.fillStyle = g.variant === 'pie' ? '#fffaf0' : '#e5372b';
            w.fillRect(sn(hx), sn(hy), 7, 5);
            w.fillRect(sn(hx + 1), sn(hy + 5), 1, drip); w.fillRect(sn(hx + 4), sn(hy + 5), 1, drip * 0.6);
            if (g.variant === 'tomato') { w.fillStyle = '#ffe0a0'; w.fillRect(sn(hx + 2), sn(hy + 2), 1, 1); w.fillRect(sn(hx + 5), sn(hy + 1), 1, 1); }
          } else if (g.variant === 'balloon') {
            w.fillStyle = '#7ec8ff';
            for (let k = 0; k < 4; k++) w.fillRect(sn(hx + k * 2), sn(hy + 3 + ((t * 30 + k * 5) % 14)), 1, 2);
          } else {
            for (let k = 0; k < 3; k++) {
              const a = t * 7 + (k * TAU) / 3;
              w.drawImage(Art.P.star, sn(hx + 3 + Math.cos(a) * 7 - 2), sn(hy - 4 + Math.sin(a) * 2 - 2));
            }
            w.drawImage(Art.P.throwables.chicken, sn(rb.x + 8), rb.gy - 5);
          }
        }
      } else if (g.type === 'shove' || g.type === 'tripup') {
        if (u >= imp && u < imp + 0.12) {
          const cx = (ra.x + rb.x) / 2 + (g.type === 'tripup' ? -6 : 3), cy = (ra.gy + rb.gy) / 2 - (g.type === 'tripup' ? 6 : 16);
          w.drawImage(Art.P.star, sn(cx - 2), sn(cy - 2));
          w.fillStyle = '#ffffff'; w.fillRect(sn(cx - 5), sn(cy), 3, 1); w.fillRect(sn(cx + 3), sn(cy), 3, 1);
          if (!g._hit) { g._hit = true; puff(rb.x + cam, rb.gy - 2, 8, '#e8d9c4', 30, 10); }
        }
        if (g.type === 'tripup' && u > 0.3 && u < 0.75) {
          for (let k = 0; k < 3; k++) {
            const a = t * 7 + (k * TAU) / 3;
            w.drawImage(Art.P.star, sn(rb.x + 9 + Math.cos(a) * 7 - 2), sn(rb.gy - 11 + Math.sin(a) * 2 - 2));
          }
        }
      } else if (g.type === 'fight') {
        const grow = smooth(0.1, 0.17, u) * (1 - smooth(0.8, 0.87, u));
        if (grow > 0.02) {
          const cx = (ra.x + rb.x) / 2, cy = (ra.gy + rb.gy) / 2 - 12;
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * TAU + t * 3;
            const px = cx + Math.cos(a) * 12 * grow + Math.sin(t * 17 + k) * 1.5, py = cy + Math.sin(a) * 8 * grow;
            w.drawImage(Art.P.puff, sn(px - 7), sn(py - 4));
          }
          w.drawImage(Art.P.puff, sn(cx - 7), sn(cy - 4));
          // fists, shoes and stars flying out
          const pops = [Art.P.fist, Art.P.shoe, Art.P.star, Art.P.fist];
          for (let k = 0; k < 2; k++) {
            const img = pops[Math.floor(t * 9 + k * 2) % pops.length];
            const a = ((Math.floor(t * 9) * 2.3 + k * 3.1) % TAU);
            w.drawImage(img, sn(cx + Math.cos(a) * 17 * grow), sn(cy + Math.sin(a) * 11 * grow));
          }
          const sym = '#$&!*?';
          const off = Math.floor(t * 6) % sym.length;
          const word = (sym + sym).slice(off, off + 4);
          Art.drawText(w, word, sn(cx - 7), sn(cy - 20 - Math.abs(Math.sin(t * 5)) * 2), '#ffd23f', 1);
        }
        if (u > 0.58 && u < 1.12) drawReferee((ra.x + rb.x) / 2 + 24, Math.max(ra.gy, rb.gy) + 3, (u - 0.58) / 0.54, 'BREAK IT UP!');
      } else if (g.type === 'tackle') {
        if (u >= imp && !g._hit) { g._hit = true; puff((ra.x + rb.x) / 2 + cam, Math.max(ra.gy, rb.gy) - 3, 16, '#e8d9c4', 50, 16); }
        if (u > imp && u < 0.8) {
          for (const r of [ra, rb]) {
            for (let k = 0; k < 3; k++) {
              const a = t * 7 + (k * TAU) / 3;
              w.drawImage(Art.P.star, sn(r.x + 9 * (r === ra ? 1 : -1) + Math.cos(a) * 7 - 2), sn(r.gy - 11 + Math.sin(a) * 2 - 2));
            }
          }
        }
      } else if (g.type === 'highfive') {
        if (u >= imp && u < imp + 0.14) {
          const cx = (ra.x + rb.x) / 2 + 2, cy = Math.min(ra.gy, rb.gy) - 30;
          const k = (u - imp) / 0.14, rr = 3 + k * 8;
          w.fillStyle = '#ffe066';
          for (let j = 0; j < 8; j++) {
            const a = (j / 8) * TAU;
            w.fillRect(sn(cx + Math.cos(a) * rr), sn(cy + Math.sin(a) * rr), 2, 2);
          }
          w.fillStyle = '#ffffff'; w.fillRect(sn(cx - 1), sn(cy - 3), 2, 7); w.fillRect(sn(cx - 3), sn(cy - 1), 7, 2);
        }
      }
    }
  }

  function drawChickenHug(g, r, cam, t) {
    const u = (G.raceT - g.t0) / g.dur;
    if (u < 0 || u > 1.35 || !r) return;
    const fr = Math.floor(t * 10) % 2;
    // the mascot is big: draw it at double size, feet on the ground
    const img = Art.P.chicken[u > 0.2 && u < 0.85 ? 0 : fr];
    const cw = img.width * 2, ch = img.height * 2;
    let x, y;
    if (u < 0.2) { const k = u / 0.2; x = lerp(r.x + 60, r.x - 4, k); y = lerp(r.gy + 20, r.gy, k); }
    else if (u < 0.85) { x = r.x - 4 + Math.sin(t * 14) * 0.8; y = r.gy; }
    else { const k = (u - 0.85) / 0.5; x = r.x - 4 + k * 110; y = r.gy + k * 40; }
    w.drawImage(img, 0, 0, img.width, img.height, sn(x), sn(y - ch + 1), cw, ch);
    if (u > 0.2 && u < 0.85 && Math.random() < 0.08) {
      G.particles.push({ x: r.x + 6 + cam, y: r.gy - 30, vx: (Math.random() - 0.5) * 10, vy: -18, g: -6, life: 0, max: 0.9, col: '#ff5c8a', size: 2, world: true, spark: true });
    }
  }

  // ================================================================ camera
  // The gag the camera should show at race time t (one at a time; never near the finish).
  function camGag(t) {
    const P = G.plan;
    for (const g of P.gags) {
      if (g.t0 > t + 0.4) break;
      if (g.type === 'sleepy' || g.role === 'b' || (g.role === 'victim' && !g.fan) || g.t0 + g.dur > P.T1 - 2) continue;
      if (t >= g.t0 - 0.35 && t < g.t0 + g.dur + 0.1) return g;
    }
    return null;
  }
  // where the bazooka rocket lands (world coords)
  function blastPoint() {
    const B = G.plan.bazooka, bd = Planner.BAZOOKA;
    return { x: runnerX(rstate(B.aim, B.t0 + bd.impact * bd.dur).p) + 2, y: G.lanes.ground(B.aim) - 8 };
  }
  function bazookaFrom(t) {
    const B = G.plan.bazooka;
    if (B.shooter >= 0) return { x: runnerX(rstate(B.shooter, t).p) + 13, y: G.lanes.ground(B.shooter) - 21 };
    const bp = blastPoint();
    return { x: bp.x - 95, y: 84 };
  }
  function gagFocus(g, t) {
    if (g.type === 'bazooka' || g.fan) {
      const bd = Planner.BAZOOKA, u = (t - g.t0) / g.dur, bp = blastPoint();
      if (u > bd.impact) return { x: bp.x, y: bp.y - 6 };
      const sp = bazookaFrom(t);
      return { x: (sp.x + bp.x) / 2, y: Math.max(sp.y, (sp.y + bp.y) / 2) };
    }
    const a = runnerX(rstate(g.i, t).p), ya = G.lanes.ground(g.i);
    if (!g.duo) return { x: a, y: ya - 14 };
    const b = runnerX(rstate(g.other, t).p), yb = G.lanes.ground(g.other);
    return { x: (a + b) / 2, y: (ya + yb) / 2 - 14 };
  }

  function updateCamera(dt) {
    const P = G.plan;
    if (G.mode === 'reveal') return;
    if (G.mode !== 'race') { G.camX = lerp(G.camX, 0, 1 - Math.exp(-dt * 4)); return; }
    let lead = -1e9, last = 1e9;
    for (let i = 0; i < P.N; i++) {
      const x = runnerX(rstate(i, G.raceT).p);
      if (x > lead) lead = x;
      if (x < last) last = x;
    }
    let target = (lead + last) / 2 - VW * 0.5;
    target = clamp(target, lead - VW * 0.72, lead - VW * 0.45);
    // during a gag, keep the action in the middle of the screen
    if (G.camCenter != null) target = G.camCenter - VW * 0.5;
    target = clamp(target, 0, FINISH_X() - VW * 0.62);
    G.camX = lerp(G.camX, target, 1 - Math.exp(-dt * 2.2));
  }

  // ================================================================ world render
  function renderWorld(t) {
    const cam = sn(G.camX);
    G.extraBubbles = [];
    w.setTransform(K, 0, 0, K, 0, 0);
    w.clearRect(0, 0, VW, VH);
    if (G.mode === 'reveal') { renderPodium(t); return null; }
    drawSky(cam, t);
    drawStands(cam, t);
    drawGlobals(t);
    drawTrack(cam);
    drawFinishGantry(cam, t);
    const info = drawRunners(cam, t);
    drawParticles(cam);
    return info;
  }

  // ================================================================ HUD helpers
  function F(size, weight, title) {
    return (weight || 600) + ' ' + Math.round(size) + 'px ' + (title ? '"Press Start 2P", ' : '') + '"Pixelify Sans", monospace';
  }
  function txt(str, x, y, size, color, o) {
    o = o || {};
    sctx.font = F(size, o.weight, o.title);
    sctx.textAlign = o.align || 'left';
    sctx.textBaseline = o.base || 'middle';
    if (o.stroke) {
      sctx.lineJoin = 'round'; sctx.lineWidth = o.strokeW || Math.max(2, size / 4);
      sctx.strokeStyle = o.stroke; sctx.strokeText(str, x, y);
    }
    sctx.fillStyle = color;
    sctx.fillText(str, x, y);
  }
  function tw(str, size, weight, title) { sctx.font = F(size, weight, title); return sctx.measureText(str).width; }
  function fit(str, size, maxW, weight) {
    if (tw(str, size, weight) <= maxW) return str;
    let s = str;
    while (s.length > 1 && tw(s + '…', size, weight) > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  // Box with notched pixel corners.
  function pbox(x, y, wd, ht, c, fill, border) {
    sctx.fillStyle = border || fill;
    if (border) {
      sctx.fillRect(x + c, y - c, wd - 2 * c, ht + 2 * c);
      sctx.fillRect(x - c, y + c, wd + 2 * c, ht - 2 * c);
      sctx.fillRect(x, y, wd, ht);
    }
    sctx.fillStyle = fill;
    sctx.fillRect(x + c, y, wd - 2 * c, ht);
    sctx.fillRect(x, y + c, wd, ht - 2 * c);
  }
  function lum(hex) { const c = Art.rgb(hex); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  function fmtTime(t) {
    if (t >= 60) { const m = Math.floor(t / 60); const s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); }
    return t.toFixed(2);
  }
  function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH'); }

  // world-canvas pixel -> CSS pixel (includes the finish zoom)
  let crop = { x: 0, y: 0, w: VW, h: VH };
  const SX = (x) => view.ox + (x - crop.x) * view.s * (VW / crop.w);
  const SY = (y) => view.oy + (y - crop.y) * view.s * (VH / crop.h);

  const AVATARS = [
    Art.pixmap([
      '...hhhhhh...',
      '..hhhhhhhh..',
      '.dsssssssss.',
      'dssessssess.',
      'dssssssssss.',
      'dsssssssnss.',
      '.ssmmmmmmss.',
      '.sssrrrrsss.',
      '..ssssssss.k',
      '...ssssss.k.',
      '..bbbbbbbbk.',
      '.bbbbbbbbbb.',
    ], { h: '#6b4a2a', s: '#e8b48a', d: '#222', e: '#141414', n: '#c98d64', m: '#5a3a22', r: '#8a2a2a', b: '#1e63d6', k: '#333' }, true),
    Art.pixmap([
      '..hhhhhhhh..',
      '.hhhhhhhhhh.',
      'hhsssssssshh',
      'hsseesseessh',
      'hssssssssssh',
      'hsssssnsssshd',
      'hhssrrrrsshhd',
      'hhhssssssh.d.',
      'hh.ssssss.kk.',
      '...ssssss....',
      '..pppppppp...',
      '.pppppppppp..',
    ], { h: '#1a1a1a', s: '#8a5433', e: '#141414', n: '#6e3f24', r: '#ff5c7a', p: '#e53935', d: '#333', k: '#333' }, true),
  ];
  const HOSTS = ['BOB', 'SUE'];

  // ================================================================ HUD
  // Cinematic frame: vignette + letterbox bars, drawn over the world and under the HUD.
  function renderCinema() {
    const lb = G.lb || 0;
    if (lb < 0.01) return;
    const u = view.s, X0 = view.ox, Y0 = view.oy, WW = VW * u, HH = VH * u;
    const g = sctx.createRadialGradient(X0 + WW / 2, Y0 + HH / 2, HH * 0.35, X0 + WW / 2, Y0 + HH / 2, WW * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + (0.5 * lb).toFixed(3) + ')');
    sctx.fillStyle = g;
    sctx.fillRect(X0, Y0, WW, HH);
    const bar = 30 * u * lb;
    sctx.fillStyle = '#05060d';
    sctx.fillRect(X0, Y0, WW, bar);
    sctx.fillRect(X0, Y0 + HH - bar, WW, bar);
  }

  // Title card that slides in when the gag cam (or the finale) starts.
  const CARD = {
    trip: 'FACE PLANT!', banana: 'BANANA!', laces: 'LACE BREAK', selfie: 'SELFIE TIME', phone: 'INCOMING CALL', hotdog: 'SNACK BREAK',
    cramp: 'CRAMP!', wrongway: 'WRONG WAY!', moonwalk: 'MOONWALK!', pigeon: 'BIRD ATTACK!', rain: 'PERSONAL STORM', autograph: 'FAN SERVICE',
    flex: 'FLEX TIME', tired: 'OUT OF GAS', shoe: 'SHOE LOST!', ufo: 'ABDUCTION!', ufogood: 'ALIEN ASSIST', cartwheel: 'CARTWHEELS!',
    wave: 'HI MOM!', celebrate: 'TOO EARLY!', energy: 'POWER UP!', dog: 'DOG CHASE!', bees: 'BEES!!!', sneeze: 'ACHOO!',
    secondwind: 'SECOND WIND', rocket: 'ROCKET SHOES', scooter: 'E-SCOOTER!', pogo: 'POGO TIME', chickenhug: 'MASCOT HUG!', bow: 'TA-DA?!',
    shove: 'PUSHY!', tripup: 'SNEAKY TRIP!', fight: 'FIGHT!', highfive: 'HIGH FIVE!', tackle: 'TACKLE!', bazooka: 'BAZOOKA!!',
    pie: 'PIE ATTACK!', balloon: 'WATER BOMB!', tomato: 'TOMATO!', chicken: 'CHICKEN STRIKE!',
  };
  function showCard(g, F) {
    const nm = (i) => G.cfg.names[i];
    let title, sub, hot = false;
    if (F) {
      hot = true;
      title = F.kind === 'solo' ? CARD[F.type] : F.kind === 'throw' ? CARD[F.variant] : CARD[F.type];
      sub = F.kind === 'solo' ? nm(F.target) + ' was about to win...' : nm(F.actor) + ' → ' + nm(F.target);
    } else if (g.type === 'bazooka' || g.fan) {
      hot = true;
      title = CARD.bazooka;
      sub = (g.fan ? 'A fan' : nm(g.i)) + ' → the front of the pack';
    } else {
      title = g.type === 'throw' ? CARD[g.variant] : CARD[g.type] || 'WHOA!';
      if (!g.duo) sub = nm(g.i);
      else if (g.type === 'fight') sub = nm(g.i) + ' vs ' + nm(g.other);
      else if (g.type === 'highfive') sub = nm(g.i) + ' & ' + nm(g.other);
      else sub = nm(g.i) + ' → ' + nm(g.other);
    }
    G.card = { title, sub, hot, at: G.now, out: null };
  }
  // Comic-book impact words: pop in on a starburst, hang a moment, fade.
  function renderWords() {
    const u = view.s;
    G.words = G.words.filter((wd) => G.now - wd.at < 1.1);
    for (const wd of G.words) {
      const age = G.now - wd.at;
      const pop = age < 0.1 ? age / 0.1 * 1.25 : Math.max(1, 1.25 - (age - 0.1) * 1.5);
      const alpha = age > 0.75 ? Math.max(0, 1 - (age - 0.75) / 0.35) : 1;
      const cx = SX(wd.x - G.camX), cy = SY(wd.y);
      const size = (wd.big ? 20 : 11) * u * pop;
      sctx.globalAlpha = alpha;
      // starburst
      const pts = 12, r1 = size * (wd.big ? 2.6 : 2.1), r2 = r1 * 0.62;
      sctx.beginPath();
      for (let k = 0; k < pts * 2; k++) {
        const a = (k / (pts * 2)) * TAU + wd.at;
        const rr = k % 2 ? r2 : r1;
        const px = cx + Math.cos(a) * rr * 1.25, py = cy + Math.sin(a) * rr * 0.75;
        if (k) sctx.lineTo(px, py); else sctx.moveTo(px, py);
      }
      sctx.closePath();
      sctx.fillStyle = wd.big ? '#ff5a1f' : '#ffd23f';
      sctx.fill();
      sctx.lineWidth = Math.max(2, u * 1.2);
      sctx.strokeStyle = '#10101a';
      sctx.stroke();
      txt(wd.word, cx, cy + size * 0.08, size, wd.big ? '#fff3b0' : '#e53935', { weight: 700, title: true, align: 'center', stroke: '#10101a', strokeW: size * 0.32 });
      sctx.globalAlpha = 1;
    }
  }

  function renderCard() {
    const c = G.card;
    if (!c) return;
    const u = view.s, X0 = view.ox, Y0 = view.oy;
    const kin = smooth(0, 0.35, G.now - c.at);
    const kout = c.out ? smooth(0, 0.3, G.now - c.out) : 0;
    if (kout >= 1) { G.card = null; return; }
    const ts = Math.max(12, 9 * u), ss = Math.max(10, 6.2 * u);
    const wdt = Math.max(tw(c.title, ts, 700, true), tw(c.sub, ss, 700)) + 26 * u;
    const hgt = 30 * u;
    const x = X0 + 8 * u - (wdt + 20 * u) * (1 - kin) - (wdt + 20 * u) * kout;
    const y = Y0 + 36 * u;
    const accent = c.hot ? '#ff5a5f' : '#ffd23f';
    pbox(x, y, wdt, hgt, Math.max(1, u), 'rgba(10,12,30,0.94)', accent);
    sctx.fillStyle = accent;
    sctx.fillRect(x, y, 4 * u, hgt);
    txt(c.title, x + 10 * u, y + 10.5 * u, ts, accent, { weight: 700, title: true });
    txt(c.sub, x + 10 * u, y + 22.5 * u, ss, '#ffffff', { weight: 700 });
    if (G.timeScale < 0.8) {
      const on = Math.floor(G.now * 3) % 2;
      txt('● SLOW-MO', x + wdt - 6 * u, y - 5 * u, Math.max(9, 5.2 * u), on ? '#ff6b6b' : '#ffffff', { weight: 700, align: 'right', stroke: '#05060d', strokeW: 3 * u });
    }
  }

  function renderHUD(info, t) {
    const u = view.s;
    const P = G.plan;
    const X0 = view.ox, Y0 = view.oy, WW = VW * u;
    if (G.mode === 'race') renderCinema();
    if (G.mode === 'race' || G.mode === 'marks') {
      // one slim bar: clock | live top 5 | meters to go
      const bh = 15 * u;
      sctx.fillStyle = 'rgba(8,10,26,0.82)';
      sctx.fillRect(X0, Y0, WW, bh);
      sctx.fillStyle = 'rgba(255,210,63,0.9)';
      sctx.fillRect(X0, Y0 + bh, WW, Math.max(1, u * 0.5));
      const mid = Y0 + bh / 2 + u * 0.4;
      const small = Math.max(11, 7 * u);
      const clock = G.mode === 'race' ? fmtClock(G.raceT) : '0.0';
      txt(clock, X0 + 8 * u, mid, Math.max(13, 9 * u), '#ffffff', { weight: 700 });
      const leadP = G.mode === 'race' ? Math.max(...info.map((r) => r.st.p)) : 0;
      const togo = Math.max(0, Math.ceil(P.D - leadP));
      const right = togo > 0 ? togo + ' M TO GO' : 'FINISHED!';
      txt(right, X0 + WW - 8 * u, mid, small, togo > 0 && togo <= 50 ? '#ff8a8a' : '#b9c3e6', { weight: 700, align: 'right' });
      const cx0 = X0 + 58 * u, cx1 = X0 + WW - 72 * u;
      if (G.mode === 'marks') {
        txt(fit(G.cfg.title, small, cx1 - cx0, 700), (cx0 + cx1) / 2, mid, small, '#ffd23f', { weight: 700, align: 'center' });
      } else {
        drawTicker(cx0, cx1, mid, small, u);
      }
      // mini-map along the bottom edge of the bar
      const mx0 = X0 + 8 * u, mx1 = X0 + WW - 8 * u, my = Y0 + bh + 4 * u;
      sctx.fillStyle = 'rgba(8,10,26,0.55)';
      sctx.fillRect(mx0 - 3 * u, my - 2.5 * u, mx1 - mx0 + 6 * u, 5 * u);
      sctx.fillStyle = 'rgba(255,255,255,0.35)'; sctx.fillRect(mx0, my - 0.3 * u, mx1 - mx0, Math.max(1, 0.6 * u));
      for (let k = 0; k < 4; k++) { sctx.fillStyle = k % 2 ? '#111' : '#fff'; sctx.fillRect(mx1, my - 2 * u + k * u, u, u); }
      const pts = info.map((r) => ({ i: r.i, p: G.mode === 'race' ? r.st.p : 0 })).sort((a, b) => a.p - b.p);
      for (const pt of pts) {
        const x = mx0 + (mx1 - mx0) * clamp(pt.p / P.D, 0, 1);
        sctx.fillStyle = '#0b0b18'; sctx.fillRect(x - 1.8 * u, my - 1.8 * u, 3.6 * u, 3.6 * u);
        sctx.fillStyle = G.looks[pt.i].color; sctx.fillRect(x - 1.2 * u, my - 1.2 * u, 2.4 * u, 2.4 * u);
      }
    }

    if (G.mode === 'race') {
      const order = stableOrder();
      const place = new Array(P.N);
      order.forEach((i, k) => { place[i] = k; });
      // name tags + offscreen markers
      const fs = clamp(Math.min(6.4, G.lanes.laneH * 0.55) * u, 9, 17);
      for (const r of info) {
        const look = G.looks[r.i];
        const name = G.cfg.names[r.i];
        const yy = SY(r.gy - Math.min(9, G.lanes.laneH * 0.45));
        if (r.x < 4) {
          const s = '◀ ' + (place[r.i] + 1) + ' ' + fit(name, fs * 0.9, 60 * u, 700);
          const wdt = tw(s, fs * 0.9, 700) + fs * 0.8;
          pbox(X0 + 2 * u, yy - fs * 0.62, wdt, fs * 1.25, Math.max(1, u * 0.8), 'rgba(10,10,24,0.82)');
          txt(s, X0 + 2 * u + fs * 0.4, yy, fs * 0.9, look.color, { weight: 700 });
          continue;
        }
        // on-screen tags are drawn in the scene, underneath the runners (see drawNameTags)
      }
      // speech bubbles: runners, plus the referee
      const bubble = (x, y, text) => {
        const vx0 = crop.x, vx1 = crop.x + crop.w;
        if (x < vx0 + 6 || x > vx1 - 2) return; // only for runners actually in view
        const bs = clamp(7 * u, 11, 20);
        const wdt = tw(text, bs, 700) + bs * 1.1;
        const px = SX(x);
        const bx = clamp(px - wdt / 2, X0 + 4, X0 + WW - wdt - 4);
        const by = Math.max(Y0 + 22 * u, SY(y) - bs * 1.3);
        pbox(bx, by, wdt, bs * 1.5, Math.max(1, u), '#ffffff', '#10101a');
        sctx.fillStyle = '#10101a';
        sctx.beginPath(); sctx.moveTo(px - 3 * u, by + bs * 1.5); sctx.lineTo(px + 3 * u, by + bs * 1.5); sctx.lineTo(px, by + bs * 1.5 + 5 * u); sctx.fill();
        sctx.fillStyle = '#ffffff';
        sctx.beginPath(); sctx.moveTo(px - 1.8 * u, by + bs * 1.5 - 1); sctx.lineTo(px + 1.8 * u, by + bs * 1.5 - 1); sctx.lineTo(px, by + bs * 1.5 + 3 * u); sctx.fill();
        txt(text, bx + wdt / 2, by + bs * 0.78, bs, '#10101a', { weight: 700, align: 'center' });
      };
      for (const b of P.bubbles) {
        if (G.raceT < b.t0 || G.raceT > b.t1) continue;
        const r = info[b.i];
        bubble(r.x, r.gy - 36 + (r.dy || 0), b.text);
      }
      for (const b of G.extraBubbles) bubble(b.x, b.y, b.text);

    }

    if (G.mode === 'race') { renderWords(); renderCard(); }

    // commentary box
    if (G.line && (G.mode === 'race' || G.mode === 'marks' || G.mode === 'reveal')) {
      const ln = G.line;
      const expired = ln.endReal != null ? G.now > ln.endReal : G.raceT > ln.endSim;
      if (!expired) {
        const bw = Math.min(WW - 12 * u, 470 * u), bh = 32 * u;
        const bx = X0 + (WW - bw) / 2, by = Y0 + (VH - 36) * u;
        pbox(bx, by, bw, bh, Math.max(1, 1.2 * u), 'rgba(12,14,34,0.92)', '#ffd23f');
        const av = AVATARS[ln.who];
        sctx.imageSmoothingEnabled = false;
        const as = 24 * u;
        sctx.drawImage(av, bx + 4 * u, by + (bh - as) / 2, as, as);
        txt(HOSTS[ln.who], bx + 33 * u, by + 7 * u, Math.max(9, 5.5 * u), ln.who ? '#ff9eb8' : '#7ec8ff', { weight: 700 });
        const shown = ln.text.slice(0, Math.floor((G.now - ln.startReal) * 34));
        const fsz = Math.max(11, 7.4 * u);
        wrap(shown, bx + 33 * u, by + 17 * u, bw - 40 * u, fsz, fsz * 1.15, ln.full || ln.text);
      }
    }

    // big centre text
    if (G.big && G.now < G.big.until) {
      const k = clamp((G.now - G.big.at) * 6, 0, 1);
      const size = G.big.size * u * (0.6 + 0.4 * k);
      txt(G.big.text, X0 + WW / 2, Y0 + (G.big.y || 190) * u, size, G.big.color || '#ffffff', { weight: 700, title: true, align: 'center', stroke: '#10101a', strokeW: size * 0.35 });
    }

    if (G.mode === 'reveal') renderRevealHUD(t);
  }

  // Standings for display: refreshed a few times a second so places don't flicker.
  function stableOrder() {
    if (!G.stable || G.now - G.stableAt > 0.45 || G.stableT > G.raceT) {
      G.stable = standings(G.raceT);
      G.stableAt = G.now;
      G.stableT = G.raceT;
    }
    return G.stable;
  }

  // "TOP 5" strip in the top bar
  function drawTicker(x0, x1, y, size, u) {
    const P = G.plan;
    const top = stableOrder().slice(0, 5);
    const label = 'TOP 5';
    const lw = tw(label, size * 0.85, 700) + 8 * u;
    const each = (x1 - x0 - lw) / 5;
    const nameW = each - size * 1.1 - 9 * u;
    txt(label, x0, y, size * 0.85, '#ffd23f', { weight: 700 });
    top.forEach((i, k) => {
      const x = x0 + lw + k * each;
      const fin = P.crossT[i] <= G.raceT;
      txt(String(k + 1), x, y, size, ['#ffd23f', '#dfe6f0', '#e59a5c', '#b9c3e6', '#b9c3e6'][k], { weight: 700 });
      const sx = x + size * 0.85;
      sctx.fillStyle = '#0b0b18'; sctx.fillRect(sx - 0.5 * u, y - 3 * u, 6 * u, 6 * u);
      sctx.fillStyle = G.looks[i].color; sctx.fillRect(sx, y - 2.5 * u, 5 * u, 5 * u);
      txt(fit(G.cfg.names[i], size, nameW, 600), sx + 8 * u, y, size, fin ? '#7ee08a' : '#ffffff', { weight: 600 });
    });
  }
  function fmtClock(t) {
    if (t >= 60) { const m = Math.floor(t / 60); const s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
    return t.toFixed(1);
  }

  // Word-wrap using the final text's layout so lines don't jump while typing.
  function wrap(shown, x, y, maxW, size, lh, full) {
    sctx.font = F(size, 600);
    const words = full.split(' ');
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const test = cur ? cur + ' ' + wd : wd;
      if (sctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = test;
    }
    lines.push(cur);
    let left = shown.length;
    lines.slice(0, 2).forEach((l, k) => {
      const part = l.slice(0, Math.max(0, left));
      left -= l.length + 1;
      txt(part, x, y + k * lh, size, '#ffffff', { weight: 600 });
    });
  }

  function say(text, who, opts) {
    opts = opts || {};
    G.line = {
      text, full: text, who: who || 0, startReal: G.now,
      endReal: opts.sim ? null : G.now + (opts.dur || Math.max(2.4, 1.4 + text.length * 0.05)),
      endSim: opts.sim ? opts.endSim : null,
    };
  }
  function big(text, dur, size, color, y) {
    G.big = { text, at: G.now, until: G.now + dur, size: size || 26, color, y };
  }

  // ================================================================ podium ceremony
  const PODIUM = [
    { place: 3, x: 118, h: 26 }, { place: 1, x: 202, h: 48 }, { place: 0, x: 286, h: 64 }, { place: 2, x: 370, h: 36 }, { place: 4, x: 454, h: 16 },
  ];
  const PODCOL = ['#ffcf3a', '#cfd6e0', '#d98a4a', '#7fa7d9', '#7fa7d9'];
  const BASE_Y = 300;
  const REVEAL_AT = [11.2, 7.2, 5.4, 3.6, 1.8]; // seconds after start, by place

  function renderPodium(t) {
    const cam = sn(G.camX);
    drawSky(cam, t);
    drawStands(cam, t);
    drawTrack(cam);
    const R = G.reveal;
    // stage
    w.fillStyle = '#23324f'; w.fillRect(100, BASE_Y, 440, 10);
    w.fillStyle = '#1a2440'; w.fillRect(100, BASE_Y + 10, 440, 3);
    for (const b of PODIUM) {
      const top = BASE_Y - b.h;
      w.fillStyle = PODCOL[b.place]; w.fillRect(b.x, top, 72, b.h);
      w.fillStyle = Art.shade(PODCOL[b.place], 1.25); w.fillRect(b.x, top, 72, 3);
      w.fillStyle = Art.shade(PODCOL[b.place], 0.78); w.fillRect(b.x + 66, top + 3, 6, b.h - 3);
      w.fillStyle = '#10101a'; w.fillRect(b.x - 1, top, 1, b.h); w.fillRect(b.x + 72, top, 1, b.h); w.fillRect(b.x - 1, top - 1, 74, 1);
      const num = String(b.place + 1);
      const sc = b.h >= 30 ? 4 : 2;
      if (b.h > 12) Art.drawText(w, num, b.x + 33 - Art.textWidth(num, sc) / 2, top + Math.min(8, b.h / 2 - 5), '#10101a', sc);
      const i = G.plan.order[b.place];
      const at = REVEAL_AT[b.place];
      const k = R.t - at;
      if (k < 0) continue;
      // drop in with a bounce
      const fall = k < 0.45 ? -(1 - k / 0.45) * 180 : k < 0.65 ? -Math.sin(((k - 0.45) / 0.2) * Math.PI) * 8 : 0;
      const jumping = k > 0.8 && b.place < 3 ? -Math.abs(Math.sin(t * 5 + b.place)) * 6 : 0;
      const look = G.looks[i];
      const ph = Math.floor(((t * 6) % TAU) / TAU * 8);
      const spr = k > 0.7 ? Art.runnerSprite(look, 'cel:' + ph, () => Art.Pose.celebrate((ph / 8) * TAU)) : Art.runnerSprite(look, 'stand0', () => Art.Pose.stand(false));
      const S = Art.SPRITE;
      const gx = b.x + 36, gy = top + fall + jumping;
      w.fillStyle = 'rgba(0,0,0,0.3)'; w.fillRect(gx - 12, top - 2, 24, 3);
      w.drawImage(spr, 0, 0, S.W, S.H, sn(gx - S.OX * 2), sn(gy - S.OY * 2), S.W * 2, S.H * 2);
      // medal
      if (k > 0.45) {
        const mc = b.place < 3 ? PODCOL[b.place] : '#4d7fd9';
        w.fillStyle = '#e53935'; w.fillRect(gx - 1, gy - 38, 2, 7);
        w.fillStyle = mc; w.fillRect(gx - 3, gy - 32, 6, 6);
        w.fillStyle = '#10101a'; w.fillRect(gx - 3, gy - 26, 6, 1);
      }
    }
    drawParticles(cam);
  }

  function renderRevealHUD(t) {
    const u = view.s, X0 = view.ox, Y0 = view.oy, WW = VW * u;
    const R = G.reveal;
    txt('OFFICIAL RESULTS', X0 + WW / 2, Y0 + 20 * u, Math.max(14, 11 * u), '#ffd23f', { weight: 700, title: true, align: 'center', stroke: '#10101a', strokeW: 5 * u });
    txt(G.cfg.title, X0 + WW / 2, Y0 + 36 * u, Math.max(11, 7.5 * u), '#ffffff', { weight: 700, align: 'center', stroke: '#10101a', strokeW: 3 * u });
    for (const b of PODIUM) {
      const at = REVEAL_AT[b.place];
      const top = BASE_Y - b.h;
      const cx = SX(b.x + 36);
      if (R.t < at) {
        txt('?', cx, SY(top - 26), 16 * u, 'rgba(255,255,255,' + (0.5 + 0.3 * Math.sin(t * 4)).toFixed(2) + ')', { weight: 700, title: true, align: 'center', stroke: '#10101a', strokeW: 4 * u });
        continue;
      }
      const i = G.plan.order[b.place];
      const k = clamp((R.t - at - 0.35) * 4, 0, 1);
      if (k <= 0) continue;
      const name = G.cfg.names[i];
      const fs = Math.max(11, 7.2 * u);
      const lbl = fit(name, fs, 80 * u, 700);
      const wdt = tw(lbl, fs, 700) + 10 * u;
      const ly = SY(top - 72) - (1 - k) * 10 * u;
      sctx.globalAlpha = k;
      pbox(cx - wdt / 2, ly - fs * 0.75, wdt, fs * 1.5, Math.max(1, u), G.looks[i].color, '#10101a');
      txt(lbl, cx, ly, fs, lum(G.looks[i].color) > 0.62 ? '#10101a' : '#ffffff', { weight: 700, align: 'center' });
      txt(ordinal(b.place + 1) + ' · ' + fmtTime(G.plan.crossT[i]) + 's', cx, SY(BASE_Y + 8), Math.max(9, 5.8 * u), '#ffffff', { weight: 700, align: 'center', stroke: '#10101a', strokeW: 3 * u });
      sctx.globalAlpha = 1;
    }
    if (R.t > 12.4 && G.plan.N > 5) {
      const six = G.plan.order[5];
      const gap = G.plan.crossT[six] - G.plan.crossT[G.plan.order[4]];
      const s = 'So close! ' + G.cfg.names[six] + ' finished 6th, just ' + gap.toFixed(2) + 's behind';
      const fs = Math.max(11, 7 * u);
      const bw = tw(s, fs, 700) + 16 * u;
      pbox(X0 + WW / 2 - bw / 2, Y0 + 44 * u, bw, 13 * u, Math.max(1, u), 'rgba(12,14,34,0.9)', '#ff6b8a');
      txt(s, X0 + WW / 2, Y0 + 50.5 * u, fs, '#ffb3c1', { weight: 700, align: 'center' });
    }
  }

  function startReveal() {
    G.mode = 'reveal';
    G.reveal = { t: 0, fired: {} };
    G.camX = FINISH_X() + 200;
    G.particles = [];
    G.clockFrozen = null;
    G.zoom = 1;
    G.fade = 1;
    Sfx.musicHype(false);
    Sfx.musicMix(0.5);
    Sfx.drumroll(1.2);
    say('Ladies and gentlemen... the official results!', 0, { dur: 3 });
  }

  const REVEAL_LINES = [
    ['And in FIRST place...', 'THE CHAMPION: {n}!!!', 'What a race! {n} takes the gold!', '{n} WINS IT! Unbelievable!'],
    ['Silver goes to {n}! So close to gold!', 'Second place: {n}! Fantastic run!'],
    ['Bronze for {n}! On the podium!', 'Third place: {n}! What a finish!'],
    ['Fourth place: {n}! Solid!', '{n} grabs fourth! Great effort!'],
    ['In fifth place... {n}!', 'Fifth place goes to {n}! Just made it!'],
  ];

  function stepReveal(dt) {
    const R = G.reveal;
    R.t += dt;
    const once = (key, fn) => { if (!R.fired[key]) { R.fired[key] = true; fn(); } };
    const r = Planner.makeRng(G.plan.seed ^ 0xbeef);
    for (let place = 4; place >= 0; place--) {
      const at = REVEAL_AT[place];
      if (place === 0) {
        once('drum', () => { if (R.t > 8.8) { Sfx.drumroll(2.4); Sfx.musicMix(0.25); say('And the winner is...', 1, { dur: 2.4 }); } else R.fired.drum = false; });
      }
      if (R.t >= at) {
        once('p' + place, () => {
          const i = G.plan.order[place];
          const pool = REVEAL_LINES[place];
          const line = Planner.fill(pool[place === 0 ? 1 + (G.plan.seed % (pool.length - 1)) : r.int(0, pool.length - 1)], { n: G.cfg.names[i] });
          say(line, place % 2, { dur: 3 });
          Sfx.pop();
          if (place === 0) {
            Sfx.fanfare(); Sfx.cheer(1.5);
            setTimeout(() => { Sfx.musicMix(1); Sfx.musicHype(true); }, 1200);
            big('WINNER!', 2.4, 30, '#ffd23f', 150);
            confetti(160, 0, VW, 0);
          } else Sfx.cheer();
        });
      }
    }
    if (R.t > 11.4 && R.t < 18 && Math.random() < dt * 1.4) firework(60 + Math.random() * 520, 30 + Math.random() * 60);
    if (R.t > 11.4 && Math.random() < dt * 4) confetti(2, 0, VW, 0);
    once('buttons', () => { if (R.t > 12.8) showResultsBar(); else R.fired.buttons = false; });
  }

  // ================================================================ race flow
  function startMarks() {
    hideAll();
    $('hud-buttons').hidden = false;
    $('btn-exit').hidden = G.viewer;
    Sfx.init();
    G.mode = 'marks';
    G.raceT = 0;
    G.particles = [];
    G.gagPtr = 0; G.globPtr = 0; G.linePtr = 0; G.crossPtr = 0;
    G.clockFrozen = null;
    G.timeScale = 1; G.zoom = 1;
    G.camX = 0; G.revealQueued = false; G.fadeOut = null; G.reveal = null;
    G.hype = false; G.slowOn = false; G.stable = null;
    Sfx.musicStop();
    G.plan.gags.forEach((g) => { delete g._puffed; delete g._p; delete g._shoe; delete g._hit; delete g._park; delete g._dust; });
    G.sfxQ = []; G.camGag = null; G.focus = null; G.focusT = null;
    G.card = null; G.finaleCard = false; G.zoomT = 1; G.zv = 0; G.lb = 0; G.lbT = 0; G.camCenter = null;
    G.words = []; G.shake = 0; G.hitStop = 0;
    const r = Planner.makeRng(G.plan.seed ^ 0xfa15e);
    const fsI = r.chance(0.3) ? r.int(0, G.plan.N - 1) : -1;
    const setDelay = r.range(0.9, 1.7);
    const m = { t: 0, phase: 'idle', events: [], fs: null };
    const at = (time, fn) => m.events.push({ time, fn });
    at(0.1, () => { say('Welcome to ' + G.cfg.title + '! What a crowd today!', 0, { dur: 2.6 }); Sfx.cheer(0.6); });
    at(1.3, () => { m.phase = 'marks'; big('ON YOUR MARKS', 1.8, 20); Sfx.beep(); });
    let setAt = 3.4;
    at(setAt, () => { m.phase = 'set'; big('SET', 1.2, 28); Sfx.beep(); });
    if (fsI >= 0) {
      m.fs = { i: fsI, t0: setAt + 0.7, back: setAt + 3.0 };
      at(setAt + 0.9, () => { Sfx.whistle(); big('FALSE START!', 1.6, 18, '#ff6b6b'); say('Whoa, easy ' + G.cfg.names[fsI] + '! Wait for the bang!', 1, { dur: 2.4 }); });
      at(setAt + 2.1, () => { m.phase = 'marks'; });
      setAt += 3.4;
      at(setAt, () => { m.phase = 'set'; big('SET', 1.2, 28); Sfx.beep(); say('Let\'s try that again...', 0, { dur: 1.8 }); });
    }
    at(setAt + setDelay, () => {
      G.mode = 'race';
      G.raceT = 0;
      G.flash = 1;
      big('GO!', 0.9, 34, '#7ee08a');
      Sfx.bang();
      Sfx.cheer();
      Sfx.musicStart();
    });
    G.marks = m;
  }

  // queue a sound (or effect) for a moment of race time
  function sfxAt(t, fn) { G.sfxQ.push({ t, fn }); G.sfxQ.sort((a, b) => a.t - b.t); }
  // something lands: freeze a split second, shake the camera, pop a comic word
  function impact(i, t, word, big) {
    const x = runnerX(rstate(i, t).p), y = G.lanes.ground(i) - 30;
    G.words.push({ x, y, word, at: G.now, big: !!big });
    G.shake = Math.max(G.shake || 0, big ? 7 : 2.5);
    G.hitStop = big ? 0.25 : 0.1;
  }
  function scheduleBazooka(g) {
    const bd = Planner.BAZOOKA, B = G.plan.bazooka;
    const at = (u, fn) => sfxAt(g.t0 + u * g.dur, fn);
    Sfx.clack();
    at(bd.fire, () => { Sfx.launch(); G.flash = Math.max(G.flash, 0.25); });
    at(bd.impact, () => {
      Sfx.boom(); Sfx.cheer(1.2);
      G.flash = 0.9;
      impact(B.aim, g.t0 + bd.impact * g.dur, 'KA-BOOM!', true);
      const bp = blastPoint();
      for (let k = 0; k < 26; k++) G.particles.push({ x: bp.x + (Math.random() - 0.5) * 30, y: bp.y - Math.random() * 10, vx: (Math.random() - 0.5) * 30, vy: -12 - Math.random() * 20, g: -3, life: 0, max: 1.6 + Math.random() * 1.4, col: k % 3 ? '#8d8d8d' : '#5c5c5c', size: 3, world: true, spark: true });
      for (let k = 0; k < 22; k++) G.particles.push({ x: bp.x, y: bp.y, vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 90, g: 160, life: 0, max: 0.9, col: k % 2 ? '#c4553b' : '#e9e4dc', size: 2, world: true });
      for (let k = 0; k < 18; k++) G.particles.push({ x: bp.x, y: bp.y, vx: (Math.random() - 0.5) * 200, vy: -30 - Math.random() * 120, g: 90, life: 0, max: 0.6, col: k % 2 ? '#ffd23f' : '#ff7a2a', size: 1, world: true, spark: true });
    });
  }
  const HIT_WORD = { pie: 'SPLAT!', balloon: 'SPLOOSH!', tomato: 'SQUISH!', chicken: 'BONK!' };
  function fireGag(g) {
    if (g.role === 'b') return;
    if (g.type === 'bazooka' || (g.type === 'blast' && g.fan)) { scheduleBazooka(g); return; }
    if (g.type === 'blast') return;
    const at = (u, fn) => sfxAt(g.t0 + u * g.dur, fn);
    const hit = (u, who, word) => at(u, () => impact(who, g.t0 + u * g.dur, word));
    if (g.duo) {
      const imp = Planner.DUO[g.type].impact;
      if (g.type === 'throw') hit(imp, g.other, HIT_WORD[g.variant]);
      else if (g.type === 'shove') hit(imp, g.other, 'SHOVE!');
      else if (g.type === 'tripup') hit(0.3, g.other, 'WHAM!');
      else if (g.type === 'tackle') hit(imp, g.other, 'CRASH!');
      else if (g.type === 'fight') { hit(0.14, g.i, 'POW!'); hit(0.42, g.other, 'BIFF!'); hit(0.64, g.i, 'ZOK!'); }
      else if (g.type === 'highfive') hit(imp, g.i, 'SLAP!');
    } else if (g.type === 'trip') hit(0.12, g.i, 'THUD!');
    else if (g.type === 'banana') hit(0.3, g.i, 'WHOOPS!');
    else if (g.type === 'chickenhug') hit(0.2, g.i, 'HUG!');
    else if (g.type === 'sneeze') hit(0.3, g.i, 'ACHOO!');
    if (g.duo) {
      const imp = Planner.DUO[g.type].impact;
      if (g.type === 'throw') {
        at(0.18, () => Sfx.whoosh());
        at(imp, () => (g.variant === 'balloon' ? Sfx.splash() : g.variant === 'chicken' ? Sfx.squeak() : Sfx.splat()));
      } else if (g.type === 'shove' || g.type === 'tripup' || g.type === 'tackle') at(imp, () => Sfx.thud());
      else if (g.type === 'fight') {
        Sfx.pop();
        for (let u = 0.14; u < 0.8; u += 0.07 + ((u * 97) % 0.06)) at(u, () => Sfx.punch());
        at(0.72, () => Sfx.whistle());
      } else if (g.type === 'highfive') at(imp, () => Sfx.clap());
      return;
    }
    if (g.type === 'scooter') {
      Sfx.hum(g.dur * 0.55 / 0.5);
      at(0.62, () => (g.variant === 'battery' ? Sfx.sputter() : Sfx.whistle()));
      return;
    }
    if (g.type === 'pogo') { for (let u = 0; u < 1; u += 0.2) at(u, () => Sfx.boing()); return; }
    if (g.type === 'chickenhug') { at(0.15, () => Sfx.cluck()); at(0.5, () => Sfx.cluck()); return; }
    const map = {
      trip: 'thud', banana: 'slip', laces: 'pop', selfie: 'click', phone: 'ring', hotdog: 'gulp', cramp: 'boing', wrongway: 'boing',
      moonwalk: 'pop', pigeon: 'quack', rain: 'whoosh', autograph: 'pop', flex: 'boing', shoe: 'boing', ufo: 'zap', ufogood: 'zap',
      cartwheel: 'whoosh', wave: 'pop', celebrate: 'boing', bow: 'pop', energy: 'gulp', dog: 'bark', bees: 'buzz', sneeze: 'sneeze', secondwind: 'whoosh', rocket: 'whoosh',
    };
    const s = map[g.type];
    if (s && Sfx[s]) Sfx[s]();
  }

  function stepRace(dt) {
    const P = G.plan;
    // slow motion around the close finishes
    const T = G.raceT;
    const F = P.finale;
    // the finale: slow motion from the moment it goes wrong until the winner crosses
    const slowFrom = F ? F.tg - 0.15 : P.T1 - 0.9;
    const slow = (T > slowFrom && T < P.T1 + 0.12) || (T > P.T5 - 0.45 && T < P.T5 + 0.2);
    // gag cam: slow down and zoom in on whatever is happening
    const cg = camGag(T);
    if (cg !== G.camGag && cg) { Sfx.whoosh(); showCard(cg); }
    G.camGag = cg;
    const isBz = cg && (cg.type === 'bazooka' || cg.fan);
    const gu = cg ? (T - cg.t0) / cg.dur : 0;
    const gagSlow = cg && T > cg.t0 - 0.05 && T < cg.t0 + Math.min(cg.dur * 0.9, 3.0);
    const gagScale = isBz ? (gu > 0.08 && gu < 0.75 ? 0.22 : 0.5) : 0.38;
    G.timeScale = lerp(G.timeScale, slow ? 0.3 : gagSlow ? gagScale : 1, 1 - Math.exp(-dt * 6));
    if (slow !== G.slowOn) { G.slowOn = slow; Sfx.musicMix(slow ? 0.6 : 1, slow); }
    const finaleShot = F && T > F.tg - 0.5 && T < F.tg + 0.9;
    if (finaleShot && !G.finaleCard) { G.finaleCard = true; Sfx.whoosh(); showCard(null, F); }
    const finishZoom = T > (F ? F.tg + 0.9 : P.T1 - 1.7) && T < P.T5 + 0.7;
    const gagZoom = cg && T < cg.t0 + cg.dur;
    G.zoomT = finaleShot ? 1.42 : finishZoom ? 1.22 : gagZoom ? (isBz ? (gu > Planner.BAZOOKA.impact ? 1.5 : 1.25) : 1.32) : 1;
    G.lbT = finaleShot || finishZoom || gagZoom ? 1 : 0;
    G.camCenter = null;
    if (finaleShot) {
      G.focusT = gagFocus({ i: F.target, duo: F.kind !== 'solo', other: F.actor }, T);
      G.camCenter = G.focusT.x;
    } else if (finishZoom) G.focusT = { x: FINISH_X(), y: TRACK_TOP + G.lanes.trackH * 0.42 };
    else if (cg) { G.focusT = gagFocus(cg, T); G.camCenter = G.focusT.x; }
    if (G.card && !cg && !finaleShot && !G.card.out) G.card.out = G.now;
    // hit-stop: a split-second freeze when something lands
    let sdt = dt * G.timeScale;
    if (G.hitStop > 0) { G.hitStop -= dt; sdt *= 0.06; }
    G.raceT += sdt;
    const t = G.raceT;

    while (G.gagPtr < P.gags.length && P.gags[G.gagPtr].t0 <= t) {
      const g = P.gags[G.gagPtr++];
      if (g.t0 > 0 || g.type !== 'sleepy') fireGag(g);
    }
    while (G.globPtr < P.globals.length && P.globals[G.globPtr].t0 <= t) {
      const g = P.globals[G.globPtr++];
      if (g.type === 'confetti') { confetti(90, 0, VW, 40); Sfx.pop(); }
      if (g.type === 'ducks') { Sfx.quack(); setTimeout(() => Sfx.quack(), 300); }
      if (g.type === 'crowdwave' || g.type === 'mascot') Sfx.cheer(0.5);
    }
    while (G.sfxQ.length && G.sfxQ[0].t <= t) G.sfxQ.shift().fn();
    while (G.linePtr < P.lines.length && P.lines[G.linePtr].t <= t) {
      const ln = P.lines[G.linePtr++];
      say(ln.text, ln.who, { sim: true, endSim: ln.t + ln.dur });
    }
    while (G.crossPtr < P.order.length && P.crossT[P.order[G.crossPtr]] <= t) {
      const i = P.order[G.crossPtr++];
      if (G.crossPtr === 1) { G.clockFrozen = P.crossT[i]; Sfx.cheer(); G.flash = 0.45; }
      if (G.crossPtr <= 6) Sfx.click();
      if (G.crossPtr === 5) G.flash = Math.max(G.flash, 0.3);
      if (G.crossPtr === 5) setTimeout(() => big('PHOTO FINISH!', 2.2, 20, '#ffd23f', 150), 350);
    }
    // crowd excitement builds towards the finish
    let lead = 0;
    for (let i = 0; i < P.N; i++) lead = Math.max(lead, rstate(i, t).p);
    G.excite = clamp(0.25 + 0.75 * Math.pow(lead / P.D, 3), 0, 1);
    if (!G.hype && lead > P.D * 0.7) { G.hype = true; Sfx.musicHype(true); }
    if (t > P.T5 + 2.6 && !G.revealQueued) {
      G.revealQueued = true;
      G.fadeOut = { t: 0, then: startReveal };
    }
  }

  // ================================================================ main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.now += dt;
    const t = G.now;

    if (G.plan) {
      if (G.mode === 'marks') {
        const m = G.marks;
        m.t += dt;
        for (const e of m.events) if (!e.done && m.t >= e.time) { e.done = true; e.fn(); }
      }
      if (G.mode === 'race') stepRace(dt);
      if (G.mode === 'reveal') stepReveal(dt);
      stepParticles(G.mode === 'race' ? dt * G.timeScale : dt);
      updateCamera(dt);
      if (G.mode === 'reveal') G.excite = 1;
      else if (G.mode !== 'race') G.excite = 0.3;
    }

    // world
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = '#070914';
    sctx.fillRect(0, 0, screen.width, screen.height);
    let info = null;
    if (G.plan) {
      info = renderWorld(t);
      // camera moves on springs: the zoom punches in with a little overshoot, the aim glides
      if (G.mode === 'race') {
        const zt = G.zoomT || 1;
        G.zv = (G.zv || 0) + (70 * (zt - G.zoom) - 11 * (G.zv || 0)) * dt;
        G.zoom = Math.max(1, G.zoom + G.zv * dt);
        G.lb = lerp(G.lb || 0, G.lbT || 0, 1 - Math.exp(-dt * 7));
      } else { G.zoom = 1; G.zv = 0; G.lb = lerp(G.lb || 0, 0, 1 - Math.exp(-dt * 7)); }
      G.shake = (G.shake || 0) * Math.exp(-dt * 9);
      const z = Math.max(G.zoom, 1 + G.shake * 0.012);
      if (G.focusT) {
        if (!G.focus) G.focus = { x: G.focusT.x, y: G.focusT.y, vx: 0, vy: 0 };
        const f = G.focus;
        f.vx += (45 * (G.focusT.x - f.x) - 13.4 * f.vx) * dt;
        f.vy += (45 * (G.focusT.y - f.y) - 13.4 * f.vy) * dt;
        f.x += f.vx * dt; f.y += f.vy * dt;
      }
      if (z > 1.01 && G.mode === 'race') {
        const fcs = G.focus || { x: G.camX + VW / 2, y: VH / 2 };
        const sh = G.shake > 0.2 ? G.shake : 0;
        const cx = clamp(fcs.x - G.camX, 0, VW) + (Math.random() - 0.5) * 2 * sh, cy = fcs.y + (Math.random() - 0.5) * 2 * sh;
        const cw = VW / z, ch = VH / z;
        crop = { x: clamp(cx - cw * 0.5, 0, VW - cw), y: clamp(cy - ch * 0.55, 0, VH - ch), w: cw, h: ch };
      } else crop = { x: 0, y: 0, w: VW, h: VH };
      sctx.imageSmoothingEnabled = false;
      const d = view.dpr;
      sctx.drawImage(world, crop.x * K, crop.y * K, crop.w * K, crop.h * K, view.ox * d, view.oy * d, VW * view.s * d, VH * view.s * d);
      sctx.setTransform(d, 0, 0, d, 0, 0);
      renderHUD(info, t);
      // flashes and fades
      if (G.flash > 0) {
        sctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.7).toFixed(3) + ')';
        sctx.fillRect(view.ox, view.oy, VW * view.s, VH * view.s);
        G.flash = Math.max(0, G.flash - dt * 3);
      }
      if (G.fadeOut) {
        G.fadeOut.t += dt;
        const a = clamp(G.fadeOut.t / 0.5, 0, 1);
        sctx.fillStyle = 'rgba(7,9,20,' + a.toFixed(3) + ')';
        sctx.fillRect(0, 0, view.cw, view.ch);
        if (a >= 1) { const fn = G.fadeOut.then; G.fadeOut = null; fn(); }
      } else if (G.fade > 0) {
        sctx.fillStyle = 'rgba(7,9,20,' + G.fade.toFixed(3) + ')';
        sctx.fillRect(0, 0, view.cw, view.ch);
        G.fade = Math.max(0, G.fade - dt * 2);
      }
    }
    requestAnimationFrame(frame);
  }

  // ================================================================ share links
  const KEY = 0x7a3c19e5;
  function scramble(bytes) {
    const r = Planner.makeRng(KEY);
    return bytes.map((b) => b ^ Math.floor(r.next() * 256));
  }
  function encodeCfg(cfg) {
    const obj = { v: 1, t: cfg.title, n: cfg.names, w: cfg.winners, l: cfg.length, c: cfg.chaos, b: cfg.bazooka, s: cfg.seed };
    const bytes = scramble(new TextEncoder().encode(JSON.stringify(obj)));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeCfg(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(scramble(bytes)));
    const cfg = { title: String(o.t || 'Pixel Dash').slice(0, 40), names: o.n, winners: o.w, length: o.l, chaos: o.c, bazooka: o.b, seed: o.s >>> 0 };
    if (!Array.isArray(cfg.names) || cfg.names.length < 5 || cfg.names.length > 20) throw new Error('bad names');
    cfg.names = cfg.names.map((s) => String(s).slice(0, 20));
    if (!Planner.LENGTHS[cfg.length]) cfg.length = 'classic';
    if (!['calm', 'normal', 'chaos'].includes(cfg.chaos)) cfg.chaos = 'normal';
    if (!['off', 'half', 'always'].includes(cfg.bazooka)) cfg.bazooka = 'half';
    return cfg;
  }

  // ================================================================ DOM: screens
  function hideAll() {
    ['setup', 'intro', 'results-bar', 'table-modal'].forEach((id) => { $(id).hidden = true; });
  }

  function showIntro() {
    hideAll();
    G.mode = 'intro';
    G.revealQueued = false;
    G.line = null; G.big = null;
    $('hud-buttons').hidden = false;
    $('btn-exit').hidden = true;
    const P = G.plan;
    $('i-title').textContent = G.cfg.title;
    $('i-sub').textContent = Planner.LENGTHS[G.cfg.length].label + ' · ' + P.N + ' RUNNERS';
    const list = $('i-list');
    list.textContent = '';
    G.cfg.names.forEach((name, i) => {
      const li = document.createElement('div');
      li.className = 'runner-card';
      const sw = document.createElement('span');
      sw.className = 'lane';
      sw.style.background = G.looks[i].color;
      sw.style.color = lum(G.looks[i].color) > 0.62 ? '#10101a' : '#fff';
      sw.textContent = String(i + 1);
      const nm = document.createElement('div');
      nm.className = 'rname';
      nm.textContent = name;
      const bio = document.createElement('div');
      bio.className = 'bio';
      bio.textContent = P.bios[i];
      const col = document.createElement('div');
      col.append(nm, bio);
      li.append(sw, col);
      list.appendChild(li);
    });
    $('btn-back').hidden = G.viewer;
    $('intro').hidden = false;
    $('btn-start').focus();
  }

  function showResultsBar() {
    G.line = null;
    $('results-bar').hidden = false;
    document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = G.viewer; });
  }

  function showTable() {
    const P = G.plan;
    const list = $('table-list');
    list.textContent = '';
    const t1 = P.crossT[P.order[0]];
    P.order.forEach((i, k) => {
      const li = document.createElement('li');
      if (k < 5) li.className = 'top';
      const pl = document.createElement('span'); pl.className = 'pl'; pl.textContent = ordinal(k + 1);
      const sw = document.createElement('span'); sw.className = 'chip'; sw.style.background = G.looks[i].color;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = G.cfg.names[i];
      const tm = document.createElement('span'); tm.className = 'tm';
      tm.textContent = fmtTime(P.crossT[i]) + 's' + (k ? '  +' + (P.crossT[i] - t1).toFixed(2) : '');
      li.append(pl, sw, nm, tm);
      list.appendChild(li);
    });
    $('table-modal').hidden = false;
  }

  // ---------------------------------------------------------------- host panel
  const EXAMPLE = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Charlie', 'Robin'];
  const setup = {
    length: 'classic', chaos: 'normal', bazooka: 'half',
  };
  function readNames() {
    return $('f-names').value.split('\n').map((s) => s.trim().slice(0, 20)).filter(Boolean);
  }
  function refreshWinnerSelects(keepByName) {
    const names = readNames();
    $('f-count').textContent = names.length + ' runner' + (names.length === 1 ? '' : 's') + (names.length < 5 ? ' (need at least 5)' : names.length > 20 ? ' (max 20)' : '');
    $('f-count').classList.toggle('bad', names.length < 5 || names.length > 20);
    const sels = [...document.querySelectorAll('.winners select')];
    const prev = keepByName || sels.map((s) => (s.selectedIndex > 0 ? s.options[s.selectedIndex].text : ''));
    sels.forEach((s, k) => {
      s.textContent = '';
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— pick —'; s.appendChild(o0);
      names.forEach((n, i) => {
        const o = document.createElement('option'); o.value = String(i); o.textContent = n; s.appendChild(o);
      });
      const idx = names.indexOf(prev[k]);
      s.value = idx >= 0 ? String(idx) : '';
    });
    syncDisabled();
  }
  function syncDisabled() {
    const sels = [...document.querySelectorAll('.winners select')];
    const chosen = sels.map((s) => s.value);
    sels.forEach((s, k) => {
      [...s.options].forEach((o) => { o.disabled = o.value !== '' && chosen.some((c, j) => j !== k && c === o.value); });
    });
  }
  function readSetup() {
    const names = readNames();
    const err = (m) => { $('f-error').textContent = m; return null; };
    $('f-error').textContent = '';
    if (names.length < 5) return err('Add at least 5 runners (one name per line).');
    if (names.length > 20) return err('Maximum 20 runners.');
    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== names.length) return err('Two runners have the same name — make them unique (e.g. "Sam B").');
    const winners = [...document.querySelectorAll('.winners select')].map((s) => (s.value === '' ? -1 : Number(s.value)));
    if (winners.some((x) => x < 0)) return err('Pick all 5 winners (1st to 5th).');
    if (new Set(winners).size !== 5) return err('Each winner must be a different runner.');
    const title = ($('f-title').value.trim() || 'The Grand Pixel Dash').slice(0, 40);
    const cfg = { title, names, winners, length: setup.length, chaos: setup.chaos, bazooka: setup.bazooka, seed: (Math.random() * 4294967296) >>> 0 };
    try {
      localStorage.setItem('pd-setup', JSON.stringify({ title, names, winners: winners.map((i) => names[i]), length: cfg.length, chaos: cfg.chaos, bazooka: cfg.bazooka }));
    } catch (e) { /* storage blocked */ }
    return cfg;
  }
  function initSetup() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('pd-setup') || 'null'); } catch (e) { saved = null; }
    $('f-title').value = (saved && saved.title) || 'The Grand Pixel Dash';
    $('f-names').value = ((saved && saved.names) || EXAMPLE).join('\n');
    if (saved && saved.length) setup.length = saved.length;
    if (saved && saved.chaos) setup.chaos = saved.chaos;
    if (saved && saved.bazooka) setup.bazooka = saved.bazooka;
    refreshWinnerSelects(saved && saved.winners ? saved.winners : ['', '', '', '', '']);
    const seg = (id, key) => {
      const btns = [...$(id).querySelectorAll('button')];
      const upd = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === setup[key]));
      btns.forEach((b) => b.addEventListener('click', () => { setup[key] = b.dataset.v; upd(); }));
      upd();
    };
    seg('f-length', 'length');
    seg('f-chaos', 'chaos');
    seg('f-bazooka', 'bazooka');
    $('f-names').addEventListener('input', () => refreshWinnerSelects());
    document.querySelectorAll('.winners select').forEach((s) => s.addEventListener('change', syncDisabled));
    $('f-example').addEventListener('click', () => { $('f-names').value = EXAMPLE.join('\n'); refreshWinnerSelects(); });
    $('f-random').addEventListener('click', () => {
      const names = readNames();
      if (names.length < 5) { $('f-error').textContent = 'Add at least 5 runners first.'; return; }
      const idx = [...names.keys()].sort(() => Math.random() - 0.5).slice(0, 5);
      document.querySelectorAll('.winners select').forEach((s, k) => { s.value = String(idx[k]); });
      syncDisabled();
    });
    $('btn-play').addEventListener('click', () => {
      const cfg = readSetup();
      if (!cfg) return;
      Sfx.init();
      loadRace(cfg);
      showIntro();
    });
    $('btn-share').addEventListener('click', () => {
      const cfg = readSetup();
      if (!cfg) return;
      // PD_SHARE_BASE lets a copy hosted inside another page point links at its public address
      const base = window.PD_SHARE_BASE || location.origin + location.pathname;
      const url = base + '#race-' + encodeCfg(cfg);
      G.shareCfg = cfg;
      $('share-url').value = url;
      $('share-open').href = url;
      $('share-box').hidden = false;
      $('share-url').select();
    });
    $('btn-copy').addEventListener('click', async () => {
      const v = $('share-url').value;
      try { await navigator.clipboard.writeText(v); } catch (e) { $('share-url').select(); document.execCommand('copy'); }
      $('btn-copy').textContent = 'Copied!';
      setTimeout(() => { $('btn-copy').textContent = 'Copy'; }, 1500);
    });
    $('btn-preview').addEventListener('click', () => {
      if (!G.shareCfg) return;
      Sfx.init();
      loadRace(G.shareCfg);
      showIntro();
    });
  }

  function toSetup() {
    hideAll();
    G.mode = 'setup';
    G.line = null; G.big = null; G.fadeOut = null;
    Sfx.musicStop();
    $('hud-buttons').hidden = true;
    $('setup').hidden = false;
    if (!G.plan) {
      // background scene for the host panel
      loadRace({ title: 'Pixel Dash', names: EXAMPLE, winners: [0, 1, 2, 3, 4], length: 'classic', chaos: 'normal', seed: 7 });
    }
  }

  function updateSoundButtons() {
    const on = !Sfx.muted;
    $('btn-sound').textContent = on ? '🔊' : '🔇';
    $('btn-sound-i').textContent = on ? '🔊 Sound on' : '🔇 Sound off';
  }

  // ---------------------------------------------------------------- wiring
  function init() {
    initSetup();
    $('btn-start').addEventListener('click', () => { Sfx.init(); startMarks(); });
    $('btn-back').addEventListener('click', toSetup);
    $('btn-exit').addEventListener('click', toSetup);
    $('btn-replay').addEventListener('click', () => { hideAll(); startMarks(); });
    $('btn-table').addEventListener('click', showTable);
    $('btn-close-table').addEventListener('click', () => { $('table-modal').hidden = true; });
    $('btn-new').addEventListener('click', () => {
      const cfg = Object.assign({}, G.cfg, { seed: (Math.random() * 4294967296) >>> 0 });
      loadRace(cfg);
      showIntro();
    });
    $('btn-edit').addEventListener('click', toSetup);
    const toggle = () => { Sfx.init(); Sfx.setMuted(!Sfx.muted); updateSoundButtons(); };
    $('btn-sound').addEventListener('click', toggle);
    $('btn-sound-i').addEventListener('click', toggle);
    updateSoundButtons();
    document.addEventListener('keydown', (e) => {
      if (G.mode === 'intro' && (e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body) { e.preventDefault(); Sfx.init(); startMarks(); }
    });
    window.addEventListener('hashchange', () => location.reload());

    const m = location.hash.match(/^#race[=-]([A-Za-z0-9_-]+)$/);
    if (m) {
      try {
        const cfg = decodeCfg(m[1]);
        G.viewer = true;
        loadRace(cfg);
        showIntro();
      } catch (e) {
        toSetup();
        $('f-error').textContent = 'That race link looks broken. Ask the host for a new one.';
      }
    } else {
      toSetup();
    }
    requestAnimationFrame(frame);
  }

  // expose a little for testing
  window.PixelDash = { G, encodeCfg, decodeCfg, loadRace, startMarks, showIntro };

  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).then(init);
})();
