// ─── POI Service ────────────────────────────────────────────────────────────
// Uses Overpass API (free, no key) + Wikipedia API (free, no key)
// to find scenic Points of Interest near walking routes.

export interface POI {
  id: string;
  name: string;
  type: 'park' | 'monument' | 'square' | 'viewpoint' | 'fountain';
  lat: number;
  lng: number;
  photo_url: string | null;
  description: string | null;
  distance_from_route: number | null;
  on_route: boolean;
}

interface BBox { south: number; west: number; north: number; east: number }

export interface OrsResult {
  distance: number;
  duration: number;
  coordinates: number[][];
}

// ─── Importance scores ─────────────────────────────────────────────────────

const POI_IMPORTANCE: Record<string, number> = {
  park: 5,
  monument: 4,
  viewpoint: 4,
  square: 3,
  fountain: 2,
};

// ─── Geometry helpers ──────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentM(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return haversineM(py, px, ay, ax);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return haversineM(py, px, ay + t * dy, ax + t * dx);
}

function distanceFromRouteM(poi: { lat: number; lng: number }, coords: number[][]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineM(poi.lat, poi.lng, coords[0][1] as number, coords[0][0] as number);
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i] as [number, number];
    const [bx, by] = coords[i + 1] as [number, number];
    const d = pointToSegmentM(poi.lng, poi.lat, ax, ay, bx, by);
    if (d < min) min = d;
  }
  return min;
}

export function routeToBBox(coordinates: number[][], expandKm = 0.6): BBox {
  if (coordinates.length === 0) return { south: 0, west: 0, north: 0, east: 0 };
  const lngs = coordinates.map((c) => c[0] as number);
  const lats = coordinates.map((c) => c[1] as number);
  const exp = expandKm / 111;
  return {
    south: Math.min(...lats) - exp,
    west: Math.min(...lngs) - exp,
    north: Math.max(...lats) + exp,
    east: Math.max(...lngs) + exp,
  };
}

// ─── Overpass API ──────────────────────────────────────────────────────────

function getPoiType(tags: Record<string, string>): POI['type'] | null {
  if (tags['leisure'] === 'park') return 'park';
  if (tags['historic'] === 'monument' || tags['historic'] === 'memorial') return 'monument';
  if (tags['amenity'] === 'square' || tags['place'] === 'square') return 'square';
  if (tags['tourism'] === 'viewpoint') return 'viewpoint';
  if (tags['amenity'] === 'fountain') return 'fountain';
  return null;
}

export async function searchPOIs(bbox: BBox, categories: string[]): Promise<POI[]> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const parts: string[] = [];

  if (categories.includes('park')) {
    parts.push(`node["leisure"="park"](${b});`, `way["leisure"="park"](${b});`);
  }
  if (categories.includes('monument')) {
    parts.push(`node["historic"~"monument|memorial"](${b});`);
  }
  if (categories.includes('square')) {
    parts.push(`node["amenity"="square"](${b});`, `node["place"="square"](${b});`);
  }
  if (categories.includes('viewpoint')) {
    parts.push(`node["tourism"="viewpoint"](${b});`);
  }
  if (categories.includes('fountain')) {
    parts.push(`node["amenity"="fountain"](${b});`);
  }

  if (parts.length === 0) return [];

  const query = `[out:json][timeout:20];\n(\n${parts.join('\n')}\n);\nout center;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(14_000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    const pois: POI[] = [];
    const seen = new Set<string>();

    for (const el of data.elements ?? []) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!lat || !lng) continue;

      const tags = el.tags ?? {};
      const name = tags['name'] ?? tags['name:en'] ?? tags['name:fr'];
      if (!name) continue;

      const type = getPoiType(tags);
      if (!type || !categories.includes(type)) continue;

      // De-duplicate by name+type
      const key = `${type}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pois.push({
        id: `${el.type}/${el.id}`,
        name,
        type,
        lat,
        lng,
        photo_url: null,
        description: null,
        distance_from_route: null,
        on_route: false,
      });
    }

    return pois;
  } catch {
    return [];
  }
}

// ─── Wikipedia enrichment ──────────────────────────────────────────────────

const wikiCache = new Map<string, { photo_url: string | null; description: string | null }>();

async function fetchWikipediaData(
  name: string,
  lang: string
): Promise<{ photo_url: string | null; description: string | null }> {
  const cacheKey = `${lang}:${name}`;
  if (wikiCache.has(cacheKey)) return wikiCache.get(cacheKey)!;

  const domain = lang === 'fr' ? 'fr.wikipedia.org' : 'en.wikipedia.org';
  const url = `https://${domain}/w/api.php?action=query&format=json&prop=pageimages|extracts&exintro&explaintext&exsentences=2&pithumbsize=400&titles=${encodeURIComponent(name)}&origin=*`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return { photo_url: null, description: null };

    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { pageid?: number; thumbnail?: { source?: string }; extract?: string }
        >;
      };
    };

    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || !page.pageid || page.pageid < 0) {
      // Fallback to English if French search found nothing
      if (lang === 'fr') {
        const result = await fetchWikipediaData(name, 'en');
        wikiCache.set(cacheKey, result);
        return result;
      }
      wikiCache.set(cacheKey, { photo_url: null, description: null });
      return { photo_url: null, description: null };
    }

    const result = {
      photo_url: page.thumbnail?.source ?? null,
      description: page.extract?.trim().slice(0, 280) ?? null,
    };
    wikiCache.set(cacheKey, result);
    return result;
  } catch {
    return { photo_url: null, description: null };
  }
}

async function enrichPOIsWithWikipedia(pois: POI[], language: string): Promise<POI[]> {
  const WIKIPEDIA_TIMEOUT_MS = 5_000;

  const enriched = await Promise.race([
    Promise.all(
      pois.map(async (poi) => {
        const wiki = await fetchWikipediaData(poi.name, language);
        return { ...poi, ...wiki };
      })
    ),
    new Promise<POI[]>((resolve) =>
      setTimeout(() => resolve(pois), WIKIPEDIA_TIMEOUT_MS)
    ),
  ]);

  return enriched;
}

// ─── Scoring & filtering ───────────────────────────────────────────────────

export function scorePOIs(pois: POI[], routeCoords: number[][]): POI[] {
  return pois
    .map((poi) => {
      const dist = distanceFromRouteM(poi, routeCoords);
      const importance = POI_IMPORTANCE[poi.type] ?? 1;
      // Score decays sharply after 300m from route
      const score = (importance * 10) / (1 + dist / 150);
      return { poi: { ...poi, distance_from_route: Math.round(dist) }, score };
    })
    .filter(({ score }) => score > 0.5) // remove very distant POIs
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ poi }) => poi);
}

// ─── Route incorporation via ORS ──────────────────────────────────────────

async function callORS(
  coords: [number, number][],
  options: Record<string, unknown> | null,
  orsKey: string
): Promise<OrsResult | null> {
  try {
    const body: Record<string, unknown> = { coordinates: coords };
    if (options) body.options = options;

    const res = await fetch(
      'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: orsKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      features?: Array<{
        geometry: { coordinates: number[][] };
        properties: { summary: { distance: number; duration: number } };
      }>;
    };

    const feature = data.features?.[0];
    if (!feature) return null;

    return {
      distance: feature.properties.summary.distance,
      duration: feature.properties.summary.duration,
      coordinates: feature.geometry.coordinates,
    };
  } catch {
    return null;
  }
}

async function tryIncorporate(
  candidatePOIs: POI[],
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
  goalKm: number,
  orsKey: string
): Promise<{ route: OrsResult; usedPOIs: POI[] } | null> {
  const isLoop = Math.abs(startLng - endLng) < 0.0001 && Math.abs(startLat - endLat) < 0.0001;

  // Try with top 3 → 2 → 1 POIs
  for (let count = Math.min(3, candidatePOIs.length); count >= 1; count--) {
    const subset = candidatePOIs.slice(0, count);
    const waypoints: [number, number][] = subset.map((p) => [p.lng, p.lat]);

    const start: [number, number] = [startLng, startLat];
    const end: [number, number] = isLoop ? [startLng, startLat] : [endLng, endLat];
    const coords: [number, number][] = [start, ...waypoints, end];

    const result = await callORS(coords, null, orsKey);
    if (!result) continue;

    const distKm = result.distance / 1000;
    const errorPct = Math.abs(distKm - goalKm) / Math.max(goalKm, 0.1);

    if (errorPct <= 0.15) {
      return {
        route: result,
        usedPOIs: subset.map((p) => ({ ...p, on_route: true })),
      };
    }
  }

  return null;
}

// ─── Main entry point ──────────────────────────────────────────────────────

export async function findPOIsForRoute({
  baseCoordinates,
  mode,
  startLng,
  startLat,
  endLng,
  endLat,
  goalKm,
  categories,
  language,
  orsKey,
}: {
  baseCoordinates: number[][];
  mode: string;
  startLng: number;
  startLat: number;
  endLng: number;
  endLat: number;
  goalKm: number;
  categories: string[];
  language: string;
  orsKey: string | undefined;
}): Promise<{ pois: POI[]; enhancedRoute: OrsResult | null }> {
  try {
    // 1. Find POIs within route bounding box
    const bbox = routeToBBox(baseCoordinates, 0.5);
    const rawPOIs = await searchPOIs(bbox, categories);
    if (rawPOIs.length === 0) return { pois: [], enhancedRoute: null };

    // 2. Score by proximity to route (only POIs within 500m)
    const scored = scorePOIs(rawPOIs, baseCoordinates).filter(
      (p) => (p.distance_from_route ?? Infinity) < 500
    );
    if (scored.length === 0) return { pois: [], enhancedRoute: null };

    // 3. Enrich top candidates with Wikipedia (parallel, 5s timeout)
    const topCandidates = scored.slice(0, 8);
    const enriched = await enrichPOIsWithWikipedia(topCandidates, language);

    // 4. Try to incorporate closest POIs into the route (loop + direct modes only)
    let enhancedRoute: OrsResult | null = null;
    let usedPOIs: POI[] = [];

    if (orsKey && (mode === 'loop' || mode === 'direct')) {
      const incorporate = await tryIncorporate(
        enriched.slice(0, 5),
        startLng,
        startLat,
        endLng,
        endLat,
        goalKm,
        orsKey
      );

      if (incorporate) {
        enhancedRoute = incorporate.route;
        usedPOIs = incorporate.usedPOIs;

        // Re-score remaining enriched POIs against the NEW route
        const onRouteIds = new Set(usedPOIs.map((p) => p.id));
        const nearbyPOIs = enriched
          .filter((p) => !onRouteIds.has(p.id))
          .slice(0, 3);

        return { pois: [...usedPOIs, ...nearbyPOIs], enhancedRoute };
      }
    }

    // 5. No incorporation — return nearby POIs only (max 5)
    return { pois: enriched.slice(0, 5).map((p) => ({ ...p, on_route: false })), enhancedRoute: null };
  } catch {
    return { pois: [], enhancedRoute: null };
  }
}
