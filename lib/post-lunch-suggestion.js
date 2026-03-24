import { pickRestaurant, fetchDiscoveryPlace, getNextCaptain } from './restaurants.js';
import { buildStandardBlocks, buildDiscoveryBlocks, buildCaptainBlocks } from './slack-blocks.js';

/**
 * Build and post a lunch suggestion (same behavior as the scheduled cron).
 *
 * @param {Object} params
 * @param {import('@slack/web-api').WebClient} params.slack
 * @param {string} params.channel - Slack channel ID
 * @param {import('./kv.js').default|null} params.kvClient
 * @param {{
 *   forceDiscovery?: boolean,
 *   captainDisplay?: string | null,
 *   useRotationCaptain?: boolean,
 *   threadTs?: string,
 * }} [params.options]
 */
export async function postLunchSuggestion({ slack, channel, kvClient, options = {} }) {
  const {
    forceDiscovery = false,
    captainDisplay: captainDisplayOpt = undefined,
    useRotationCaptain = true,
    threadTs,
  } = options;

  let blocks;
  let isDiscovery = false;
  let discoveryPlace = null;
  let restaurant = null;

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
    restaurant = await pickRestaurant(kvClient);
    blocks = buildStandardBlocks(restaurant);
  }

  let captain;
  if (captainDisplayOpt !== undefined && captainDisplayOpt !== null) {
    captain = { captainDisplay: captainDisplayOpt };
  } else if (useRotationCaptain) {
    captain = await getNextCaptain(kvClient);
  }
  if (captain) {
    blocks = [...buildCaptainBlocks(captain.captainDisplay), ...blocks];
  }

  const text = isDiscovery
    ? `Discovery: ${discoveryPlace.name} — ${discoveryPlace.cuisine}`
    : `Lunch suggestion: ${restaurant.name} — ${restaurant.cuisine}`;

  return slack.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    blocks,
  });
}
