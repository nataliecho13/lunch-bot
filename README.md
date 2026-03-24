# Slack Lunch Bot

Posts a lunch suggestion to a Slack channel every **Tuesday and Thursday** at **10:30 AM Eastern** (`America/New_York`). Vercel cron is UTC-only, so the project uses **two** schedules — **14:30 UTC** and **15:30 UTC** — and the handler only posts when local time is **~10:30** (covers EST/EDT without drifting to 11:30 in summer). Each message includes **Let's do it**, **Shuffle**, and optional **View on DoorDash**; optionally **discovery mode** (Google Places, 1 in 5).

## Features

- **Schedule**: Tue & Thu — target **~10:30 AM Eastern** via two Vercel crons (`30 14` & `30 15` UTC); the handler accepts **10:00–12:59 ET** so late runs still deliver, and Redis limits you to **one** cron post per Eastern calendar day.
- **Config**: Edit `config/restaurants.yaml` — name, emoji, cuisine, optional DoorDash URL
- **No repeat**: Same restaurant won’t be picked two weeks in a row (uses Redis)
- **Buttons**: ✅ Let's do it (locks in), 🔀 Shuffle (new pick), 🛵 View on DoorDash (if URL set)
- **Discovery mode**: 1 in 5 chance suggests a new nearby restaurant (Google Places). Buttons: *Let's try it* / *Give me something familiar*. Falls back to standard pick if Places API is unavailable.
- **Pre-cron skip (Tue/Thu, ET)**: If someone @mentions the bot in `SLACK_CHANNEL` between **9:30 and 10:29 AM Eastern** (the hour before the 10:30 cron), that day’s **scheduled cron is skipped**. Later @mentions the same day still work (e.g. dinner). Cron test URL `?test=1` ignores the flag and does not set it.

## For your team

How to use **manual @mentions** vs waiting for the **scheduled** post.

### Tuesdays & Thursdays

**Scheduled lunch ping** — Around **10:30 AM Eastern**, the bot posts a lunch suggestion in the office channel. The exact minute can shift a bit (scheduling runs in UTC, and the platform can run a few minutes late). You get **at most one** automatic post that day.

**Manual @mention** — Anyone can **@mention** the bot in a channel it’s in. It replies in the thread with a suggestion and treats **whoever @mentioned it** as that round’s **Lunch Captain** (the normal rotating captain only applies to the **scheduled** post).

### Starting lunch early (same morning)

On Tue/Thu, if someone **@mentions the bot in the main lunch channel** (the one configured as `SLACK_CHANNEL`) **between 9:30 and 10:29 AM Eastern**, we treat that as “we’re already ordering,” and the **scheduled ~10:30 post is skipped** that day so you don’t get two lunch blasts.

### Later the same day (e.g. dinner)

That’s fine. **Later @mentions are not blocked** by the morning logic—you can still @mention the bot for another round (e.g. staying for dinner) even if lunch already ran on the schedule or someone used it manually earlier.

### Quick reference

| Situation | What happens |
|-----------|----------------|
| Do nothing | Tue/Thu ~10:30 AM ET → one automatic suggestion in the office channel. |
| @mention **9:30–10:29 AM** in the **office lunch channel** | Suggestion posts; **scheduled** morning post is **skipped** that day. |
| @mention **after ~10:30 AM** or in **another channel** | Suggestion posts; **does not** cancel the scheduled post unless you’re in the early window + lunch channel (see above). |
| Need a second run same day (e.g. dinner) | @mention again later—it should work. |

**Note:** Reliable behavior depends on **Redis** (`REDIS_URL`) and **`SLACK_CHANNEL` set to the channel ID** for the office channel so “early mention = skip cron” works.

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
| `SLACK_SIGNING_SECRET` | If @mentions | Signing secret from **Basic Information**; set when you enable Event Subscriptions (step 6 below) |
| `SLACK_CHANNEL` | Yes | Channel ID (e.g. `C01234ABCD`) is recommended: cron posts here, and the pre-cron skip flag is only set for @mentions in this channel. Names like `#lunch` work for posting but won’t match Events API channel ids for that flag. |
| `CRON_SECRET` | No | If set, cron endpoint expects `Authorization: Bearer <CRON_SECRET>` (Vercel cron still works without it) |
| `REDIS_URL` | Yes* | Redis connection URL (from Vercel Redis / your Redis provider; for “no repeat” and lunch captain rotation) |
| `GOOGLE_PLACES_API_KEY` | No | For discovery mode (nearby restaurant suggestions) |
| `DISCOVERY_LAT` | No | Latitude for discovery search (e.g. office) |
| `DISCOVERY_LNG` | No | Longitude for discovery search |

\* Without Redis, the bot still runs; it just won’t enforce “no repeat two weeks in a row”, captain rotation, **pre-cron skip**, or **same-day cron dedup** (with two UTC schedules and a wide lunch window, you could get two automatic posts on Tue/Thu). Add a Redis store (e.g. [Vercel Redis](https://vercel.com/docs/storage/vercel-redis)); the integration sets `REDIS_URL` for your project.

### 3. Slack app setup

1. [Create a Slack app](https://api.slack.com/apps) (or use an existing one).
2. **OAuth & Permissions** → Bot Token Scopes: `chat:write`, `chat:write.public`.
3. Install the app to your workspace and copy the **Bot User OAuth Token** → `SLACK_BOT_TOKEN`.
4. **Interactivity & Shortcuts** → Turn **Interactivity** On → set **Request URL** to:
   - `https://<your-vercel-domain>/api/slack-interaction`
   (Use your real Vercel URL after deploy; Slack requires HTTPS.)
5. Invite the bot to the channel you use for `SLACK_CHANNEL` (e.g. `/invite @YourBot` in that channel).
6. **Optional — trigger by @mention:** **Event Subscriptions** → turn **On** → set **Request URL** to `https://<your-vercel-domain>/api/slack-events`. Under **Subscribe to bot events**, add **`app_mention`**. Slack will prompt for any missing scopes; reinstall the app if asked. Copy **Signing Secret** from **Basic Information** → `SLACK_SIGNING_SECRET` in Vercel. When someone mentions the bot (e.g. `@tahini`) in a channel it’s in, it posts that day’s suggestion as a **reply in the thread** and sets the **mentioner** as Lunch Captain. (Scheduled Tue/Thu cron is unchanged.)

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
4. (Optional) Add a Redis store (e.g. [Vercel Redis](https://vercel.com/docs/storage/vercel-redis)) and connect it to your project; the integration sets `REDIS_URL`.
5. Deploy. Cron runs only on **production** deployments.

Your app URL will be:

- **`https://<your-project>.vercel.app`**

Set Slack’s Interactivity Request URL to:

- **`https://<your-project>.vercel.app/api/slack-interaction`**

If you use Event Subscriptions for @mentions, set the Events **Request URL** to:

- **`https://<your-project>.vercel.app/api/slack-events`**

### 6. Manual test (optional)

To trigger a post without waiting for the cron:

```bash
curl -X GET "https://<your-project>.vercel.app/api/cron-lunch" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

(If you didn’t set `CRON_SECRET`, you can call the URL without the header; the handler still checks for the cron user-agent on Vercel.)

## Project layout

- **`api/cron-lunch.js`** — Cron handler: invoked 14:30 & 15:30 UTC Tue/Thu; posts when ET is **10:00–12:59** (allows Vercel delay); Redis ensures **one** cron post per ET day.
- **`api/slack-events.js`** — Slack Events API: `app_mention` posts a suggestion (reply in thread; mentioner as captain).
- **`api/slack-interaction.js`** — Handles button clicks (Let's do it, Shuffle, DoorDash, discovery buttons).
- **`lib/post-lunch-suggestion.js`** — Shared logic to build and post a lunch message (cron + mentions).
- **`config/restaurants.yaml`** — Your restaurant list (edit here).
- **`lib/restaurants.js`** — Load config, pick with no-repeat, Google Places discovery.
- **`lib/slack-blocks.js`** — Builds Slack Block Kit for the message and buttons.
- **`vercel.json`** — Cron schedules: `30 14 * * 2,4` and `30 15 * * 2,4` (Tue & Thu; together target 10:30 AM Eastern).

## Public URL after deploy

After deployment, your public URL is:

**`https://<your-project-name>.vercel.app`**

Use that base URL for the Slack Interactivity Request URL:  
**`https://<your-project-name>.vercel.app/api/slack-interaction`**
