# Slack Lunch Bot

Posts a lunch suggestion to a Slack channel every **Tuesday and Thursday at 11:30 AM ET**. Each message includes a random restaurant from your config, with **Let's do it**, **Shuffle**, and optional **View on DoorDash** buttons. Optionally, **discovery mode** suggests a nearby place from Google Places (1 in 5 chance).

## Features

- **Schedule**: Tue & Thu at 11:30 AM ET (cron runs at 15:30 and 16:30 UTC to cover ET)
- **Config**: Edit `config/restaurants.yaml` — name, emoji, cuisine, optional DoorDash URL
- **No repeat**: Same restaurant won’t be picked two weeks in a row (uses Vercel KV)
- **Buttons**: ✅ Let's do it (locks in), 🔀 Shuffle (new pick), 🛵 View on DoorDash (if URL set)
- **Discovery mode**: 1 in 5 chance suggests a new nearby restaurant (Google Places). Buttons: *Let's try it* / *Give me something familiar*. Falls back to standard pick if Places API is unavailable.

## Quick start

### 1. Clone and install

```bash
cd lunch-bot
npm install
```

### 2. Environment variables

Create a `.env` (or set in Vercel):

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot token (e.g. `xoxb-...`) from your Slack app |
| `SLACK_CHANNEL` | Yes | Channel to post in: ID (e.g. `C01234ABCD`) or name (e.g. `#lunch`) |
| `CRON_SECRET` | No | If set, cron endpoint expects `Authorization: Bearer <CRON_SECRET>` (Vercel cron still works without it) |
| `KV_REST_API_URL` | Yes* | Redis REST URL (e.g. from Vercel Redis/Upstash integration); was: Vercel KV REST URL (for “no repeat” and state) |
| `KV_REST_API_TOKEN` | Yes* | Redis REST token |
| `GOOGLE_PLACES_API_KEY` | No | For discovery mode (nearby restaurant suggestions) |
| `DISCOVERY_LAT` | No | Latitude for discovery search (e.g. office) |
| `DISCOVERY_LNG` | No | Longitude for discovery search |

\* Without Redis/KV, the bot still runs; it just won’t enforce “no repeat two weeks in a row.” Add a Redis store (e.g. [Upstash via Vercel Marketplace](https://vercel.com/marketplace?category=storage&search=redis)); the integration usually sets these env vars.

### 3. Slack app setup

1. [Create a Slack app](https://api.slack.com/apps) (or use an existing one).
2. **OAuth & Permissions** → Bot Token Scopes: `chat:write`, `chat:write.public`.
3. Install the app to your workspace and copy the **Bot User OAuth Token** → `SLACK_BOT_TOKEN`.
4. **Interactivity & Shortcuts** → Turn **Interactivity** On → set **Request URL** to:
   - `https://<your-vercel-domain>/api/slack-interaction`
   (Use your real Vercel URL after deploy; Slack requires HTTPS.)
5. Invite the bot to the channel you use for `SLACK_CHANNEL` (e.g. `/invite @YourBot` in that channel).

### 4. Edit restaurants

Edit **`config/restaurants.yaml`**:

```yaml
restaurants:
  - name: "Joe's Pizza"
    emoji: "🍕"
    cuisine: "Pizza"
    doordash_url: "https://www.doordash.com/store/joes-pizza/12345"

  - name: "Taco Loco"
    emoji: "🌮"
    cuisine: "Mexican"
    # doordash_url optional
```

### 5. Deploy to Vercel

1. Push the repo to GitHub (or connect another Git provider).
2. [Import the project in Vercel](https://vercel.com/new).
3. Add the environment variables above in **Project → Settings → Environment Variables**.
4. (Optional) Add a Redis store (e.g. [Upstash via Vercel Marketplace](https://vercel.com/marketplace?category=storage&search=redis)) and link it; the integration usually sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
5. Deploy. Cron runs only on **production** deployments.

Your app URL will be:

- **`https://<your-project>.vercel.app`**

Set Slack’s Interactivity Request URL to:

- **`https://<your-project>.vercel.app/api/slack-interaction`**

### 6. Manual test (optional)

To trigger a post without waiting for the cron:

```bash
curl -X GET "https://<your-project>.vercel.app/api/cron-lunch" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

(If you didn’t set `CRON_SECRET`, you can call the URL without the header; the handler still checks for the cron user-agent on Vercel.)

## Project layout

- **`api/cron-lunch.js`** — Cron handler: runs at 11:30 ET Tue/Thu, picks restaurant (or discovery), posts to Slack.
- **`api/slack-interaction.js`** — Handles button clicks (Let's do it, Shuffle, DoorDash, discovery buttons).
- **`config/restaurants.yaml`** — Your restaurant list (edit here).
- **`lib/restaurants.js`** — Load config, pick with no-repeat, Google Places discovery.
- **`lib/slack-blocks.js`** — Builds Slack Block Kit for the message and buttons.
- **`vercel.json`** — Cron schedule: `30 15,16 * * 2,4` (Tue & Thu at 15:30 and 16:30 UTC).

## Public URL after deploy

After deployment, your public URL is:

**`https://<your-project-name>.vercel.app`**

Use that base URL for the Slack Interactivity Request URL:  
**`https://<your-project-name>.vercel.app/api/slack-interaction`**
