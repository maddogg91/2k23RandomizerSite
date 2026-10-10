# 2K27 Player Randomizer

A fan-made randomizer modeled on the standard **Create Player** editor in NBA 2K27 (the roster editor used for MyLEAGUE and Play Now, not the MyCareer MyPLAYER builder). Roll a player right away, or sign up to save them. For each part you choose whether it's randomized or set by hand:

- **Physicals**: position, secondary position, height, weight, and wingspan. Each one is either random or locked. Random values are realistic for the position. As in the editor, any locked combination is allowed: height 5'3"–7'7", weight 150–350 lbs, wingspan 5'0"–8'4".
- **Attributes**: all 37 roster ratings across Inside Scoring, Outside Scoring, Athleticism, Playmaking, Defense, Rebounding, and Intangibles/Potential, with no height-based caps. You pick two things:
  - **Style**: *Realistic* (shaped by position, body type, and a random talent level) or *Chaos* (every rating rolled independently).
  - **Level**: the range every rating is rolled in. *Rookie* 65–99, *Pro* 55–99, *All-Pro* 45–99, *Hall of Fame* 35–99, *Legend* 25–99 (the editor's full range).
- **Badges**: 40 badges, Bronze through Legend, each with its own colored emblem.
  - *Realistic*: more likely, and higher tier, when the related ratings are high, so easier levels earn more badges.
  - *Chaos*: any badge, any tier.
  - *None*.

No account is needed to start. Guests can create, view, and re-roll up to 5 players, which are kept only in their browser session and never written to the database. When a guest signs up or logs in, those players are saved to their Locker Room.

Every player gets a card page with OVR, a play-style label, rating bars, and badges. Each section can be re-rolled. Re-rolling physicals keeps any fields you locked, and re-rolls use the style and level the player was created with.

Sound effects (dribbles, net swish, sneaker squeaks, buzzer, crowd cheer, badge chimes) are synthesized in the browser with the Web Audio API in `public/js/fx.js`, so there are no audio files to host. The speaker button in the nav mutes them, and the setting is remembered. Animations turn off for visitors with "reduce motion" enabled.

## Running

```bash
npm install
npm run dev      # or: npm start
npm test
```

The app runs on http://localhost:7700. Without `MONGODB_URI`, data goes to `.data/db.json`. It requires Node 20.19 or newer.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Session signing secret. **Required** when `NODE_ENV=production`. |
| `MONGODB_URI` | Use MongoDB instead of the local JSON file. |
| `MONGODB_CERT` | Path to an X.509 `.pem` for `MONGODB-X509` auth (e.g. the old Atlas setup). |
| `MONGODB_DB` | Database name (default `nba`). |
| `DATA_FILE` | Path for the local JSON store (default `.data/db.json`). |
| `PORT` | Port (default `7700`). |

Accounts from the old 2K23 site still work. Their passwords are upgraded to bcrypt the next time they log in.

## Tuning the game data

All the 2K content lives in `data/`. You can edit it without touching code:

- `physicals.json`: positions with their typical heights and secondary options, editor limits, and the typical weight and wingspan used for random rolls.
- `attributes.json`: levels and their rating floors, rating categories and ratings; how height, weight, and wingspan nudge realistic rolls (`body: [height, weight, wingspan]`); position weights for OVR; and play-style names.
- `badges.json`: tiers, badges and their related ratings, and the realistic-mode tuning (equip chance and tier cutoffs).

*Not affiliated with or endorsed by the NBA or 2K.*
