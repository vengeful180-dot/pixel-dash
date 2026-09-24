// Stress test for the race director: random line-ups, random winners, every
// length and chaos level. The chosen five must always finish 1st..5th.
// Run: node test/planner.test.js [races]
'use strict';
const Planner = require('../js/planner.js');

const RACES = Number(process.argv[2]) || 600;
const rng = Planner.makeRng(12345);
const lengths = Object.keys(Planner.LENGTHS);
const chaos = ['calm', 'normal', 'chaos'];

let fails = 0, good = 0, totalLead = 0, w1LedAt75 = 0, top5Was = 0;
let slowest = 0;
const gap56 = [];
let duoTotal = 0;
for (let r = 0; r < RACES; r++) {
  const N = rng.int(5, 20);
  const names = [...Array(N)].map((_, i) => 'Runner ' + (i + 1));
  const winners = rng.shuffle([...Array(N).keys()]).slice(0, 5);
  const cfg = { names, winners, length: rng.pick(lengths), chaos: rng.pick(chaos), seed: rng.int(0, 2 ** 31) };
  const t0 = Date.now();
  let plan;
  try {
    plan = Planner.planRace(cfg);
  } catch (e) {
    fails++;
    console.log('THROW', JSON.stringify(cfg), e.message);
    continue;
  }
  slowest = Math.max(slowest, Date.now() - t0);
  const order = plan.order;
  const ok = winners.every((w, j) => order[j] === w);
  // loser can never tie or beat 5th
  const t5 = plan.crossT[winners[4]];
  const loserOk = order.slice(5).every((i) => plan.crossT[i] > t5);
  // positions must be finite and runners must not teleport
  let sane = true;
  const K = plan.ticks;
  for (let i = 0; i < N && sane; i++) {
    for (let k = 1; k < K; k++) {
      const a = plan.pos[i * K + k - 1], b = plan.pos[i * K + k];
      if (!Number.isFinite(b) || Math.abs(b - a) > 0.5) { sane = false; break; }
    }
  }
  // determinism
  const again = Planner.planRace(cfg);
  const same = again.order.join() === order.join() && again.pos[123] === plan.pos[123] && again.lines.length === plan.lines.length;
  if (!ok || !loserOk || !sane || !same) {
    fails++;
    console.log('FAIL', { ok, loserOk, sane, same }, JSON.stringify(cfg));
  }
  // two-runner gags: the pair must be neighbours at that moment
  for (const g of plan.gags) {
    if (!g.duo || g.role !== 'a') continue;
    const D = Planner.DUO[g.type];
    const k = Math.round(g.t0 / plan.dt);
    const d = plan.pos[g.other * K + k] - plan.pos[g.i * K + k];
    if (Math.abs(g.i - g.other) > D.lanes || d < D.gap[0] - 0.2 || d > D.gap[1] + 0.2) {
      fails++;
      console.log('DUO FAIL', g.type, g.i, g.other, d.toFixed(2), JSON.stringify(cfg));
    }
    duoTotal++;
  }
  if (N > 5) { const gap = plan.crossT[order[5]] - t5; gap56.push(gap); }
  if (plan.good) good++;
  totalLead += plan.leadChanges.length;
  const k75 = Math.round(plan.T1 * 0.75 / plan.dt);
  let lead = 0;
  for (let i = 1; i < N; i++) if (plan.pos[i * K + k75] > plan.pos[lead * K + k75]) lead = i;
  if (lead === winners[0]) w1LedAt75++;
  const top5 = [...Array(N).keys()].sort((a, b) => plan.pos[b * K + k75] - plan.pos[a * K + k75]).slice(0, 5);
  if (N >= 8 && top5.every((i) => winners.includes(i))) top5Was++;
}
console.log(`races: ${RACES}  failures: ${fails}`);
console.log(`"exciting" plans: ${(100 * good / RACES).toFixed(1)}%  avg lead changes: ${(totalLead / RACES).toFixed(1)}`);
console.log(`winner already leading at 75%: ${(100 * w1LedAt75 / RACES).toFixed(1)}%   top-5 at 75% == winners: ${(100 * top5Was / RACES).toFixed(1)}%`);
console.log(`slowest plan: ${slowest} ms   two-runner gags checked: ${duoTotal}`);
gap56.sort((a, b) => a - b);
console.log(`gap 5th->6th: median ${gap56[gap56.length >> 1].toFixed(3)}s  max ${gap56[gap56.length - 1].toFixed(3)}s`);
process.exit(fails ? 1 : 0);
