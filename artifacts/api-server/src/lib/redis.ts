import Redis from "ioredis";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";

let _client: Redis | null = null;

export function getRedis(): Redis {
  if (!_client) {
    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    _client.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
  }
  return _client;
}

/** Get a cached value, or compute + store it. Returns null if Redis is unavailable. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
    const value = await fn();
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    return value;
  } catch {
    return fn();
  }
}

/** Invalidate a cache key */
export async function invalidate(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch {
    // ignore
  }
}
