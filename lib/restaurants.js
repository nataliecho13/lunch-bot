import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'restaurants.yaml');

const KV_LAST_LOCKED_KEY = 'lunch_bot:last_locked_name';
const KV_LAST_LOCKED_WEEK_KEY = 'lunch_bot:last_locked_week';

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
 * Discovery mode: fetch one random nearby restaurant from Google Places.
 * @param {{ lat: number, lng: number }} location
 * @returns {Promise<{ name: string, cuisine: string, rating?: number, distance?: string } | null>}
 */
export async function fetchDiscoveryPlace(location) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !location?.lat || !location?.lng) return null;

  const { lat, lng } = location;
  // Use legacy Nearby Search (no API key in URL for server; use as query param)
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', '2000');
  url.searchParams.set('type', 'restaurant');
  url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return null;
  const results = data.results || [];
  if (results.length === 0) return null;

  const place = results[Math.floor(Math.random() * results.length)];
  const name = place.name || 'Unknown';
  const rating = place.rating != null ? place.rating : undefined;
  const types = place.types || [];
  const cuisine = types.includes('restaurant')
    ? (place.types.find((t) => t !== 'restaurant' && t !== 'food' && t !== 'point_of_interest') || 'Restaurant')
    : 'Restaurant';
  const cuisineLabel = cuisine.charAt(0).toUpperCase() + cuisine.slice(1).replace(/_/g, ' ');

  let distanceStr;
  if (place.geometry?.location) {
    const dist = haversineKm(lat, lng, place.geometry.location.lat, place.geometry.location.lng);
    distanceStr = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
  }

  return { name, cuisine: cuisineLabel, rating, distance: distanceStr };
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
