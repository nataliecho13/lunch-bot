import kv from '../lib/kv.js';
import { WebClient } from '@slack/web-api';
import {
  hasPreCronManualTodayET,
  hasCronLunchPostedTodayET,
  markCronLunchPostedTodayET,
} from '../lib/restaurants.js';
import { postLunchSuggestion } from '../lib/post-lunch-suggestion.js';

// Two UTC crons (`30 14` and `30 15` Tue/Thu) target ~10:30 AM America/New_York; Vercel can run late.
// Wide ET window (10:00–12:59) so delayed jobs still post. Redis `hasCronLunchPostedTodayET` prevents
// the second UTC slot from double-posting the same day.
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
  const t = hour * 60 + minute;
  return t >= 10 * 60 && t <= 12 * 60 + 59;
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

  if (!manualTrigger && (await hasPreCronManualTodayET(kvClient))) {
    res.status(200).json({ ok: true, skipped: true, reason: 'precron_manual_today_et' });
    return;
  }

  if (!manualTrigger && (await hasCronLunchPostedTodayET(kvClient))) {
    res.status(200).json({ ok: true, skipped: true, reason: 'cron_lunch_already_posted_today_et' });
    return;
  }

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

  if (!manualTrigger) {
    await markCronLunchPostedTodayET(kvClient);
  }

  res.status(200).json({
    ok: true,
    ts: result.ts,
    channel: result.channel,
  });
}
