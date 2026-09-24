# Pixel Dash

A pixel-art stadium race where anything can happen: banana peels, runaway dogs, alien abductions, runners who stop for a hot dog. It always looks like anyone could win. The host has secretly picked the top 5, and they finish in exactly that order.

## How to use it

1. Open the site. You land on the **host panel**.
2. Enter the runners, one name per line (5 to 20).
3. Pick your **top 5**, 1st to 5th.
4. Choose a race length (200 m ≈ 30 s, 400 m ≈ 1 min, 800 m ≈ 2 min), how many gags you want, and the bazooka (off, 50% chance, or always).
5. Either:
   - **▶ Start race here** to play it on your own screen (great for screen-sharing or a projector), or
   - **🔗 Create share link** to get a link to send around. Everyone who opens it sees a start screen with the runners, presses *Start the race*, and watches the same race.

Your picks are scrambled inside the link. Viewers never see the host panel or any list of winners. Each new link is a new race with different gags and a different storyline (same winners). Replays of one link are identical.

## What happens in a race

- The start: on your marks, set, the occasional false start, and sometimes a runner sleeps through the gun. Runners react and accelerate differently, so the field spreads out before the first gag.
- 25+ gags: trips, banana peels, shoelaces, selfies, phone calls, hot dogs, cramps, running the wrong way, moonwalking, pigeon attacks, personal rain clouds, UFO abductions (some helpful), energy drinks, dogs and bees chasing people, rocket shoes, and celebrating too early.
- Runners mess with each other: throwing pies, water balloons, tomatoes and rubber chickens; shoving; sneaky trip-ups; full cartoon fights in a dust cloud until the referee breaks it up; and the occasional high five. These only happen between runners who are actually side by side at that moment.
- Rides and visitors: an electric scooter (until the battery dies or the referee confiscates it), a pogo stick, and the mascot tackle-hugging someone.
- Gag cam: when something happens, the race slows down and the camera punches in on it, with letterbox bars and a title card ("PIE ATTACK! Sam → Jordan"). Impacts get a split-second freeze, camera shake and a comic word ("POW!", "SPLAT!"); runners in the shot leave afterimages.
- Most of the action happens at the front of the race, where people are watching.
- The bazooka: someone further back fires a rocket into the front of the pack. Everyone near the blast goes flying in heavy slow motion, then gets up with a sooty face. If nobody is behind to fire it, a fan in the stands does.
- The finale: in most races someone outside your top 5 leads into the last meters and blows it right before the line. They trip, slip on a banana, celebrate too early, take a bow, stop for a selfie, get tackled or get hit by a water balloon from the runner behind. Your winners stream past in slow motion. Close finishes end with a dive across the line.
- Stadium events: the crowd does the wave, ducks cross the infield, the mascot joins in, a blimp flies over, and somebody fires the confetti cannon early.
- Two commentators react to the gags, lead changes and the final stretch, with banter in between.
- A slow-motion photo finish, then a podium ceremony that reveals 5th to 1st, plus a note on who just missed out in 6th.
- Day, sunset and night stadiums, fan banners with the runners' names, a live top-5 bar and a mini-map.
- An original chiptune theme song that starts with the starting gun, picks up in the final stretch, goes muffled during the slow-motion finish and comes back for the podium.
- Gags happen one at a time, with a pause in between, so every joke has room to land.

## How the rigging works

`js/planner.js` plans the whole race before it starts, from a seed:

- Every runner gets a storyline: *fake favourite* (leads most of the race, then fades or celebrates too early), *comeback* (a disaster early, then a charge), *late surge*, *steady*, *chaos*, and so on. Winners and losers both get good and bad luck.
- Gags override a runner's speed for a moment. A controller then pulls them back toward their storyline, so the field keeps shuffling.
- In the last few seconds each winner runs at exactly the speed that lands them on the line at their planned time. Nobody else may cross before the 5th winner. The 6th-place runner is timed to miss the top 5 by less than a tenth of a second.
- Each race is scored for drama: lead changes, different leaders, and winners who are *not* the top 5 at halfway or at 75%. Boring plans get re-rolled.

`test/planner.test.js` plans hundreds of random races and checks that the chosen five always finish 1st–5th, that runners never teleport, and that the same seed gives the same race.

## Running locally

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Run the planner tests with `npm test` (or `node test/planner.test.js 1000`).

## Publishing on GitHub Pages

Settings → Pages → *Build and deployment* → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save. After a minute the site is live at `https://<your-user>.github.io/pixel-dash/`.
