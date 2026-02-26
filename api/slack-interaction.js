import { kv } from '@vercel/kv';
import { WebClient } from '@slack/web-api';
import { pickRestaurant, setLastLocked, loadRestaurants } from '../lib/restaurants.js';
import { buildStandardBlocks } from '../lib/slack-blocks.js';

function parsePayload(body) {
  if (body == null) return {};
  if (typeof body === 'object' && typeof body.payload === 'string') {
    return JSON.parse(body.payload);
  }
  if (typeof body === 'string') {
    const decoded = decodeURIComponent(body);
    if (decoded.startsWith('payload=')) {
      return JSON.parse(decoded.slice(8));
    }
    return JSON.parse(decoded);
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  let payload;
  try {
    payload = parsePayload(req.body);
  } catch (e) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Missing SLACK_BOT_TOKEN' });
    return;
  }

  const slack = new WebClient(token);
  let kvClient = null;
  try {
    kvClient = kv;
  } catch (_) {}

  const action = payload?.actions?.[0];
  const actionId = action?.action_id;
  const channelId = payload?.channel?.id;
  const messageTs = payload?.message?.ts;
  const responseUrl = payload?.response_url;

  const respondOk = () => {
    res.status(200).send();
  };

  if (actionId === 'lunch_confirm') {
    const value = (action.value && JSON.parse(action.value)) || {};
    await setLastLocked(kvClient, value.name);
    const blocks = buildStandardBlocks(
      {
        name: value.name,
        emoji: value.emoji || '🍽️',
        cuisine: value.cuisine || '',
        doordash_url: value.doordash_url || undefined,
      },
      { messageTs, isLocked: true }
    );
    await slack.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `Lunch locked in: ${value.name}`,
      blocks,
    });
    respondOk();
    return;
  }

  if (actionId === 'lunch_shuffle') {
    const value = (action.value && JSON.parse(action.value)) || {};
    const excludeName = value.current_name || null;
    const list = loadRestaurants().filter((r) => r.name !== excludeName);
    const restaurant = list.length > 0
      ? list[Math.floor(Math.random() * list.length)]
      : await pickRestaurant(kvClient);
    const blocks = buildStandardBlocks(restaurant, { messageTs });
    await slack.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `New suggestion: ${restaurant.name}`,
      blocks,
    });
    respondOk();
    return;
  }

  if (actionId === 'lunch_discovery_confirm') {
    const place = action.value && JSON.parse(action.value);
    if (place?.name) {
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: "*Today's lunch (locked in)*" } },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🆕 *${place.name}* — ${place.cuisine}${place.rating != null ? ` ★ ${place.rating}` : ''}${place.distance ? ` · ${place.distance}` : ''}`,
          },
        },
      ];
      await slack.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Lunch locked in: ${place.name}`,
        blocks,
      });
    }
    respondOk();
    return;
  }

  if (actionId === 'lunch_discovery_familiar') {
    const restaurant = await pickRestaurant(kvClient);
    const blocks = buildStandardBlocks(restaurant, { messageTs });
    await slack.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `Back to the list: ${restaurant.name}`,
      blocks,
    });
    respondOk();
    return;
  }

  respondOk();
}
