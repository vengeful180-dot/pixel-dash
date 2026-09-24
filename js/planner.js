/* Pixel Dash — race director.
 *
 * Plans a whole race up front, deterministically from a seed: where every
 * runner is on every tick, which gags happen to whom, and what the
 * commentators say. The five chosen winners always cross the line in the
 * chosen order, while the race itself is built to look wide open until the
 * last few seconds.
 *
 * How the guarantee works:
 *   - Every runner follows a planned "offset" from an invisible reference
 *     runner (storylines: fake favourites, comebacks, late surges...).
 *   - Gags (bananas, dogs, UFOs...) override a runner's speed for a moment;
 *     a controller then pulls the runner back towards its storyline.
 *   - In the final few seconds each winner runs at exactly the speed that
 *     lands them on the line at their planned finish time, and nobody else
 *     is allowed to cross before the 5th winner.
 *
 * Works in the browser (window.Planner) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const DT = 1 / 60;
  const ACC = 6.5;      // m/s², how hard runners accelerate
  const REACT = 0.15;   // reference runner's reaction time
  const EPS = 0.02;     // no loser crosses earlier than 5th place + EPS

  const LENGTHS = {
    sprint:  { meters: 200, vref: 8.4, spread: 0.7, label: '200 M' },
    classic: { meters: 400, vref: 8.8, spread: 1.0, label: '400 M' },
    epic:    { meters: 800, vref: 8.3, spread: 1.45, label: '800 M' },
  };
  const CHAOS_GAP = { calm: 7.5, normal: 4.2, chaos: 2.6 };

  // ---------------------------------------------------------------- RNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed >>> 0);
    const rng = {
      next: r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
      shuffle: (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
      },
      weighted: (items, weightFn) => {
        let total = 0;
        for (const it of items) total += Math.max(0, weightFn(it));
        if (total <= 0) return items[Math.floor(r() * items.length)];
        let x = r() * total;
        for (const it of items) {
          x -= Math.max(0, weightFn(it));
          if (x <= 0) return it;
        }
        return items[items.length - 1];
      },
    };
    return rng;
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- gags
  // speed: multiple of the reference pace as a function of u (0..1 through the gag).
  // kind: bad = costs time, good = boost, late = only for fading favourites.
  const GAGS = {
    trip:       { kind: 'bad',  dur: 1.5, speed: (u) => (u < 0.1 ? 0.6 : u < 0.72 ? 0 : 0.35) },
    banana:     { kind: 'bad',  dur: 1.4, speed: (u) => (u < 0.3 ? 0.35 : u < 0.78 ? 0 : 0.3) },
    laces:      { kind: 'bad',  dur: 1.7, speed: (u) => (u < 0.1 ? 0.3 : u < 0.9 ? 0 : 0.4) },
    selfie:     { kind: 'bad',  dur: 1.5, speed: (u) => (u < 0.12 ? 0.3 : 0) },
    phone:      { kind: 'bad',  dur: 2.4, speed: () => 0.38 },
    hotdog:     { kind: 'bad',  dur: 1.8, speed: (u) => (u < 0.1 ? 0.3 : u < 0.9 ? 0 : 0.4) },
    cramp:      { kind: 'bad',  dur: 2.0, speed: () => 0.38 },
    wrongway:   { kind: 'bad',  dur: 1.7, speed: (u) => (u < 0.62 ? -0.55 : u < 0.8 ? 0 : 0.4) },
    moonwalk:   { kind: 'bad',  dur: 1.7, speed: () => -0.28 },
    pigeon:     { kind: 'bad',  dur: 2.2, speed: () => 0.6 },
    rain:       { kind: 'bad',  dur: 3.0, speed: () => 0.66 },
    autograph:  { kind: 'bad',  dur: 1.4, speed: (u) => (u < 0.12 ? 0.3 : 0) },
    flex:       { kind: 'bad',  dur: 1.4, speed: (u) => (u < 0.12 ? 0.3 : 0.05) },
    tired:      { kind: 'bad',  dur: 2.4, speed: () => 0.55 },
    shoe:       { kind: 'bad',  dur: 1.8, speed: (u) => (u < 0.42 ? -0.4 : u < 0.78 ? 0 : 0.45) },
    ufo:        { kind: 'bad',  dur: 2.6, speed: (u) => (u < 0.25 ? 0.2 : u < 0.85 ? -0.45 : 0) },
    cartwheel:  { kind: 'bad',  dur: 1.8, speed: () => 0.6 },
    wave:       { kind: 'bad',  dur: 1.1, speed: () => 0.7 },
    celebrate:  { kind: 'late', dur: 2.2, speed: () => 0.45 },
    sleepy:     { kind: 'start', dur: 1.0, speed: () => 0 },
    energy:     { kind: 'good', dur: 2.6, speed: (u) => (u < 0.2 ? 0.75 : 1.55) },
    dog:        { kind: 'good', dur: 2.6, speed: () => 1.5 },
    bees:       { kind: 'good', dur: 2.2, speed: () => 1.45 },
    sneeze:     { kind: 'good', dur: 0.9, speed: (u) => (u < 0.3 ? 0.5 : 2.1) },
    secondwind: { kind: 'good', dur: 2.5, speed: () => 1.35 },
    rocket:     { kind: 'good', dur: 1.6, speed: () => 1.8 },
    ufogood:    { kind: 'good', dur: 2.6, speed: (u) => (u < 0.25 ? 0.2 : u < 0.85 ? 1.9 : 0) },
  };
  const BAD = Object.keys(GAGS).filter((k) => GAGS[k].kind === 'bad');
  const GOOD = Object.keys(GAGS).filter((k) => GAGS[k].kind === 'good');
  const EARLY_DISASTER = ['trip', 'wrongway', 'laces', 'shoe', 'banana', 'moonwalk', 'selfie', 'ufo', 'cramp', 'hotdog'];
  const LATE_FADE = ['celebrate', 'celebrate', 'celebrate', 'trip', 'banana', 'cramp', 'phone', 'tired', 'wave', 'flex', 'pigeon'];
  const GLOBALS = {
    crowdwave: 6, ducks: 8, mascot: 6, blimp: 12, confetti: 3,
  };

  // ---------------------------------------------------------------- text
  const TXT = {
    start: ["AND THEY'RE OFF!", 'BANG! Here we go!', "They're away! Hold on to your snacks!"],
    lead: [
      '{n} takes the lead!', '{n} moves to the front!', "And now it's {n} in front!",
      '{n} is leading! Nobody saw that coming. Including {n}.', '{n} hits the front! The crowd goes wild!',
      'Here comes {n} to the lead!', '{n} grabs first place!', '{n} is in front... for now!',
      'New leader: {n}! Somebody update the betting slips!', '{n} goes to the top! What a move!',
      '{n} leads! Can they hold it?', 'Look at {n}! Straight to the front!',
    ],
    half: ['Halfway there! This is anybody\'s race!', 'Halfway! And I still have no idea who wins this!', 'We\'re at the halfway mark! Chaos everywhere!'],
    m100: ['100 meters to go! Everything can still happen!', '100 to go! Hearts are pounding!', 'Final 100! Nobody is safe!'],
    m50: ['50 meters! It\'s ANYONE\'S race!', 'Final stretch! Hold on to your seats!', '50 to go! I can\'t look! ...I\'m looking!'],
    finish: ['WHAT A FINISH!!!', "IT'S A PHOTO FINISH!", 'TOO CLOSE TO CALL!', 'OH MY GOODNESS, WHAT A FINISH!'],
    gag: {
      trip: ["{n} goes DOWN! That's gonna leave a mark.", '{n} tripped over... absolutely nothing. Impressive.', 'Gravity 1, {n} 0!', '{n} is inspecting the track up close.'],
      banana: ['A BANANA PEEL?! {n} goes flying!', 'Who is throwing fruit?! {n} hits the deck!', '{n} just discovered the banana. The banana won.'],
      laces: ['{n} stops to tie a shoelace. In the middle of a race.', 'Double knot, {n}! Always double knot!', '{n} is tying shoes. Very safe. Very slow.'],
      selfie: ['Is {n}... taking a selfie?!', '{n} stops for a selfie. Followers come first!', '{n}: great selfie, terrible strategy.'],
      phone: ['{n} is answering a PHONE CALL mid-race!', "Someone tell {n}'s mom this is a bad time!", '{n} is on the phone. Hopefully it\'s a sponsor.'],
      hotdog: ['{n} has stopped for a hot dog!', 'Priorities! {n} grabs a hot dog.', '{n} is carb-loading. Right now. During the race.'],
      cramp: ['Cramp! {n} is hopping on one leg!', '{n} forgot to stretch. Big mistake.', "{n}'s calf has filed a formal complaint."],
      wrongway: ['{n} is running THE WRONG WAY!', 'Uh... {n}? The finish is the OTHER way!', '{n} turned around! Is that a strategy?!'],
      moonwalk: ['{n} is MOONWALKING! Backwards! Smoothly!', 'The crowd loves it, the coach does not: {n} is moonwalking.'],
      pigeon: ['A pigeon is attacking {n}!', '{n} has a new friend. A very angry pigeon.', 'Nature strikes! {n} is under bird attack!'],
      rain: ['A tiny rain cloud is following {n}. Only {n}.', 'Weather report: sunny, except directly above {n}.', '{n} is having a personal thunderstorm.'],
      autograph: ['{n} stops to sign an autograph! What a pro!', '{n} is signing autographs. Mid-race. Legend.'],
      flex: ['{n} stops to FLEX for the crowd!', '{n} is showing off the biceps. The crowd goes wild!', '{n}: all show, no go!'],
      tired: ['{n} looks exhausted already!', '{n} is running on fumes!', '{n} is breathing like an old vacuum cleaner.'],
      shoe: ['{n} lost a shoe! Going back for it!', 'A shoe goes flying! {n} has to go get it!', "That shoe is gone, {n}! Let it go!"],
      ufo: ["Is that... a UFO?! It's taking {n}!", 'ALIENS have abducted {n}! Is that even legal?!', 'The judges are checking the rulebook for alien abductions.'],
      cartwheel: ['{n} is doing CARTWHEELS!', '{n} goes for style points. There are no style points!'],
      wave: ['{n} waves to the crowd! Focus, {n}!', '{n} just spotted their mom in the stands.'],
      celebrate: ["{n} is celebrating ALREADY?! It's not over!", 'TOO EARLY, {n}! WAY TOO EARLY!', '{n} throws the arms up... before the finish line!'],
      sleepy: ['{n} is still ASLEEP in the blocks!', 'Somebody wake up {n}!', '{n} missed the gun! Too busy dreaming!'],
      energy: ['A fan throws {n} an energy drink! Here comes the boost!', '{n} chugs a mystery drink and TAKES OFF!', 'Whatever {n} just drank, I want some.'],
      dog: ['A DOG is chasing {n}! Look at that speed!', '{n} has never run this fast. The dog is a great coach.', "Security! There's a dog on the... actually, keep it. Look at {n} go!"],
      bees: ['BEES! {n} is being chased by bees!', '{n} disturbed a beehive and is now VERY motivated.'],
      sneeze: ['{n} sneezes and rockets forward!', 'Bless you, {n}! And... whoa, that was fast!'],
      secondwind: ['{n} finds a second wind!', '{n} has entered BEAST MODE!', 'Here comes {n}! Never count them out!'],
      rocket: ['Are those ROCKET SHOES, {n}?!', '{n} is FLYING! The judges are very confused!'],
      ufogood: ['A UFO grabs {n}... and drops them further AHEAD!', 'The aliens are cheating for {n}! Is that allowed?!'],
    },
    global: {
      crowdwave: ['The crowd is doing the wave!', 'A Mexican wave goes around the stadium!'],
      ducks: ['A family of ducks is crossing the infield. Adorable.', 'Ducks on the field! Nobody panic!'],
      mascot: ['The mascot is running too! Is the mascot even entered?!', 'The mascot is faster than half the field!'],
      blimp: ['The blimp is here! Hi, blimp!', 'Look up! The blimp! Somebody please watch the race!'],
      confetti: ['Confetti?! Gary, the race isn\'t over yet!', 'Somebody fired the confetti cannon early. Classic Gary.'],
    },
    // Two-line bits. {leader} {last} {mid} {rand} {lane} are filled from the live standings.
    fillers: [
      ['My doctor told me to start running.', "So you're... commentating?", 'Close enough!'],
      ['{leader} had three coffees this morning.', 'Four. I was there.'],
      ["What's {last}'s strategy?", 'Lull everyone into a false sense of security.'],
      ['Anyone could win this.', 'Even me?', "Let's not go crazy."],
      ['The judges look confused.', 'They always look like that.'],
      ['{rand} trained for this by chasing the ice cream truck.', 'Every. Single. Day.'],
      ['The prize this year is incredible.', 'Is it a sandwich?', "...It's not a sandwich."],
      ['{rand} is so fast they once beat their own shadow.', 'The shadow wants a rematch.'],
      ['This crowd is LOUD!', "That's my stomach. Sorry."],
      ['{mid} looks very focused.', 'Or asleep. Hard to tell.'],
      ['Remember folks, it\'s not about winning.', "It's absolutely about winning."],
      ['Positions are changing every second!', 'Just like my fantasy league.'],
      ['Who\'s your pick?', "Honestly? Nobody knows. That's the beauty of it."],
      ['Nobody is safe in this race!', 'Especially not from bananas.'],
      ["{rand}'s shoes cost more than my car.", "You don't have a car.", 'Exactly.'],
      ['This is the most exciting thing I\'ve seen all week.', 'You watched paint dry on Tuesday.', 'And THIS is better!'],
      ['{leader} is in front, but can they hold on?', "I wouldn't bet my lunch on it."],
      ['Statistically, anyone can win.', 'Statistically, I\'m hungry.'],
      ['Lane {lane} looks fast today.', 'All the lanes are the same length.', "Lane {lane} doesn't know that."],
      ['{last} is last, but leading the style rankings.', 'Style is temporary. Last place is forever.'],
      ['Did {rand} just wink at the camera?', "They do that. Every race. It's a whole thing."],
      ['I see {mid} saving energy for the finish.', "Or they just forgot they're in a race."],
      ['Fun fact: this track was painted yesterday.', "That explains why {last} is stuck."],
      ['I love this sport.', 'You fell asleep at the last one.', 'I love it QUIETLY.'],
      ['What a day for a race!', 'The weather is perfect. Except for the bananas.'],
    ],
    bios: [
      'Trained by chasing the bus every morning.', 'Once outran a sneeze.', 'Claims to be "mostly aerodynamic".',
      'Fast. Sometimes in the right direction.', "Has lucky socks. Hasn't washed them.", 'Undefeated against their own cat.',
      'Owns 14 pairs of running shoes. Uses one.', 'Warm-up routine: a nap.', 'Training diet: pizza and hope.',
      'Fastest in the office when free lunch arrives.', 'Watched every running movie. Twice.', 'Once ran a marathon. By accident.',
      'Believes in the power of snacks.', 'Only here for the medal photo.', 'Ran from a goose in 2019. Never stopped.',
      'Stretched for 3 hours. Ran for 4 minutes.', 'Personal coach: a random online video.', 'Sponsored by Mom.',
      'Says the secret is "legs".', 'Came for the race, stayed for the snacks.', 'Never skips leg day. Skips all other days.',
      'Talks to the finish line. It listens.', 'Has a signature victory dance. Needs a victory.', 'Powered by bananas (eats them, avoids the peels).',
      'Thinks cardio is a type of card game.', 'Was told to "run for it" once and took it seriously.', 'Holds the record for most false starts in a dream.',
      'Promised their grandma a medal.', 'Their shoes are faster than they are.', 'Motivated mainly by spite.',
    ],
  };

  function fill(s, vars) {
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  }

  // ---------------------------------------------------------------- reference runner
  function makeReference(D, vref) {
    const tAcc = vref / ACC;
    const pAcc = 0.5 * ACC * tAcc * tAcc;
    const p = (t) => {
      const u = t - REACT;
      if (u <= 0) return 0;
      if (u < tAcc) return 0.5 * ACC * u * u;
      return pAcc + vref * (u - tAcc);
    };
    const v = (t) => {
      const u = t - REACT;
      if (u <= 0) return 0;
      if (u < tAcc) return ACC * u;
      return vref;
    };
    const T1 = REACT + tAcc + (D - pAcc) / vref;
    return { p, v, T1, vref };
  }

  // Hermite spline through keyframes {t, o, m?}
  function makeSpline(keys) {
    const n = keys.length;
    const m = new Array(n);
    for (let k = 0; k < n; k++) {
      if (keys[k].m != null) m[k] = keys[k].m;
      else if (k === 0 || k === n - 1) m[k] = 0;
      else m[k] = (keys[k + 1].o - keys[k - 1].o) / (keys[k + 1].t - keys[k - 1].t);
    }
    return function (t) {
      if (t <= keys[0].t) return [keys[0].o, 0];
      if (t >= keys[n - 1].t) {
        return [keys[n - 1].o + m[n - 1] * (t - keys[n - 1].t), m[n - 1]];
      }
      let k = 0;
      while (k < n - 2 && t > keys[k + 1].t) k++;
      const a = keys[k], b = keys[k + 1];
      const h = b.t - a.t;
      const s = (t - a.t) / h;
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const o = h00 * a.o + h10 * h * m[k] + h01 * b.o + h11 * h * m[k + 1];
      const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
      const dv = (d00 * a.o + d01 * b.o) / h + d10 * m[k] + d11 * m[k + 1];
      return [o, dv];
    };
  }

  // ---------------------------------------------------------------- one attempt
  function attemptPlan(cfg, seed, safe) {
    const rng = makeRng(seed);
    const N = cfg.names.length;
    const spec = LENGTHS[cfg.length] || LENGTHS.classic;
    const D = spec.meters;
    const vref = spec.vref * rng.range(0.97, 1.03);
    const ref = makeReference(D, vref);
    const T1 = ref.T1;
    const W = cfg.winners.slice(0, 5);
    const isW = new Uint8Array(N);
    W.forEach((w) => { isW[w] = 1; });

    // ---- finish plan
    const scenario = safe ? 'photo' : rng.pick(['charge', 'charge', 'hold', 'photo', 'photo', 'chaos']);
    const finishT = new Float64Array(N);
    let tf = T1;
    for (let j = 0; j < 5; j++) {
      if (j > 0) {
        let g;
        if (scenario === 'photo') g = rng.range(0.02, 0.14);
        else if (scenario === 'hold' && j === 1) g = rng.range(0.3, 0.8);
        else if (scenario === 'chaos') g = rng.range(0.03, 0.5);
        else g = rng.range(0.05, 0.35);
        tf += g;
      }
      finishT[W[j]] = tf;
    }
    const T5 = tf;

    // ---- storyline roles
    const role = new Array(N).fill(null);
    if (scenario === 'hold') role[W[0]] = 'front';
    const freeW = rng.shuffle(W).filter((w) => !role[w]);
    if (!safe && rng.chance(0.8)) role[freeW.shift()] = 'comeback';
    if (!safe && scenario !== 'hold' && rng.chance(0.3)) role[freeW.shift()] = 'front';
    for (const w of freeW) role[w] = rng.pick(['steady', 'surge', 'chaos', 'surge', 'steady']);

    const losers = rng.shuffle([...Array(N).keys()].filter((i) => !isW[i]));
    const heartbreak = losers.length ? losers[0] : -1;
    if (heartbreak >= 0) role[heartbreak] = rng.pick(['front', 'steady', 'surge', 'fake']);
    if (losers.length >= 2) role[losers[1]] = 'fake';
    if (losers.length >= 3) role[losers[2]] = rng.chance(0.7) ? 'bolter' : 'fake';
    if (losers.length >= 6 && rng.chance(0.5)) role[losers[3]] = 'fake';
    let hopeless = 0;
    const maxHopeless = Math.max(1, Math.floor(N / 8));
    for (const l of losers) {
      if (role[l]) continue;
      let r = rng.pick(['steady', 'chaos', 'surge', 'hopeless', 'bolter', 'steady']);
      if (r === 'hopeless' && hopeless++ >= maxHopeless) r = 'steady';
      role[l] = r;
    }
    if (safe) for (let i = 0; i < N; i++) role[i] = 'steady';

    // ---- loser finish targets: heartbreak just misses, faders next, then the rest
    if (heartbreak >= 0) {
      let lt = T5 + rng.range(0.025, 0.09);
      finishT[heartbreak] = lt;
      const rest = losers.slice(1);
      const fakes = rng.shuffle(rest.filter((i) => role[i] === 'fake'));
      const hope = rest.filter((i) => role[i] === 'hopeless');
      const others = rng.shuffle(rest.filter((i) => role[i] !== 'fake' && role[i] !== 'hopeless'));
      for (const i of fakes.concat(others, hope)) {
        if (role[i] === 'hopeless') lt += rng.range(1.5, 3.2);
        else lt += rng.range(0.05, 0.5) + (rng.chance(0.12) ? rng.range(0.5, 1.4) : 0);
        finishT[i] = Math.min(lt, T5 + 9);
      }
    }

    // winners and the heartbreak runner (6th by a hair) arrive exactly on plan
    const exact = new Uint8Array(N);
    for (let i = 0; i < N; i++) exact[i] = isW[i] || i === heartbreak ? 1 : 0;

    // ---- arrival: in the final A seconds everyone runs at a steady "kick" pace
    const A = clamp(0.085 * T1, 2.2, 4.6);
    const ta = T1 - A;
    const kick = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const r = role[i];
      let k;
      if (safe) k = isW[i] ? rng.range(0.1, 0.5) : rng.range(-0.4, 0.2);
      else if (isW[i]) {
        if (r === 'front') k = rng.range(-0.4, 0.3);
        else if (scenario === 'charge') k = rng.range(0.7, 1.9);
        else if (scenario === 'photo') k = rng.range(0.2, 1.0);
        else if (scenario === 'hold') k = rng.range(0.1, 1.1);
        else k = rng.range(-0.3, 1.7);
      } else if (r === 'fake') k = rng.range(-2.1, -1.0);
      else if (i === heartbreak) k = rng.chance(0.5) ? rng.range(-1.5, -0.4) : rng.range(0.3, 1.2);
      else if (r === 'hopeless') k = rng.range(-0.6, 0.2);
      else k = rng.range(-1.2, 0.9);
      kick[i] = k;
    }
    const oTa = new Float64Array(N);
    for (let i = 0; i < N; i++) oTa[i] = -(finishT[i] - T1) * vref - kick[i] * A;

    // ---- storyline keyframes (offset from the reference runner, meters)
    const FR = [0.06, 0.15, 0.27, 0.40, 0.52, 0.64, 0.75, 0.84];
    const SP = [1.2, 3.5, 6.5, 8.5, 9.5, 9.5, 8.5, 7];
    const fa = ta / T1;
    const n = (a) => rng.range(-a, a);
    const ZF = {
      front: () => 0.7 + n(0.25),
      fake: (f) => (f < 0.15 ? n(0.5) : 0.9 + n(0.15)),
      bolter: (f) => (f < 0.3 ? 0.95 : f < 0.6 ? 0.95 - ((f - 0.3) / 0.3) * 1.4 : -0.5 + n(0.3)),
      comeback: (f) => (f < 0.45 ? -0.95 + n(0.1) : -0.95 + ((f - 0.45) / 0.4) * 1.3 + n(0.2)),
      surge: (f) => (f < 0.55 ? -0.4 + n(0.3) : -0.4 + ((f - 0.55) / 0.3) * 1.0 + n(0.2)),
      steady: () => n(0.45),
      chaos: () => n(1.0),
      hopeless: () => -0.9 + n(0.15),
    };
    const splines = new Array(N);
    for (let i = 0; i < N; i++) {
      let walk = 0;
      const keys = [{ t: 0, o: 0, m: 0 }];
      for (let k = 0; k < FR.length; k++) {
        const f = FR[k];
        if (f * T1 > ta - 1.2) break;
        walk = clamp(walk + n(0.35), -0.8, 0.8);
        const z = safe ? n(0.2) : clamp(ZF[role[i]](f) + walk * 0.45, -1.15, 1.15);
        let o = z * SP[k] * spec.spread;
        o = lerp(o, oTa[i], smoothstep(0.5, fa, f) * 0.85);
        keys.push({ t: f * T1, o });
      }
      keys.push({ t: ta, o: oTa[i], m: kick[i] });
      splines[i] = makeSpline(keys);
    }

    // ---- gags
    const gags = [];
    const globals = [];
    const react = new Float64Array(N);
    for (let i = 0; i < N; i++) react[i] = 0.1 + rng.range(0, 0.16);
    const byRunner = [...Array(N)].map(() => []);
    const free = (i, t0, dur, margin) => byRunner[i].every((g) => t0 + dur + margin < g.t0 || t0 > g.t0 + g.dur + margin);
    const addGag = (i, type, t0, durScale) => {
      const dur = GAGS[type].dur * (durScale || 1);
      const g = { i, type, t0, dur };
      gags.push(g); byRunner[i].push(g);
      return g;
    };
    const typeUse = {};
    const pickType = (pool) => {
      const t = rng.weighted(pool, (k) => (typeUse[k] || 0) === 0 ? 3 : typeUse[k] === 1 ? 1 : 0.15);
      typeUse[t] = (typeUse[t] || 0) + 1;
      return t;
    };
    const winnerBadCutoff = ta - 6.5;
    const winnerGoodCutoff = ta - 4;

    if (!safe) {
      // someone sleeps through the gun
      if (rng.chance(0.4)) {
        const i = rng.int(0, N - 1);
        react[i] = rng.range(0.9, 1.5);
        gags.push({ i, type: 'sleepy', t0: 0, dur: react[i] });
        byRunner[i].push(gags[gags.length - 1]);
      }
      // comeback winners start with a disaster
      for (const w of W) {
        if (role[w] !== 'comeback') continue;
        const t0 = rng.range(1.8, Math.max(2.4, 0.3 * T1));
        const type = pickType(EARLY_DISASTER);
        if (t0 + GAGS[type].dur < winnerBadCutoff && free(w, t0, GAGS[type].dur, 1)) addGag(w, type, t0);
      }
      // early bolters get a boost
      for (const l of losers) {
        if (role[l] !== 'bolter' || !rng.chance(0.6)) continue;
        const t0 = rng.range(2.0, Math.max(2.5, 0.2 * T1));
        const type = pickType(GOOD);
        if (free(l, t0, GAGS[type].dur, 1)) addGag(l, type, t0);
      }
      // fading favourites blow it at the end
      for (const l of losers) {
        if (role[l] !== 'fake' || l === heartbreak || !rng.chance(0.75)) continue;
        const t0 = ta + rng.range(-0.8, Math.min(1.4, A - 1.2));
        const type = pickType(LATE_FADE);
        if (free(l, t0, GAGS[type].dur, 0.5)) addGag(l, type, t0, 0.8);
      }
      // everything else
      const gap = CHAOS_GAP[cfg.chaos] || CHAOS_GAP.normal;
      let ts = rng.range(1.8, 3.2);
      const gagCount = [...Array(N)].map((_, i) => byRunner[i].length);
      while (ts < ta + 1.0) {
        const near = gags.some((g) => Math.abs(g.t0 - ts) < 0.9);
        if (!near) {
          if (ts > 4 && ts < ta - 2 && rng.chance(0.17)) {
            const types = Object.keys(GLOBALS).filter((k) => !globals.some((g) => g.type === k));
            if (types.length) {
              const type = rng.pick(types);
              globals.push({ type, t0: ts, dur: GLOBALS[type], seed: rng.int(0, 1e9) });
            }
          } else {
            const kind = rng.chance(0.65) ? 'bad' : 'good';
            const pool = kind === 'bad' ? BAD : GOOD;
            const type = pickType(pool);
            const dur = GAGS[type].dur;
            const cands = [];
            for (let i = 0; i < N; i++) {
              if (!free(i, ts, dur, 2.5)) continue;
              if (exact[i]) {
                if (kind === 'bad' && ts + dur > winnerBadCutoff) continue;
                if (kind === 'good' && ts + dur > winnerGoodCutoff) continue;
              } else {
                if (kind === 'good' && ts + dur > ta - 1.5) continue;
                if (ts > finishT[i] - 1.0) continue;
              }
              cands.push(i);
            }
            if (cands.length) {
              const i = rng.weighted(cands, (c) => 1 / Math.pow(1 + gagCount[c], 2));
              addGag(i, type, ts);
              gagCount[i]++;
            } else {
              typeUse[type]--;
            }
          }
        }
        ts += gap * rng.range(0.6, 1.4);
      }
    }
    gags.sort((a, b) => a.t0 - b.t0);
    for (const list of byRunner) list.sort((a, b) => a.t0 - b.t0);

    // ---- simulate
    const tEndTarget = Math.max(...finishT) + 4;
    const K = Math.ceil(tEndTarget / DT) + 1;
    const pos = new Float32Array(N * K);
    const p = new Float64Array(N), v = new Float64Array(N);
    const crossT = new Float64Array(N).fill(-1);
    const gp = new Int32Array(N);
    const arrivalSpeed = new Float64Array(N);
    let valid = true;
    for (let k = 0; k < K; k++) {
      const t = k * DT;
      const rv = ref.v(t), rp = ref.p(t);
      for (let i = 0; i < N; i++) {
        pos[i * K + k] = p[i];
        const list = byRunner[i];
        while (gp[i] < list.length && t >= list[gp[i]].t0 + list[gp[i]].dur) gp[i]++;
        const g = gp[i] < list.length && t >= list[gp[i]].t0 ? list[gp[i]] : null;
        let target, up = ACC, down = 10, direct = false;
        if (crossT[i] >= 0) {
          const left = D + 14 - p[i];
          target = left > 0 ? Math.min(v[i], Math.sqrt(2 * 3.5 * left)) : 0;
          down = 3.5;
        } else if (t < react[i]) {
          target = 0;
        } else if (g) {
          const u = (t - g.t0) / g.dur;
          target = GAGS[g.type].speed(u) * Math.max(rv, vref * 0.5);
          up = 30; down = 40;
        } else if (t >= ta) {
          const rem = finishT[i] - t;
          if (exact[i]) {
            target = (D - p[i]) / Math.max(rem, 1e-4);
            direct = true;
            if (!arrivalSpeed[i]) arrivalSpeed[i] = target / rv;
          } else {
            target = clamp((D - p[i]) / Math.max(rem, DT), 0.45 * rv, 1.3 * rv);
          }
        } else {
          const [od, odv] = splines[i](t);
          const err = rp + od - p[i];
          target = rv + odv + clamp(0.4 * err, -0.28 * vref, 0.28 * vref);
          const lo = t < 2 ? 0 : 0.5 * rv;
          target = clamp(target, lo, Math.max(1.32 * rv, 0.1));
        }
        if (direct) v[i] = target;
        else v[i] += clamp(target - v[i], -down * DT, up * DT);
        if (!isW[i] && crossT[i] < 0 && t < T5 + EPS) {
          v[i] = Math.min(v[i], (D - p[i]) / Math.max(T5 + EPS - t, 1e-6));
        }
        const np = p[i] + v[i] * DT;
        if (crossT[i] < 0 && np >= D && v[i] > 0) crossT[i] = t + (D - p[i]) / v[i];
        p[i] = np;
      }
    }
    for (let i = 0; i < N; i++) if (crossT[i] < 0) valid = false;

    // ---- verify the result
    for (let j = 0; j < 5 && valid; j++) {
      const w = W[j];
      if (Math.abs(crossT[w] - finishT[w]) > 0.02) valid = false;
      if (j > 0 && !(crossT[w] > crossT[W[j - 1]])) valid = false;
      if (arrivalSpeed[w] < 0.7 || arrivalSpeed[w] > 1.42) valid = false;
    }
    for (let i = 0; i < N && valid; i++) if (!isW[i] && crossT[i] <= crossT[W[4]]) valid = false;
    if (valid && heartbreak >= 0) {
      if (Math.abs(crossT[heartbreak] - finishT[heartbreak]) > 0.02) valid = false;
      if (arrivalSpeed[heartbreak] < 0.7 || arrivalSpeed[heartbreak] > 1.42) valid = false;
    }
    if (!valid) return null;

    // ---- how exciting is it?
    const at = (i, t) => pos[i * K + Math.min(K - 1, Math.max(0, Math.round(t / DT)))];
    const leadChanges = [];
    let leader = -1;
    const kStart = Math.round(1.5 / DT), kEnd = Math.round(T1 / DT);
    for (let k = kStart; k <= kEnd; k++) {
      let best = 0;
      for (let i = 1; i < N; i++) if (pos[i * K + k] > pos[best * K + k]) best = i;
      if (leader < 0) { leader = best; leadChanges.push({ t: k * DT, i: best }); }
      else if (best !== leader && pos[best * K + k] - pos[leader * K + k] > 0.35) {
        leader = best; leadChanges.push({ t: k * DT, i: best });
      }
    }
    const rankAt = (t) => [...Array(N).keys()].sort((a, b) => at(b, t) - at(a, t));
    const overlap = (t) => rankAt(t).slice(0, 5).filter((i) => isW[i]).length;
    const ov50 = overlap(T1 * 0.5), ov75 = overlap(T1 * 0.75), ov90 = overlap(ta - 0.3);
    const distinct = new Set(leadChanges.map((l) => l.i)).size;
    const lead75 = rankAt(T1 * 0.75)[0];
    let score = leadChanges.length * 1.0 + distinct * 1.5;
    if (N >= 7) score += (5 - ov50) * 1.2 + (5 - ov75) * 1.5 + (5 - ov90) * 0.8;
    if (lead75 !== W[0]) score += 1.5;
    if (leadChanges.length > 14) score -= (leadChanges.length - 14) * 1.5;
    const good = leadChanges.length >= (T1 < 30 ? 2 : 3) && distinct >= 3 && (N < 8 || (ov50 <= 3 && ov75 <= 3));

    return {
      seed, N, D, vref, dt: DT, ticks: K, pos, crossT, finishT, T1, T5, ta,
      react, gags, globals, role, scenario, leadChanges, score, good, winners: W, isW,
    };
  }

  // ---------------------------------------------------------------- commentary
  function buildCommentary(plan, cfg) {
    const rng = makeRng(plan.seed ^ 0xC0FFEE);
    const N = plan.N, K = plan.ticks;
    const nm = (i) => cfg.names[i];
    const used = new Set();
    const pickLine = (pool) => {
      const avail = pool.filter((s) => !used.has(s));
      const s = rng.pick(avail.length ? avail : pool);
      used.add(s);
      return s;
    };
    const at = (i, t) => plan.pos[i * K + Math.min(K - 1, Math.max(0, Math.round(t / DT)))];
    const rankAt = (t) => [...Array(N).keys()].sort((a, b) => at(b, t) - at(a, t));
    const timeLeaderReaches = (m) => {
      for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) if (plan.pos[i * K + k] >= m) return k * DT;
      return null;
    };

    const ev = [];
    ev.push({ t: 0.15, prio: 6, lines: [pickLine(TXT.start)] });
    for (const g of plan.gags) {
      const pool = TXT.gag[g.type];
      if (pool) ev.push({ t: g.t0 + (g.type === 'sleepy' ? 0.6 : 0.15), prio: 3, lines: [fill(pickLine(pool), { n: nm(g.i) })] });
    }
    for (const g of plan.globals) ev.push({ t: g.t0 + 0.4, prio: 2, lines: [pickLine(TXT.global[g.type])] });
    plan.leadChanges.forEach((lc, idx) => {
      if (idx === 0 && lc.t < 3) return;
      ev.push({ t: lc.t, prio: 3.5, lines: [fill(pickLine(TXT.lead), { n: nm(lc.i) })] });
    });
    const half = timeLeaderReaches(plan.D / 2);
    if (half) ev.push({ t: half, prio: 4, lines: [pickLine(TXT.half)] });
    if (plan.D >= 300) {
      const m100 = timeLeaderReaches(plan.D - 100);
      if (m100) ev.push({ t: m100, prio: 4.5, lines: [pickLine(TXT.m100)] });
    }
    const m50 = timeLeaderReaches(plan.D - 50);
    if (m50) ev.push({ t: m50, prio: 5, lines: [pickLine(TXT.m50)] });
    ev.push({ t: plan.T1 - 0.5, prio: 7, lines: [pickLine(TXT.finish)] });

    const lineDur = (s) => clamp(1.5 + s.length * 0.045, 2.2, 4.4);
    const slots = [];
    const fits = (a, b) => slots.every((s) => b <= s.t || a >= s.t + s.dur);
    const place = (e) => {
      const total = e.lines.reduce((acc, s) => acc + lineDur(s), 0);
      const maxDelay = e.prio >= 4 ? 2.5 : e.prio >= 3 ? 1.3 : 0.9;
      for (let d = 0; d <= maxDelay; d += 0.1) {
        const a = e.t + d;
        if (fits(a, a + total)) {
          let tt = a;
          for (const s of e.lines) { slots.push({ t: tt, dur: lineDur(s), text: s }); tt += lineDur(s); }
          return true;
        }
      }
      return false;
    };
    ev.sort((a, b) => b.prio - a.prio || a.t - b.t).forEach(place);

    // fill the quiet moments with banter
    const bits = rng.shuffle(TXT.fillers);
    let bi = 0;
    for (let t = 3.5; t < plan.T1 - 5 && bi < bits.length; t += 0.5) {
      const bit = bits[bi];
      const r = rankAt(t);
      const vars = {
        leader: nm(r[0]), last: nm(r[N - 1]), mid: nm(r[Math.floor(N / 2)]),
        rand: nm(r[rng.int(0, N - 1)]), lane: String(rng.int(1, N)),
      };
      const lines = bit.map((s) => fill(s, vars));
      const total = lines.reduce((acc, s) => acc + lineDur(s), 0);
      if (fits(t - 1.2, t + total + 0.6)) {
        let tt = t;
        for (const s of lines) { slots.push({ t: tt, dur: lineDur(s), text: s }); tt += lineDur(s); }
        bi++;
        t += total + 2;
      }
    }
    slots.sort((a, b) => a.t - b.t);
    slots.forEach((s, idx) => { s.who = idx % 2; });
    plan.lines = slots;

    // speech bubbles
    const BUB = {
      trip: ['OOF!', 'MY FACE!', 'OUCH!'], banana: ['BANANA?!', 'WHOAAA!', 'WHO DID THIS?!'],
      laces: ['MY LACES!', 'DOUBLE KNOT...'], selfie: ['#WINNING', 'SAY CHEESE!', 'FOR THE FANS!'],
      phone: ['HI MOM!', "CAN'T TALK, RACING", 'NO, I DON\'T WANT A WARRANTY'], hotdog: ['NOM NOM', 'EXTRA MUSTARD!', 'WORTH IT'],
      cramp: ['OW OW OW', 'CRAMP!!', 'MY CALF!'], wrongway: ['WAIT...', 'WRONG WAY?!', 'OOPS'],
      moonwalk: ['HEE-HEE!', 'SMOOTH.', 'WATCH THIS'], pigeon: ['SHOO!', 'NOT THE HAIR!', 'GET OFF!'],
      rain: ['WHY ME?', 'TYPICAL.', 'IT FOLLOWS ME!'], autograph: ["YOU'RE WELCOME", 'TO MY #1 FAN'],
      flex: ['THE GUNS!', 'LOOK AT THIS!', 'GYM PAID OFF'], tired: ['*WHEEZE*', 'NEED... WATER', 'NAP TIME?'],
      shoe: ['MY SHOE!', 'COME BACK!'], ufo: ['NOT AGAIN!', 'PUT ME DOWN!'], cartwheel: ['WHEEE!', 'STYLE POINTS!'],
      wave: ['HI MOM!', 'LOVE YOU ALL!'], celebrate: ["I'VE GOT THIS!", 'EASY WIN!', 'TOO EASY!'], sleepy: ['ZZZ...'],
      energy: ['GLUG GLUG', 'POWER UP!'], dog: ['AAAAAH!', 'GOOD BOY?!', 'NOT THE DOG!'], bees: ['BEES!!', 'NOT THE BEES!'],
      sneeze: ['ACHOO!'], secondwind: ['NOT TODAY!', 'SECOND WIND!', 'I BELIEVE!'], rocket: ['WHOA-OA-OA!', 'TOO FAST!'],
      ufogood: ['THANKS, ALIENS!', 'BEAM ME UP!'],
    };
    plan.bubbles = plan.gags.map((g) => ({
      i: g.i, t0: g.t0 + 0.05, t1: g.t0 + Math.min(g.dur, 1.9) + 0.25, text: rng.pick(BUB[g.type] || ['!?']),
    }));

    // bios for the intro screen
    const bios = rng.shuffle(TXT.bios);
    plan.bios = cfg.names.map((_, i) => bios[i % bios.length]);
  }

  // ---------------------------------------------------------------- public
  function planRace(cfg) {
    if (!cfg || !Array.isArray(cfg.names) || cfg.names.length < 5) throw new Error('Need at least 5 runners');
    const w = cfg.winners;
    if (!Array.isArray(w) || w.length !== 5 || new Set(w).size !== 5 || w.some((x) => !(x >= 0 && x < cfg.names.length))) {
      throw new Error('Need 5 different winners');
    }
    const baseSeed = cfg.seed >>> 0;
    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const plan = attemptPlan(cfg, (baseSeed + Math.imul(attempt, 0x9E3779B1)) >>> 0, false);
      if (!plan) continue;
      if (!best || (plan.good && !best.good) || (plan.good === best.good && plan.score > best.score)) best = plan;
      if (plan.good && attempt >= 2) break;
    }
    if (!best) {
      for (let attempt = 0; attempt < 10 && !best; attempt++) best = attemptPlan(cfg, (baseSeed ^ 0xA5A5A5A5) + attempt, true);
    }
    if (!best) throw new Error('Could not plan a race');
    best.baseSeed = baseSeed;
    best.length = cfg.length;
    buildCommentary(best, cfg);
    best.order = [...Array(best.N).keys()].sort((a, b) => best.crossT[a] - best.crossT[b]);
    return best;
  }

  const Planner = { planRace, makeRng, hashStr, LENGTHS, GAGS, GLOBALS, TXT, DT, fill };
  if (typeof module !== 'undefined' && module.exports) module.exports = Planner;
  else root.Planner = Planner;
})(typeof self !== 'undefined' ? self : this);
