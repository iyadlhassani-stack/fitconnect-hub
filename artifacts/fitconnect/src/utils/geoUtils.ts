export interface LatLng { lat: number; lng: number }

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function nearestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): { lat: number; lng: number; t: number } {
  const dx = bx - ax; const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: ay, lng: ax, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { lat: ay + t * dy, lng: ax + t * dx, t };
}

export function distanceToRouteKm(
  lat: number, lng: number,
  routeCoords: [number, number][]
): number {
  if (routeCoords.length < 2) return 0;
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [aLng, aLat] = routeCoords[i];
    const [bLng, bLat] = routeCoords[i + 1];
    const nearest = nearestPointOnSegment(lng, lat, aLng, aLat, bLng, bLat);
    const d = haversineKm(lat, lng, nearest.lat, nearest.lng);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function metForSpeed(speedKmh: number): number {
  if (speedKmh < 4) return 2.5;
  if (speedKmh < 5) return 3.0;
  if (speedKmh < 6) return 3.5;
  if (speedKmh < 7) return 4.5;
  return 5.5;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPace(distanceKm: number, durationSec: number): string {
  if (distanceKm < 0.01) return '--:--';
  const secPerKm = durationSec / distanceKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
