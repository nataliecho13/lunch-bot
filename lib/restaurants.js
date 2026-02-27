import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'restaurants.yaml');

const KV_LAST_LOCKED_KEY = 'lunch_bot:last_locked_name';
const KV_LAST_LOCKED_WEEK_KEY = 'lunch_bot:last_locked_week';
const KV_CAPTAIN_INDEX_KEY = 'lunch_bot:captain_index';

/**
 * @returns {string[]}
 */
export function loadLunchCaptains() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const data = yaml.load(raw);
  const list = data?.lunch_captains ?? [];
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()) : [];
}

/**
 * Returns the next captain for this post and persists the next index in KV.
 * @param {{ get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void> }} kv
 * @returns {{ captainDisplay: string } | null} - mrkdwn-safe string (e.g. "<@U01234>" or "@natalie"); null if no captains
 */
export async function getNextCaptain(kv) {
  const captains = loadLunchCaptains();
  if (captains.length === 0) return null;

  let index = 0;
  if (kv) {
    try {
      const stored = await kv.get(KV_CAPTAIN_INDEX_KEY);
      if (stored != null) index = parseInt(stored, 10) || 0;
    } catch (_) {}
  }

  index = index % captains.length;
  const captain = captains[index].trim();
  const nextIndex = (index + 1) % captains.length;

  if (kv) {
    try {
      await kv.set(KV_CAPTAIN_INDEX_KEY, String(nextIndex));
    } catch (_) {}
  }

  const isSlackId = /^U[A-Z0-9]{8,12}$/i.test(captain);
  const captainDisplay = isSlackId ? `<@${captain}>` : `@${captain}`;
  return { captainDisplay };
}

/**
 * @returns {Array<{ name: string, emoji: string, cuisine: string, doordash_url?: string }>}
 */
export function loadRestaurants() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const data = yaml.load(raw);
  const list = data?.restaurants ?? [];
  return list.filter((r) => r && r.name && r.emoji);
}

/**
 * Get current ISO week number (e.g. "2025-W08") for "two weeks in a row" logic.
 */
function getCurrentWeekKey() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  const weekNum = Math.ceil((days + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Pick a restaurant, excluding the one locked last week (if we have KV).
 * @param {{ get: (k: string) => Promise<string|null> }} kv - Vercel KV or mock
 * @returns {{ name: string, emoji: string, cuisine: string, doordash_url?: string }}
 */
export async function pickRestaurant(kv) {
  const list = loadRestaurants();
  if (list.length === 0) throw new Error('No restaurants in config');

  let excludeName = null;
  if (kv) {
    try {
      const lastWeek = await kv.get(KV_LAST_LOCKED_WEEK_KEY);
      const currentWeek = getCurrentWeekKey();
      if (lastWeek === currentWeek) {
        excludeName = await kv.get(KV_LAST_LOCKED_KEY);
      }
    } catch (_) {
      // KV unavailable: don't exclude
    }
  }

  const pool = excludeName
    ? list.filter((r) => r.name !== excludeName)
    : list;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

/**
 * Record that this restaurant was locked in (so we don't repeat next week).
 * @param {{ set: (k: string, v: string) => Promise<void> }} kv
 * @param {string} restaurantName
 */
export async function setLastLocked(kv, restaurantName) {
  if (!kv || !restaurantName) return;
  try {
    const week = getCurrentWeekKey();
    await kv.set(KV_LAST_LOCKED_KEY, restaurantName);
    await kv.set(KV_LAST_LOCKED_WEEK_KEY, week);
  } catch (_) {}
}

/**
 * Discovery mode: fetch one random nearby restaurant using Places API (New) Text Search.
 * Query: "lunch restaurants near [DISCOVERY_OFFICE_ADDRESS]". 800m radius, min rating 3.8.
 * @param {{ lat: number, lng: number }} location - center for radius (DISCOVERY_LAT/LNG)
 * @param {{ excludePlaceId?: string, excludeName?: string }} options - exclude so shuffle never repeats
 * @returns {Promise<{ name: string, cuisine: string, rating?: number, distance?: string, place_id?: string } | null>}
 */
export async function fetchDiscoveryPlace(location, options = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const officeAddress = (process.env.DISCOVERY_OFFICE_ADDRESS || '').trim();
  if (!key || !location?.lat || !location?.lng) return null;

  const { lat, lng } = location;
  const { excludePlaceId, excludeName } = options;

  const textQuery = officeAddress
    ? `lunch restaurants near ${officeAddress}`
    : 'lunch restaurants';

  const body = {
    textQuery,
    pageSize: 20,
    minRating: 3.8,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 800,
      },
    },
  };

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[discovery] Google Places API error', res.status, errBody);
    return null;
  }
  const data = await res.json();
  const places = data.places || [];
  if (places.length === 0) {
    console.error('[discovery] No places in response', JSON.stringify(data));
    return null;
  }

  const exclude = (p) => {
    const pid = p.id || p.name?.replace?.('places/', '') || '';
    const name = (p.displayName?.text || p.displayName || '').trim();
    if (excludePlaceId && pid === excludePlaceId) return true;
    if (excludeName && name === (excludeName || '').trim()) return true;
    return false;
  };
  const candidates = places.filter((p) => !exclude(p));
  if (candidates.length === 0) return null;

  const place = candidates[Math.floor(Math.random() * candidates.length)];
  const name = (place.displayName?.text || place.displayName || 'Unknown').trim();
  const rating = place.rating != null ? place.rating : undefined;
  const placeId = place.id || place.name?.replace?.('places/', '') || undefined;

  let distanceStr;
  const loc = place.location;
  if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
    const dist = haversineKm(lat, lng, loc.latitude, loc.longitude);
    distanceStr = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
  }

  return {
    name,
    cuisine: 'Restaurant',
    rating,
    distance: distanceStr,
    place_id: placeId,
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export { getCurrentWeekKey };
