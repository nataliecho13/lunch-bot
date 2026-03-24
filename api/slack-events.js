import crypto from 'crypto';
import kv from '../lib/kv.js';
import { WebClient } from '@slack/web-api';
import { postLunchSuggestion } from '../lib/post-lunch-suggestion.js';

function verifySlackSignature(signingSecret, signature, timestamp, rawBody) {
  if (!signingSecret || typeof signature !== 'string' || typeof timestamp !== 'string') {
    return false;
  }
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return false;
  }
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
  const expected = `v0=${hmac}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Vercel Node may pass a parsed JSON object; Slack’s signature needs the same bytes it sent. */
async function getRawBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'object') return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return '';
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    res.status(401).send('Unauthorized');
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Bad Request' });
    return;
  }

  if (body.type === 'url_verification') {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  if (body.type === 'event_callback') {
    const event = body.event;
    const isAppMention =
      event?.type === 'app_mention' && !event.bot_id && event.subtype !== 'bot_message';

    if (isAppMention && event.user) {
      const token = process.env.SLACK_BOT_TOKEN;
      if (token) {
        const slack = new WebClient(token);
        const kvClient = process.env.REDIS_URL ? kv : null;
        const channel = event.channel;
        const threadTs = event.thread_ts || event.ts;
        const captainDisplay = `<@${event.user}>`;

        try {
          await postLunchSuggestion({
            slack,
            channel,
            kvClient,
            options: { captainDisplay, threadTs },
          });
        } catch (e) {
          console.error('slack app_mention lunch post failed', e);
        }
      }
    }

    res.status(200).end();
    return;
  }

  res.status(200).end();
}
