# Labyrinth

Ravensburger's Labyrinth for two to four players, in a browser. One person starts
a room, reads the four-letter code out, and everyone plays on their own screen.

Built with Bun, no runtime dependencies, deployable to Railway.

## The rules it implements

- **7×7 board.** 16 tiles are glued down — four corner homes plus twelve
  T-junctions, each carrying a treasure. 33 loose tiles fill the rest and one
  stays out as the spare, sitting on the table beside the board.
- **34 loose tiles:** 12 straights, 16 corners, 6 T-junctions. Twelve of them
  carry a treasure, so all 24 treasures are in play — the ones on loose tiles
  drift around the maze as you play.
- **The 24 treasure cards are dealt out**, face down, an equal stack each. You
  only ever see your own top card, and only you can see it. Everyone's claimed
  pile is face up, the way it is on the table.
- **Turn the spare tile.** On your turn you may rotate it to any of its four
  orientations before pushing — as often as you like, and everyone watches it
  turn on their own screen.
- **Then you must push.** Slide the spare in at one of the twelve arrows. The
  tile forced off the far side becomes the next spare. The arrow that would undo
  the previous push is greyed out — for the next player too, not just for you.
- **A push moves the whole table.** Every pawn standing on that row or column
  rides along with the tiles, and one carried off the far edge reappears on the
  tile just inserted.
- **Then walk,** as far as the open corridors allow, or stay put.
- **Reach the treasure on your card** and you claim it and turn the next one. One
  per turn.
- **Win** by emptying your stack and walking back to your own corner. First one
  home ends the game.

Rule coverage lives in [engine.test.ts](src/game/engine.test.ts) and
[rooms.test.ts](src/server/rooms.test.ts) — 57 tests, including a two-player race
played out to a real win.

```bash
bun test
```

## Rooms

The server owns the game. The browser sends intents over a websocket and renders
whatever comes back, so a stale or edited client can't invent a legal move: play
out of turn and you get "it is not your turn" and the board doesn't budge.

- **Codes are four characters** from an alphabet with no `I`, `O`, `0`, `1` or
  `L`, so they survive being read out over a phone.
- **Invite links** are `/j/CODE`. Opening one joins straight away if the browser
  already knows your name.
- **Refreshing doesn't cost you your seat.** The server hands out a seat token,
  the browser keeps it, and a reconnect re-takes the same pawn and the same
  cards. Locking your phone mid-game is fine.
- **Somebody who drops out** shows as greyed out at the table. If it's their turn
  and they're gone, anyone else can skip past them.
- **Leaving on purpose** is different from dropping out: a game can't continue a
  player short, so it puts everyone back in the lobby. The button says so.
- **Rooms live in memory only.** One is swept away half an hour after the last
  person disconnects, and there is nothing to back up.

Two to four players, one per corner. The host picks how many treasures each
player has to find — 1 to 12, capped by what 24 cards can cover (6 each with four
players). Fewer cards, shorter game.

## Playing

Keyboard, on the board screen:

| | |
|---|---|
| `R` | turn the spare tile clockwise |
| `Shift`+`R` | turn it anticlockwise |
| `Space` | stay put |

Clicking the spare tile turns it too. Your target wears a pulsing gold ring; the
squares you can walk to are lit blue.

### On a phone

The whole 7×7 board stays on screen — no pinching, no panning. Route planning
means reading the entire maze at once, and reading a treasure off a small tile is
never required: the target tile wears the ring, and the card beside the board
shows the same illustration.

Two things change on a small screen. The spare tile rests *on* the board's border
rather than out on the table, because a whole tile of margin is too expensive. And
the arrows get invisible padding that grows outward only, so they're tappable
without stealing taps from the first row of tiles.

Tested at 375×812, 844×390 and 1280×720.

## Deploying to Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo**.
   `railway.json` selects the Dockerfile; the health check is `/api/health`.

2. Generate a domain. That's it — no volume, no variables. `PORT` comes from
   Railway.

Websockets work over the generated domain without any extra configuration; the
client picks `wss://` whenever the page is served over https.

Two things worth knowing. Rooms are in memory, so **a redeploy ends every game in
progress** — deploy between games, not during one. And volumes aside, don't run
more than one replica: two instances don't share their rooms, so half your table
would end up in a different copy of the same room code.

## Running locally

```bash
bun install
bun run dev
```

Open http://localhost:3000 in two windows — the seat is remembered per browser
profile, so use a private window (or a second browser) for the second player.

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
    engine.ts      turn state machine for 2-4 players
    treasures.ts   the 24 treasures
  shared/
    protocol.ts    the wire format, imported by both sides
  server/
    index.ts       routes and the websocket
    rooms.ts       rooms, seats, and every permission check
  client/
    main.ts        screens, board rendering, turn flow
    net.ts         websocket with reconnect and seat resume
    art.ts         tile, pawn and card SVG
    icons.ts       24 hand-drawn treasure icons
    sfx.ts         synthesised sounds — no audio assets to ship
```

## A note on the artwork

All artwork here is original — tiles, treasures, pawns and cards are drawn as SVG
in the visual language of the printed board (parchment corridors, rough cobbles,
deep blue frame, gold corner triangles) but none of Ravensburger's illustrations
are reproduced. Labyrinth is their game; this is a homemade version wearing its
clothes.
