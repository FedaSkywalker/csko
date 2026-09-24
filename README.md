# Browser Strike

A tactical 5v5 bomb-defusal shooter in the style of Counter-Strike, running in the browser.
It uses three.js and Vite. Every texture, model and sound is generated in code, so the game
downloads no external assets.

## Run it

Requirements: Node.js 18 or newer (tested with Node 24) and a desktop browser with WebGL2
(Chrome, Edge or Firefox).

```bash
cd browser-strike
npm install
npm run dev
```

Open **http://localhost:5173** and click **PLAY vs BOTS**. The browser then locks the mouse.
Press `Esc` to pause.

To play the production build:

```bash
npm run build
npm run preview   # http://localhost:4173
```

## Maps

Pick the map in the menu (**Map**). The menu flyover shows the selected one.

- **Dustline:** a desert map with long A, catwalk, mid with mid doors, B tunnels and two bombsites
  on one floor.
- **Nukeline:** an industrial map in the spirit of the classic nuclear plant, on two floors. Bombsite
  **A** is in the reactor hall on the main floor, bombsite **B** is directly underneath it.
  - T side: spawn, lobby, squeaky (a corridor with a turn), hut, main door and the outside yard with
    silos, containers and a Turkish Kebab kiosk.
  - CT side: spawn, garage, mini, heaven (a catwalk above A) and hell below it.
  - Ways down to B: the ramp from the lobby, the secret stairs from the yard, the decon stairs and the
    CT stairs from CT spawn, and one-way drops through the hatch and the vent in A's floor.
  - The radar switches between **UPPER** and **LOWER** depending on where you stand; players on the
    other floor are drawn faded.

## Multiplayer (PartyKit)

Multiplayer runs on [PartyKit](https://docs.partykit.io/). Each **room** is its own match: a PartyKit
room (a Cloudflare Durable Object) runs the authoritative simulation at 64 ticks per second.
Everyone plays in the browser and joins by room name.

### Local network (one PC hosts)

On the host PC:

```bash
cd browser-strike
npm install
npm run party
```

`npm run party` builds the client and starts `partykit dev`, which serves the game and the rooms on
port 1999 on all network interfaces. It prints the addresses, for example:

```
Ready on http://0.0.0.0:1999
- http://127.0.0.1:1999
- http://192.168.1.23:1999
```

- The host opens `http://localhost:1999`, the others open the LAN address (`http://192.168.1.23:1999`).
- In the menu set your name and team, pick a **room** name (default `dustline`) and click **JOIN**.
  Everyone who types the same room plays together. Different rooms are separate matches.
- The first player in an empty room decides the map, team size, bot skill and match length (the
  settings on the right side of the menu). Players who join later get the room's map automatically.

### Online (anyone, anywhere)

```bash
npx partykit login     # once, opens GitHub login in the browser
npm run deploy
```

`npm run deploy` builds the client and deploys the server and the static game to
`https://browser-strike.<your-github-name>.partykit.dev`. Send that link to your friends; the page
connects to its own host over `wss://`.

### In the match

- Bots fill the empty slots of both teams. When a player joins, a bot leaves at the next round;
  when a player leaves, a bot takes the slot again.
- If you join during freeze time you spawn at once. Otherwise you spectate until the next round.
- `Esc` opens the pause menu. The match keeps running, so your player just stands still. The pause
  menu has **Switch to T / Switch to CT** (applies next round).
- `Y` / `U` open the chat (everyone / team).
- After a match ends, the next one starts automatically after about 12 seconds. A room shuts its game
  loop down when the last player leaves.
- `GET /parties/main/<room>` returns the room status as JSON (players, round, score).

If other PCs can't connect locally:

- macOS may ask whether `workerd` (the PartyKit runtime) may accept incoming connections. Click
  **Allow**. On Windows, allow Node.js / workerd through the firewall for private networks.
- Some Wi-Fi routers (especially guest networks) isolate devices from each other. Use a normal
  network or a cable.
- Everyone must use the same build. After changing code, rebuild (`npm run party` again); clients with
  an old page get a version-mismatch message and just need to reload.

How the netcode works: browsers send their inputs every tick, predict their own movement locally and
correct it from the server snapshots. Other players are drawn about 70 ms in the past so their movement
is smooth, and the server rewinds them to that moment when it checks your hits (lag compensation).

For development run the PartyKit dev server and Vite side by side: `npx partykit dev` (port 1999) and
`npm run dev` (port 5173, proxies `/parties` to 1999, JOIN works from the Vite page too).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Aim |
| `LMB` | Fire / knife slash / throw grenade (overhand) |
| `RMB` | AWP scope (2 zoom levels) / heavy knife stab / underhand grenade |
| `Space` | Jump (crouch while in the air to crouch-jump onto higher crates) |
| `Ctrl` or `C` | Crouch |
| `Shift` | Walk. You make no footstep sounds and stay accurate. |
| `1`–`5` | Primary, pistol, knife, grenades (press again to cycle), C4 |
| `Q` / mouse wheel | Last weapon / cycle weapons |
| `R` | Reload |
| `B` | Buy menu. Use number keys to pick an item; `0` goes back; `B` closes. |
| `E` | Plant (inside a bombsite with the C4), defuse, or pick up a weapon |
| `G` | Drop the current weapon |
| `Tab` | Scoreboard |
| `Y` / `U` | Chat to everyone / to your team (`Enter` sends) |
| `F` | Inspect weapon |
| `` ` `` | Net graph (FPS, draw calls, speed) |

On Windows, `Ctrl+W` closes the browser tab and the page cannot block it. Crouch with `C` there.

## How a match works

- Two teams: **Terrorists** (T) and **Counter-Terrorists** (CT). You play one side and bots fill
  both teams. You set team size (1v1 to 5v5), bot skill and match length in the menu.
- **Buy phase:** each round starts with 6 seconds of freeze time. You can buy during freeze time
  and for 20 seconds after it, as long as you are in your spawn zone.
- **Economy:**
  - You start with $800.
  - A kill pays $300, an SMG kill $600, an AWP kill $100 and a knife kill $1500.
  - A round win pays $3250, or $3500 if the round ends by bomb.
  - The losing team gets $1400, plus $500 for each loss in a row, up to $3400.
  - The Terrorists get $800 extra if they planted the bomb.
- **Bomb:**
  - One Terrorist carries the C4.
  - Planting takes 3.2 s inside site A or B, and the bomb explodes after 40 s.
  - Defusing takes 10 s, or 5 s with a defuse kit.
  - The bomb carrier drops the C4 on death, and another Terrorist can pick it up.
- **Winning a round:** eliminate the other team. The Terrorists also win when the bomb explodes.
  The CTs also win when the bomb is defused or the round timer (1:55) runs out.
- **Weapons:**

  | Type | Weapons |
  | --- | --- |
  | Knife | Knife |
  | Pistols | Glock-18, USP-S, Desert Eagle |
  | SMG | MP5-SD |
  | Rifles | AK-47, M4A1 |
  | Sniper | AWP |
  | Grenades | HE, flashbang, smoke |
  | Gear | Kevlar, helmet, defuse kit |

  - Each rifle has a CS-like spray pattern. Pull down to control the spray.
  - Moving and jumping make your shots inaccurate.
  - Headshots deal ×4 damage, and armor reduces damage.
  - Bullets can go through wooden crates.

## Features

- CS-style movement: 64-tick simulation, ground friction and acceleration, air strafing,
  crouch-jumping, auto step-up on stairs.
- Hitscan shooting against per-body-part hitboxes, with damage falloff over distance.
- **Bots:**
  - They follow attack routes and hold bombsites.
  - They rotate when teammates spot enemies, plant the bomb, retake the site and defuse.
  - Before aiming they have a reaction time, and their aim is imperfect.
  - They fire in bursts, buy weapons from their team's money, throw grenades, and run from
    the bomb when it is about to explode.
- **Two maps:** Dustline (desert, one floor) and Nukeline (industrial, bombsite A above bombsite B),
  with real-time sun shadows. Bots navigate both floors, including stairs, the ramp and the drops.
- **HUD:**
  - Rotating radar, kill feed, scoreboard and buy menu.
  - Damage direction indicator.
  - AWP scope overlay and flashbang whiteout.
  - Smoke that blocks bots' vision.
- **Turkish Kebab:** a small restaurant off mid on Dustline and a kiosk in the yard on Nukeline (sign
  above the door, turning döner, tables). Fried
  cheese ("vyprážaný syr") is served on the counter and on a table. Walk over it while hurt to heal
  +50 HP; it comes back 25 seconds later. Wounded bots go there to eat too, and it's on the radar as an
  orange square.
- **Names above heads:** teammates always (also through walls, with a health bar), enemies only while you
  can actually see them. The menu setting *Mená nad hlavami / name tags* switches between All, Team
  only and Off.
- Positional synthesized sound. Walls muffle it, so you can hear enemy footsteps.
- **Trash-talk language:** in the menu, choose **Východniarsky** (default) or **English**.
  - In Východniarsky mode the announcer and the bots swear and call out in the East Slovak
    dialect, both in chat and aloud through the browser's speech synthesis: kills, deaths, getting
    hit, reloading, buying, callouts, last man standing, multi-kills, idle trash talk every few seconds,
    eating fried cheese, and answers when a human writes in chat.
  - Uncheck *Voice* to mute the spoken lines.

## Project layout

```
party/
  server.js      PartyKit room: 64 Hz authoritative loop, snapshots, bots fill-in, lag compensation
partykit.json    PartyKit project config (server entry, serves dist/)
src/
  main.js        menu wiring, settings (localStorage), main loop
  game.js        client: renderer, camera, input, event wiring, local or networked session
  sim.js         the simulation (no DOM): agents, bots, rounds, lag compensation; runs in browser or Node
  net.js         browser PartySocket client
  netcodec.js    wire format: snapshots, events, commands
  views.js       meshes for dropped weapons, grenades and the planted bomb
  config.js      movement constants, weapons, spray patterns, economy, bot difficulty
  agent.js       player/bot entity: movement, inventory, weapons, damage, hitboxes
  bot.js         bot AI (perception, aim, combat, objectives, buying, grenades)
  round.js       round flow, bomb, economy, win conditions
  combat.js      bullets, penetration, knife, explosions
  physics.js     AABB character controller
  map/
    layout.js    map registry (buildLayout(id)), zones with optional floor bands
    maps/        dustline.js, nuke.js: the map definitions (geometry, spawns, sites, AI routes)
    columns.js   column map: solid height spans per 1 m cell, so floors can stack
    world.js     merged collision boxes, raycasts, batched meshes
    nav.js       multi-floor navigation graph for bots (A*, drop links, smoothing)
    decor.js     silos, pipes, signs, cooling towers, lamps
    materials.js surface materials (textures, impact colors)
  restaurant.js  Turkish Kebab decor
  viewmodel.js   first-person weapon + arms, rendered as a separate pass
  characters.js  third-person soldier models and animation
  models.js      procedural weapon models
  effects.js     particles, decals, tracers, light flashes
  grenades.js    grenade physics, HE / flash / smoke
  hud.js         DOM HUD, radar, scoreboard, buy menu, chat
  audio.js       WebAudio sound synthesis and speech
  dialect.js     East Slovak announcer and trash-talk lines
  textures.js    procedural textures with normal maps
```

Add `?test` to the URL (`http://localhost:5173/?test`) to skip the menu and pointer lock. This
mode exposes `window.game` for automated testing: `game.step(n)` advances n ticks, and
`game.input.setKey(...)` / `game.input.setButton(...)` inject input.
# csko
# csko
