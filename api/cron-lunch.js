import { kv } from '@vercel/kv';
import { WebClient } from '@slack/web-api';
import { loadRestaurants, pickRestaurant, fetchDiscoveryPlace, getNextCaptain } from '../lib/restaurants.js';
import { buildStandardBlocks, buildDiscoveryBlocks, buildCaptainBlocks } from '../lib/slack-blocks.js';

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

  let kvClient = null;
  try {
    kvClient = kv;
  } catch (_) {}

  const slack = new WebClient(token);
  let blocks;
  let isDiscovery = false;
  let discoveryPlace = null;

  const forceDiscovery = manualTrigger && req.query?.discovery === '1';
  const tryDiscovery = forceDiscovery || Math.random() < 0.2;

  if (tryDiscovery) {
    const lat = parseFloat(process.env.DISCOVERY_LAT);
    const lng = parseFloat(process.env.DISCOVERY_LNG);
    if (process.env.GOOGLE_PLACES_API_KEY && Number.isFinite(lat) && Number.isFinite(lng)) {
      discoveryPlace = await fetchDiscoveryPlace({ lat, lng });
      if (discoveryPlace) {
        isDiscovery = true;
        blocks = buildDiscoveryBlocks(discoveryPlace);
      }
    }
  }

  if (!blocks) {
    const restaurant = await pickRestaurant(kvClient);
    blocks = buildStandardBlocks(restaurant);
  }

  let captain;
  if (manualTrigger) {
    captain = { captainDisplay: '<@U07932S1ZK5>' };
  } else {
    captain = await getNextCaptain(kvClient);
  }
  if (captain) {
    blocks = [...buildCaptainBlocks(captain.captainDisplay), ...blocks];
  }

  const result = await slack.chat.postMessage({
    channel,
    text: isDiscovery
      ? `Discovery: ${discoveryPlace.name} — ${discoveryPlace.cuisine}`
      : `Lunch suggestion: ${blocks[1].text.text.replace(/\*/g, '')}`,
    blocks,
  });

  res.status(200).json({
    ok: true,
    ts: result.ts,
    channel: result.channel,
    discovery: isDiscovery,
  });
}
