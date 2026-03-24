/**
 * KV client using REDIS_URL (Vercel Redis). Exposes get/set for captain index and last-locked state.
 * When REDIS_URL is missing, get returns null and set is a no-op.
 */
import { createClient } from 'redis';

let client = null;

async function getClient() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    client = createClient({ url });
    await client.connect();
    return client;
  } catch (_) {
    client = null;
    return null;
  }
}

export default {
  async get(key) {
    const c = await getClient();
    if (!c) return null;
    try {
      return await c.get(key);
    } catch (_) {
      return null;
    }
  },
  async set(key, value) {
    const c = await getClient();
    if (c) {
      try {
        await c.set(key, value);
      } catch (_) {}
    }
  },
};
