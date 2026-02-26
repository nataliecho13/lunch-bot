/**
 * Build Slack Block Kit for lunch suggestion (standard or discovery).
 */

/**
 * @param {{ name: string, emoji: string, cuisine: string, doordash_url?: string }} restaurant
 * @param {{ messageTs?: string, isLocked?: boolean }} options
 */
export function buildStandardBlocks(restaurant, options = {}) {
  const { messageTs, isLocked = false } = options;
  const header = isLocked ? "Today's lunch (locked in)" : "Where should we eat lunch?";
  const text = `${restaurant.emoji} *${restaurant.name}* — ${restaurant.cuisine}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${header}*` } },
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', block_id: `lunch_actions_${messageTs || 'new'}` },
  ];

  const actions = blocks[2];
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
    actions.elements = [];
    if (restaurant.doordash_url) {
      actions.elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🛵 View on DoorDash', emoji: true },
        action_id: 'lunch_doordash',
        url: restaurant.doordash_url,
      });
    }
    if (actions.elements.length === 0) {
      blocks.pop();
    }
  }

  return blocks;
}

/**
 * Discovery suggestion blocks.
 * @param {{ name: string, cuisine: string, rating?: number, distance?: string }} place
 * @param {{ messageTs?: string }}
 */
export function buildDiscoveryBlocks(place, options = {}) {
  const { messageTs } = options;
  const ratingStr = place.rating != null ? ` ★ ${place.rating}` : '';
  const distStr = place.distance ? ` · ${place.distance}` : '';
  const text = `*${place.name}* — ${place.cuisine}${ratingStr}${distStr}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: "*Discovery mode* — New nearby spot" } },
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      block_id: `lunch_discovery_${messageTs || 'new'}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: "Let's try it", emoji: true },
          action_id: 'lunch_discovery_confirm',
          value: JSON.stringify(place),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Give me something familiar', emoji: true },
          action_id: 'lunch_discovery_familiar',
          value: JSON.stringify({}),
        },
      ],
    },
  ];
  return blocks;
}
