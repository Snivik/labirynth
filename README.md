# Labyrinth — Birthday Edition

A single-player electronic Labyrinth. Each treasure on the board unlocks a
recorded birthday message. Collect them all, walk home, hear everyone.

Built with Bun, no runtime dependencies, deployable to Railway.

## The rules it implements

Faithful to the Ravensburger game, minus the other players:

- **7×7 board.** 16 tiles are glued down — four corner homes plus twelve
  T-junctions, each carrying a treasure. 33 loose tiles fill the rest and one
  stays out as the spare, sitting on the table beside the board.
- **34 loose tiles:** 12 straights, 16 corners, 6 T-junctions. Twelve of them
  carry a treasure, so all 24 treasures are in play — the ones on loose tiles
  drift around the maze as you play.
- **Every turn you must push.** Take the spare tile, slide it in at one of the
  twelve arrows. The tile forced off the far side becomes the next spare. The
  arrow that would undo the previous push is greyed out.
- **Then walk,** as far as the open corridors allow, or stay put. A pawn carried
  off the far edge reappears on the tile just inserted.
- **Reach the treasure on your card** and the message unlocks. One treasure per
  turn; then the next card turns over.
- **The opponent** holds no pawn and chases nothing. After each of your turns it
  shoves the spare tile in at a random legal arrow, purely to reshape the maze.
  It cannot win, so the game can't be lost.
- **Win** by collecting every treasure and returning to your own corner.

Rule coverage lives in [engine.test.ts](src/game/engine.test.ts) — 27 tests
including a 300-turn playthrough that has to end in a legitimate win.

```bash
bun test
```

## On a phone

The whole 7×7 board stays on screen — no pinching, no panning. Seven tiles at
~42px is 300px, which fits a 375px phone, and route planning needs the entire
maze visible at once. Reading a treasure off a small tile is never required
either: the target tile wears a pulsing gold ring, and the card beside the board
shows the same illustration.

Two things change on a small screen. The spare tile rests *on* the board's
border rather than out on the table, because a whole tile of margin is too
expensive — it always parks opposite the last push, which is exactly where the
blocked arrow is, so it only ever covers a control that is already disabled. And
the arrows get invisible padding that grows outward only, so they're properly
tappable without stealing taps from the first row of tiles.

Portrait puts the card beside the instructions under the board; landscape keeps
the desktop side-by-side arrangement. Tested at 375×812, 844×390 and 1500×940.

## Getting the recordings in

Everything happens at **`/admin`**, behind the `ADMIN_PASSWORD` you set.

1. Open `https://your-app.up.railway.app/admin`, enter the password.
2. For each message: type who recorded it, optionally how she knows them
   ("her sister"), pick the audio file, upload.
3. Optionally set her name — it appears on the title screen and the ending.

Accepts mp3, m4a (iPhone voice memos), wav, ogg, webm, opus, flac, up to 25 MB
each. Files are stored on the Railway volume, not in git.

### How many collectibles

**Leave the "Collectibles" field empty and the count follows the uploads** — one
treasure per recording, up to 24. Upload nine messages and it's a nine-treasure
game. This is the answer to "it depends who sends me something by EOD": just keep
uploading, no redeploy needed.

Set a number to cap it — 12 uploads with a cap of 6 makes a shorter game using
the first six. Recordings beyond the cap are marked inactive in the console.

With nothing uploaded the game runs in **demo mode**: six treasures that play a
placeholder chime, so you can try the whole thing before the recordings arrive.

Deleting a recording renumbers the rest, which reshuffles which treasure unlocks
whom. Any game in progress resets — do your deleting before the day.

## Deploying to Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo**.
   `railway.json` selects the Dockerfile; the health check is `/api/health`.

2. Add a **volume** — without it the recordings vanish on every redeploy.
   Create it from the project canvas (`⌘K` → *Create Volume*, or right-click the
   canvas), attach it to this service, and set:

   | | |
   |---|---|
   | Mount path | `/data` |

   It must be that exact absolute path, because the Dockerfile sets
   `DATA_DIR=/data`. Mount it anywhere else and the app keeps writing to the
   container's throwaway layer.

   Then open `/admin` — the banner at the top says in plain words whether the
   recordings are safe. See [Is the storage actually persistent?](#is-the-storage-actually-persistent)
   below.

3. Set the variables:

   | Variable | Value |
   |---|---|
   | `ADMIN_PASSWORD` | whatever you like — `/admin` stays locked until this is set |
   | `DATA_DIR` | `/data` (already the Dockerfile default) |
   | `SESSION_SECRET` | optional; any random string, invalidates admin cookies when changed |

   `PORT` is provided by Railway.

4. Generate a domain, upload the recordings at `/admin`, and send her the root
   URL.

### Is the storage actually persistent?

Don't guess at this — you only find out you were wrong after the files are gone.
The banner at the top of `/admin` tells you which of four states you're in:

| Banner | Meaning |
|---|---|
| **Persistent storage confirmed** (green) | The volume has outlived at least one restart with recordings still on it. Proven, not assumed. |
| **Volume attached, not yet proven** (amber) | `/data` is a real mount point. Upload something, redeploy once, and the banner turns green. |
| **No volume attached** (red) | `/data` is the container's temporary disk. Anything uploaded dies with the next deploy. |
| **Cannot detect the volume** (amber) | Expected when running locally — mount detection reads `/proc`, which only exists on Linux. |

It works by checking `/proc/self/mountinfo` to see whether `DATA_DIR` is its own
mount point, and by keeping a `firstSeen` timestamp and a boot counter in the
manifest. If the disk were ephemeral, `firstSeen` would reset on every deploy and
the counter would never climb — so a high boot count with an old `firstSeen` is
proof the data survived. The server logs the same verdict at startup.

**To prove it end to end:** upload one recording, redeploy from the Railway
dashboard, then reload `/admin`. Green banner and the recording still listed means
you're safe.

Railway specifics worth knowing: one volume per service, absolute mount paths
only, and volumes are incompatible with multiple replicas. Volumes are mounted at
container start rather than build time, so nothing baked into the image at `/data`
would survive anyway. Size caps are 0.5 GB on Trial, 5 GB on Hobby — voice
messages are a rounding error against either. Redeploying a service with a volume
causes a few seconds of downtime, because Railway won't let two deployments mount
the same volume at once.

## Running locally

```bash
bun install
ADMIN_PASSWORD=letmein bun run dev
```

Game on http://localhost:3000, console on http://localhost:3000/admin.
Recordings land in `./data`, which is gitignored.

```bash
bun test           # rule tests
bun run typecheck  # tsc --noEmit
```

## Layout

```
src/
  game/          rules — no DOM, no server, runs in both
    tiles.ts       tile shapes, rotation, openings
    board.ts       fixed layout, arrows, shifting, path finding
    engine.ts      turn state machine
    treasures.ts   the 24 treasures
  server/
    index.ts       routes
    store.ts       manifest + audio files on disk
    auth.ts        password gate for /admin
  client/
    main.ts        board rendering and turn flow
    art.ts         tile, pawn and card SVG
    icons.ts       24 hand-drawn treasure icons
    sfx.ts         synthesised sounds — no audio assets to ship
```

The game engine runs in the browser and saves to `localStorage`, so a refresh or
a closed laptop resumes where she left off. The server only serves files.

## A note on the artwork

All artwork here is original — tiles, treasures, pawns and cards are drawn as SVG
in the visual language of the printed board (parchment corridors, rough cobbles,
deep blue frame, gold corner triangles) but none of Ravensburger's illustrations
are reproduced. Labyrinth is their game; this is a homemade birthday card wearing
its clothes.
