# The Magic Lens

The Magic Lens is a dual-mode scavenger hunt game for ages 3-5:
- `object` challenges use COCO-SSD (`Find a Chair!`)
- `color` challenges use center-frame pixel analysis (`Find something Yellow!`)

When a challenge is found, the app unlocks an animal sticker and stores progress in Cloudflare D1.

## Stack

- Frontend: React + Vite + Tailwind + `react-webcam`
- Browser AI: `@tensorflow-models/coco-ssd` + `@tensorflow/tfjs`
- Backend API: Cloudflare Workers
- Database: Cloudflare D1

## Project Files

- `schema.sql`: D1 schema (`challenges`, `progress`)
- `seed.sql`: starter content for challenges
- `worker/index.js`: Worker API (`/api/challenge`, `/api/found`, `/api/progress`)
- `src/components/CameraContainer.jsx`: camera, object/color detection, reward flow
- `src/components/StickerBook.jsx`: unlocked sticker gallery
- `src/App.jsx`: app shell, user identity, progress wiring
- `wrangler.toml`: Worker + D1 config

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create D1 database (first time only):

```bash
npx wrangler d1 create magic-lens-d1
```

3. Put the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "magic-lens-d1"
database_id = "PASTE_REAL_ID_HERE"
```

4. Apply schema and seed:

```bash
npx wrangler d1 execute magic-lens-d1 --file=./schema.sql --local
npx wrangler d1 execute magic-lens-d1 --file=./seed.sql --local
```

5. Start the Worker API:

```bash
npx wrangler dev
```

6. In a second terminal, set frontend API base and run Vite:

```bash
# PowerShell
$env:VITE_API_BASE_URL="http://127.0.0.1:8787"
npm run dev
```

Open the Vite URL (`http://localhost:5173` by default).

## Deploy

1. Build frontend:

```bash
npm run build
```

2. Deploy Worker API:

```bash
npx wrangler deploy
```

3. Deploy static frontend to Pages:

```bash
npx wrangler pages deploy dist --project-name magic-lens
```

4. Set `VITE_API_BASE_URL` in your Pages environment to your deployed Worker URL.

## Gameplay Logic

- Object detection: challenge succeeds when a detection class matches `target_value` with confidence `> 0.60`.
- Color detection: app samples center `50x50` pixels, averages RGB, converts to HSL, and checks against wide tolerance bands per color.
- Progress unlock: `POST /api/found` upserts `progress` (`is_unlocked = 1`).

## Notes

- Camera uses `facingMode: environment` where supported (best for phones/tablets).
- Provide your own assets for better kid-safe stickers/audio in production.
- `public/audio/success.mp3` is expected by the current reward flow.
