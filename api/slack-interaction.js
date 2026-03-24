import kv from '../lib/kv.js';
import { WebClient } from '@slack/web-api';
import { pickRestaurant, setLastLocked, loadRestaurants, fetchDiscoveryPlace } from '../lib/restaurants.js';
import { buildStandardBlocks, buildDiscoveryBlocks, buildCaptainBlocks, extractCaptainFromMessageBlocks } from '../lib/slack-blocks.js';

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
  const kvClient = process.env.REDIS_URL ? kv : null;

  const action = payload?.actions?.[0];
  const actionId = action?.action_id;
  const channelId = payload?.channel?.id;
  const messageTs = payload?.message?.ts;
  const responseUrl = payload?.response_url;

  const respondOk = () => {
    res.status(200).send();
  };

  const messageBlocks = payload?.message?.blocks || [];
  const captainDisplay = extractCaptainFromMessageBlocks(messageBlocks);
  const prependCaptain = (blocks) =>
    captainDisplay ? [...buildCaptainBlocks(captainDisplay), ...blocks] : blocks;

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
      blocks: prependCaptain(blocks),
    });
    respondOk();
    return;
  }

  if (actionId === 'lunch_go_back') {
    const value = (action.value && JSON.parse(action.value)) || {};
    const blocks = buildStandardBlocks(
      {
        name: value.name,
        emoji: value.emoji || '🍽️',
        cuisine: value.cuisine || '',
        doordash_url: value.doordash_url || undefined,
      },
      { messageTs, isLocked: false }
    );
    await slack.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `Where should we eat lunch? ${value.name}`,
      blocks: prependCaptain(blocks),
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
      blocks: prependCaptain(blocks),
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
      if (place.place_id) {
        blocks.push({
          type: 'actions',
          block_id: 'lunch_discovery_locked_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '↩️ Go back', emoji: true },
              action_id: 'lunch_discovery_go_back',
              value: JSON.stringify(place),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '📍 View on Google Maps', emoji: true },
              action_id: 'lunch_discovery_maps',
              url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
            },
          ],
        });
      } else {
        blocks.push({
          type: 'actions',
          block_id: 'lunch_discovery_locked_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '↩️ Go back', emoji: true },
              action_id: 'lunch_discovery_go_back',
              value: JSON.stringify(place),
            },
          ],
        });
      }
      await slack.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Lunch locked in: ${place.name}`,
        blocks: prependCaptain(blocks),
      });
    }
    respondOk();
    return;
  }

  if (actionId === 'lunch_discovery_go_back') {
    const place = action.value && JSON.parse(action.value);
    if (place?.name) {
      const blocks = buildDiscoveryBlocks(place, { messageTs });
      await slack.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `Discovery: ${place.name} — ${place.cuisine}`,
        blocks: prependCaptain(blocks),
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
      blocks: prependCaptain(blocks),
    });
    respondOk();
    return;
  }

  if (actionId === 'lunch_discovery_shuffle') {
    const shuffleValue = (action.value && JSON.parse(action.value)) || {};
    const excludePlaceId = shuffleValue.current_place_id || undefined;
    const excludeName = shuffleValue.current_name || undefined;

    const timeoutMs = 2800;
    const lat = parseFloat(process.env.DISCOVERY_LAT);
    const lng = parseFloat(process.env.DISCOVERY_LNG);
    const fetchWithTimeout = (opts = {}) =>
      Promise.race([
        fetchDiscoveryPlace({ lat, lng }, opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);

    let blocks;
    try {
      if (process.env.GOOGLE_PLACES_API_KEY && Number.isFinite(lat) && Number.isFinite(lng)) {
        let discoveryPlace = await fetchWithTimeout({
          excludePlaceId: excludePlaceId || undefined,
          excludeName: excludeName || undefined,
        });
        if (!discoveryPlace) {
          discoveryPlace = await fetchWithTimeout({});
        }
        if (discoveryPlace) {
          blocks = buildDiscoveryBlocks(discoveryPlace, { messageTs });
          await slack.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `Discovery: ${discoveryPlace.name} — ${discoveryPlace.cuisine}`,
            blocks: prependCaptain(blocks),
          });
          respondOk();
          return;
        }
      }
    } catch (_) {}
    const restaurant = await pickRestaurant(kvClient);
    blocks = buildStandardBlocks(restaurant, { messageTs });
    await slack.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `Back to the list: ${restaurant.name}`,
      blocks: prependCaptain(blocks),
    });
    respondOk();
    return;
  }

  respondOk();
}
