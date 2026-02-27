/**
 * Build Slack Block Kit for lunch suggestion (standard or discovery).
 */

/**
 * Parse the captain display string from an existing message's blocks (e.g. from interaction payload).
 * @param {Array<{ type?: string, text?: { type?: string, text?: string } }>} blocks
 * @returns {string|null} captainDisplay (e.g. "<@U01234>") or null
 */
export function extractCaptainFromMessageBlocks(blocks) {
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    const text = block?.text?.text;
    if (typeof text !== 'string' || !text.includes("Lunch Captain")) continue;
    const match = text.match(/Lunch Captain:\s*(.+?)(?=\n|$)/);
    if (match) {
      const raw = match[1].trim();
      const cleaned = raw.replace(/^\s*\*+\s*|\s*\*+\s*$/g, '').trim();
      return cleaned || raw;
    }
  }
  return null;
}

/**
 * @param {string} captainDisplay - mrkdwn string for captain (e.g. "<@U01234>" or "@natalie")
 * @returns {Array<{ type: string, text: { type: string, text: string } }>}
 */
export function buildCaptainBlocks(captainDisplay) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: '🍜 *Time to order lunch!*' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👑 *Today\'s Lunch Captain:* ${captainDisplay}\nYou have the final say — everyone else can shuffle suggestions`,
      },
    },
  ];
}

/**
 * @param {{ name: string, emoji: string, cuisine: string, doordash_url?: string }} restaurant
 * @param {{ messageTs?: string, isLocked?: boolean }} options
 */
export function buildStandardBlocks(restaurant, options = {}) {
  const { messageTs, isLocked = false } = options;
  const header = isLocked ? "Today's lunch (locked in)" : "Where should we eat lunch?";
  const headerText = isLocked ? `*${header}*` : `*${header}* <!channel>`;
  const text = `${restaurant.emoji} *${restaurant.name}* — ${restaurant.cuisine}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: headerText } },
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', block_id: `lunch_actions_${messageTs || 'new'}` },
  ];

  if (isLocked) {
    const instruction = restaurant.doordash_url
      ? 'Get the group order link from DoorDash (button below) and paste it in the thread so everyone can add their orders.'
      : 'Share the order link in the thread when ready so everyone can add their orders.';
    blocks.splice(2, 0, { type: 'section', text: { type: 'mrkdwn', text: instruction } });
  }

  const actions = blocks[isLocked ? 3 : 2];
  if (!isLocked) {
    actions.elements = [
      {
        type: 'button',
        text: { type: 'plain_text', text: "✅ Let's do it", emoji: true },
        action_id: 'lunch_confirm',
        value: JSON.stringify({ name: restaurant.name, emoji: restaurant.emoji, cuisine: restaurant.cuisine, doordash_url: restaurant.doordash_url || '' }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🔀 Shuffle', emoji: true },
        action_id: 'lunch_shuffle',
        value: JSON.stringify({ current_name: restaurant.name }),
      },
    ];
    if (restaurant.doordash_url) {
      actions.elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🛵 View on DoorDash', emoji: true },
        action_id: 'lunch_doordash',
        url: restaurant.doordash_url,
      });
    }
  } else {
    actions.elements = [
      {
        type: 'button',
        text: { type: 'plain_text', text: '↩️ Go back', emoji: true },
        action_id: 'lunch_go_back',
        value: JSON.stringify({ name: restaurant.name, emoji: restaurant.emoji, cuisine: restaurant.cuisine, doordash_url: restaurant.doordash_url || '' }),
      },
    ];
    if (restaurant.doordash_url) {
      actions.elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🛵 View on DoorDash', emoji: true },
        action_id: 'lunch_doordash',
        url: restaurant.doordash_url,
      });
    }
  }

  return blocks;
}

/**
 * Discovery suggestion blocks.
 * @param {{ name: string, cuisine: string, rating?: number, distance?: string, place_id?: string }} place
 * @param {{ messageTs?: string }}
 */
export function buildDiscoveryBlocks(place, options = {}) {
  const { messageTs } = options;
  const ratingStr = place.rating != null ? ` ★ ${place.rating}` : '';
  const distStr = place.distance ? ` · ${place.distance}` : '';
  const text = `*${place.name}* — ${place.cuisine}${ratingStr}${distStr}`;

  const elements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: "Let's try it", emoji: true },
      action_id: 'lunch_discovery_confirm',
      value: JSON.stringify(place),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '🔀 Shuffle', emoji: true },
      action_id: 'lunch_discovery_shuffle',
      value: JSON.stringify({ current_place_id: place.place_id || '', current_name: place.name || '' }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Give me something familiar', emoji: true },
      action_id: 'lunch_discovery_familiar',
      value: JSON.stringify({}),
    },
  ];
  if (place.place_id) {
    elements.unshift({
      type: 'button',
      text: { type: 'plain_text', text: '📍 View on Google Maps', emoji: true },
      action_id: 'lunch_discovery_maps',
      url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    });
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: "*Discovery mode* — New nearby spot" } },
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      block_id: `lunch_discovery_${messageTs || 'new'}`,
      elements,
    },
  ];
  return blocks;
}
