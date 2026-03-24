import kv from '../lib/kv.js';
import { WebClient } from '@slack/web-api';
import { postLunchSuggestion } from '../lib/post-lunch-suggestion.js';

// Lunch window: 11:30–12:59 ET. Cron runs once at 16:30 UTC on Tue/Thu (11:30 ET winter, 12:30 ET summer).
function isLunchTimeET() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  const dayName = (parts.weekday || '').toLowerCase();
  const hour = parseInt(parts.hour || '0', 10);
  const minute = parseInt(parts.minute || '0', 10);
  if (dayName !== 'tue' && dayName !== 'thu') return false;
  if (hour === 11 && minute >= 30) return true;
  if (hour === 12) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    const ua = req.headers['user-agent'] || '';
    if (!ua.includes('vercel-cron')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const manualTrigger = req.query?.test === '1';
  if (!manualTrigger && !isLunchTimeET()) {
    res.status(200).json({ ok: true, skipped: true, reason: 'not_lunch_time_et' });
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  if (!token || !channel) {
    res.status(500).json({ error: 'Missing SLACK_BOT_TOKEN or SLACK_CHANNEL' });
    return;
  }

  const kvClient = process.env.REDIS_URL ? kv : null;

  const slack = new WebClient(token);
  const forceDiscovery = manualTrigger && req.query?.discovery === '1';

  const result = await postLunchSuggestion({
    slack,
    channel,
    kvClient,
    options: {
      forceDiscovery,
      ...(manualTrigger ? { captainDisplay: '<@U07932S1ZK5>' } : {}),
    },
  });

  res.status(200).json({
    ok: true,
    ts: result.ts,
    channel: result.channel,
  });
}
