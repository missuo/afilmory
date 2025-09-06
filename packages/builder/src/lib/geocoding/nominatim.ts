import fs from 'node:fs/promises'
import path from 'node:path'

import { builderConfig } from '@builder'

import { workdir } from '../../path.js'

export type ReverseGeocodeResult = {
  city: string | null
  province: string | null
  country: string | null
  displayName?: string | null
}

type NominatimResponse = {
  display_name?: string
  address?: Record<string, string>
}

const CACHE_FILE = path.join(workdir, 'src/data/.geocode-cache.json')
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000 // 1 year

type CacheEntry = { v: ReverseGeocodeResult; t: number }
type CacheData = Record<string, CacheEntry>

let cache: CacheData | null = null

async function loadCache(): Promise<CacheData> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8')
    const json = JSON.parse(raw) as CacheData
    cache = json || {}
  } catch {
    cache = {}
  }
  return cache!
}

async function saveCache(): Promise<void> {
  if (!cache) return
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache), 'utf-8')
  } catch {
    // ignore
  }
}

const roundCoord = (n: number, decimals = 3) => Number(n.toFixed(decimals))
const makeKey = (lat: number, lon: number, lang: string) =>
  `${roundCoord(lat)},${roundCoord(lon)}@${lang}`

let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0
const schedule = <T>(fn: () => Promise<T>): Promise<T> => {
  const res = queue.then(async () => {
    const now = Date.now()
    const wait = Math.max(0, 1000 - (now - lastAt))
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait))
    }
    lastAt = Date.now()
    return fn()
  }) as Promise<T>
  queue = res.then(
    () => {},
    () => {},
  )
  return res
}

const extractCityProvinceCountry = (
  data: NominatimResponse,
): ReverseGeocodeResult => {
  const a = data.address || {}
  const city =
    a.city ||
    a.town ||
    a.village ||
    a.municipality ||
    a.city_district ||
    a.suburb ||
    a.county ||
    a.hamlet ||
    null

  const province =
    a.province ||
    a.state ||
    a.region ||
    (a.state_district as string | undefined) ||
    null

  const country = a.country || null

  return { city: city || null, province, country }
}

const inflight = new Map<string, Promise<ReverseGeocodeResult>>()

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  await loadCache()
  const {acceptLanguage} = builderConfig.geocoding
  const key = makeKey(lat, lon, acceptLanguage)

  // cache hit
  const hit = cache![key]
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) {
    return hit.v
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const p = schedule(async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(
      lat,
    )}&lon=${encodeURIComponent(lon)}&format=json&accept-language=${encodeURIComponent(
      acceptLanguage,
    )}`
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'afilmory-builder/1.0',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as NominatimResponse
      const result = {
        ...extractCityProvinceCountry(data),
        displayName: data.display_name || null,
      }
      cache![key] = { v: result, t: Date.now() }
      await saveCache()
      return result
    } catch {
      // store negative cache to avoid retry storms
      const result: ReverseGeocodeResult = {
        city: null,
        province: null,
        country: null,
        displayName: null,
      }
      cache![key] = { v: result, t: Date.now() }
      await saveCache()
      return result
    } finally {
      inflight.delete(key)
    }
  })

  inflight.set(key, p)
  return p
}
