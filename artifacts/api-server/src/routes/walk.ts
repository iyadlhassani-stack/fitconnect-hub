import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, walkingRoutesTable } from "@workspace/db";
import {
  GenerateWalkingRoutesBody,
  SaveWalkingRouteBody,
  GetRouteHistoryQueryParams,
} from "@workspace/api-zod";

const router = Router();

// ─── Single source of truth: walk math ────────────────────────────────────────

const MET: Record<string, number> = { slow: 3.0, normal: 3.5, fast: 4.5 };
const SPEED: Record<string, number> = { slow: 4, normal: 5, fast: 6 }; // km/h

function met(pace: string) { return MET[pace] ?? 3.5; }
function speed(pace: string) { return SPEED[pace] ?? 5; }

function durationFromCalories(calories: number, weightKg: number, pace: string): number {
  return (calories / (met(pace) * weightKg)) * 60; // minutes
}
function distanceFromDuration(durationMin: number, pace: string): number {
  return (durationMin / 60) * speed(pace); // km
}
function distanceFromCalories(calories: number, weightKg: number, pace: string): number {
  return distanceFromDuration(durationFromCalories(calories, weightKg, pace), pace);
}
function durationFromDistance(distanceKm: number, pace: string): number {
  return (distanceKm / speed(pace)) * 60; // minutes
}
function caloriesFromDistance(distanceKm: number, weightKg: number, pace: string): number {
  return met(pace) * weightKg * (durationFromDistance(distanceKm, pace) / 60);
}
function goalToTargetDistance(goalType: string, goalValue: number, weightKg: number, pace: string): number {
  switch (goalType) {
    case "calories": return distanceFromCalories(goalValue, weightKg, pace);
    case "minutes": return distanceFromDuration(goalValue, pace);
    default: return goalValue; // "distance"
  }
}
function computeRouteStats(actualDistanceKm: number, weightKg: number, pace: string) {
  const durationMin = Math.round(durationFromDistance(actualDistanceKm, pace));
  const calories = Math.round(caloriesFromDistance(actualDistanceKm, weightKg, pace));
  return {
    distance_km: parseFloat(actualDistanceKm.toFixed(2)),
    duration_min: durationMin,
    estimated_calories: calories,
  };
}

// ─── Geo helpers ───────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function perpendicularWaypoint(
  lat1: number, lng1: number, lat2: number, lng2: number,
  offsetKm: number, side: 1 | -1
): [number, number] {
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const perpLat = -dLng;
  const perpLng = dLat;
  const len = Math.sqrt(perpLat ** 2 + perpLng ** 2);
  if (len === 0) return [(lat1 + lat2) / 2, (lng1 + lng2) / 2];
  const offsetDeg = offsetKm / 111;
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  return [midLat + side * (perpLat / len) * offsetDeg, midLng + side * (perpLng / len) * offsetDeg];
}

// ─── ORS client ────────────────────────────────────────────────────────────────

interface OrsResult { distance: number; duration: number; coordinates: number[][] }

async function callORS(
  coords: [number, number][],
  options: Record<string, unknown> | null,
  orsKey: string
): Promise<OrsResult | null> {
  const body: Record<string, unknown> = { coordinates: coords };
  if (options) body.options = options;
  try {
    const response = await fetch(
      "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: orsKey }, body: JSON.stringify(body) }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      features?: Array<{ geometry: { coordinates: number[][] }; properties: { summary: { distance: number; duration: number } } }>;
    };
    if (!data.features?.[0]) return null;
    const feat = data.features[0];
    return { distance: feat.properties.summary.distance, duration: feat.properties.summary.duration, coordinates: feat.geometry.coordinates };
  } catch { return null; }
}

// ─── Route generation ──────────────────────────────────────────────────────────

router.post("/routes/generate", async (req, res): Promise<void> => {
  const parsed = GenerateWalkingRoutesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { mode = "loop", lat, lng, endLat, endLng, targetType, targetValue, pace, weightKg, seed } = parsed.data;
  const orsKey = process.env.VITE_OPENROUTESERVICE_API_KEY;

  try {
    // ── Mode: loop ────────────────────────────────────────────────────────────
    if (mode === "loop") {
      if (!targetType || targetValue == null || targetValue <= 0) {
        res.status(400).json({ error: "Loop mode requires a goal (type and value)." });
        return;
      }
      const targetKm = goalToTargetDistance(targetType, targetValue, weightKg, pace);
      if (targetKm < 0.5) {
        res.status(400).json({ error: "Goal too short. Minimum walking distance is 500m." });
        return;
      }
      if (targetKm > 50) {
        res.status(400).json({ error: "Goal too long. Maximum walking distance is 50km." });
        return;
      }

      if (!orsKey) {
        const mockCoords = [[lng, lat],[lng+0.012,lat+0.008],[lng+0.018,lat-0.004],[lng+0.006,lat-0.012],[lng, lat]];
        const stats = computeRouteStats(targetKm, weightKg, pace);
        res.json({ ...stats, geojson: { type: "LineString", coordinates: mockCoords }, note: null, mode: "loop", start_coords: { lat, lng }, end_coords: { lat, lng } });
        return;
      }

      const usedSeed = seed ?? Math.floor(Math.random() * 1000);
      const result = await callORS([[lng, lat]], { round_trip: { length: Math.round(targetKm * 1000), points: 5, seed: usedSeed } }, orsKey);
      if (!result) {
        res.status(500).json({ error: "No walking path found. OpenStreetMap may have no data for this area. Try a nearby major city." });
        return;
      }
      const stats = computeRouteStats(result.distance / 1000, weightKg, pace);
      res.json({ ...stats, geojson: { type: "LineString", coordinates: result.coordinates }, note: null, mode: "loop", start_coords: { lat, lng }, end_coords: { lat, lng } });
      return;
    }

    // ── Mode: direct (A→B, intelligent, optional goal) ────────────────────────
    if (mode === "direct") {
      if (endLat == null || endLng == null) {
        res.status(400).json({ error: "End coordinates required for A to B mode." });
        return;
      }

      // Step 1 — always compute direct route first
      let directResult: OrsResult | null = null;
      if (orsKey) directResult = await callORS([[lng, lat], [endLng, endLat]], null, orsKey);
      const directKm = directResult ? directResult.distance / 1000 : haversineKm(lat, lng, endLat, endLng);
      const directCoords = directResult?.coordinates ?? [[lng, lat], [endLng, endLat]];
      const directStats = computeRouteStats(directKm, weightKg, pace);
      const baseResponse = {
        ...directStats,
        geojson: { type: "LineString", coordinates: directCoords },
        mode: "direct",
        start_coords: { lat, lng },
        end_coords: { lat: endLat, lng: endLng },
      };

      // Step 2 — no goal: return direct route
      if (!targetType || targetValue == null || targetValue <= 0) {
        res.json({ ...baseResponse, note: "Direct route." });
        return;
      }

      // Step 3 — goal provided: check feasibility
      const targetKm = goalToTargetDistance(targetType, targetValue, weightKg, pace);

      // Impossible: goal < direct distance (with 50m tolerance)
      if (targetKm < directKm - 0.05) {
        res.json({
          ...baseResponse,
          note: `Goal impossible. The direct walk already requires ${directKm.toFixed(1)} km / ${directStats.duration_min} min / ${directStats.estimated_calories} kcal.`,
          goal_impossible: true,
          target_km: parseFloat(targetKm.toFixed(2)),
          direct_km: directStats.distance_km,
          direct_duration_min: directStats.duration_min,
          direct_calories: directStats.estimated_calories,
        });
        return;
      }

      // Close enough (within 5%): return direct
      if (Math.abs(targetKm - directKm) / Math.max(directKm, 0.01) < 0.05) {
        res.json({ ...baseResponse, note: "Direct route matches your goal." });
        return;
      }

      // Step 4 — detour needed
      if (!orsKey) {
        const stats = computeRouteStats(targetKm, weightKg, pace);
        res.json({ ...stats, geojson: { type: "LineString", coordinates: directCoords }, note: "Detour route (mock).", mode: "direct", start_coords: { lat, lng }, end_coords: { lat: endLat, lng: endLng } });
        return;
      }

      const offsetKm = (targetKm - directKm) / 2;
      let bestResult: OrsResult | null = null;
      let bestActualKm = 0;

      for (const side of [1, -1] as const) {
        for (const multiplier of [1, 1.5, 2.2]) {
          const [wLat, wLng] = perpendicularWaypoint(lat, lng, endLat, endLng, offsetKm * multiplier, side);
          const result = await callORS([[lng, lat], [wLng, wLat], [endLng, endLat]], null, orsKey);
          if (!result) continue;
          const actualKm = result.distance / 1000;
          if (Math.abs(actualKm - targetKm) / targetKm <= 0.10) {
            const stats = computeRouteStats(actualKm, weightKg, pace);
            res.json({ ...stats, geojson: { type: "LineString", coordinates: result.coordinates }, note: null, mode: "direct", start_coords: { lat, lng }, end_coords: { lat: endLat, lng: endLng } });
            return;
          }
          if (!bestResult || Math.abs(actualKm - targetKm) < Math.abs(bestActualKm - targetKm)) {
            bestResult = result;
            bestActualKm = actualKm;
          }
        }
      }

      if (bestResult) {
        const stats = computeRouteStats(bestActualKm, weightKg, pace);
        res.json({
          ...stats,
          geojson: { type: "LineString", coordinates: bestResult.coordinates },
          note: `Closest match: ${bestActualKm.toFixed(1)} km. Your goal was ${targetKm.toFixed(1)} km.`,
          warning: true,
          mode: "direct",
          start_coords: { lat, lng },
          end_coords: { lat: endLat, lng: endLng },
        });
        return;
      }

      // Last resort: return direct with warning
      res.json({ ...baseResponse, note: "Could not build a matching detour. Showing direct route.", warning: true });
      return;
    }

    // ── Mode: custom ──────────────────────────────────────────────────────────
    if (mode === "custom") {
      const waypoints = parsed.data.waypoints as Array<{ lat: number; lng: number }> | null | undefined;
      if (!waypoints || waypoints.length < 2) {
        res.status(400).json({ error: "Custom mode requires at least a starting point and destination." });
        return;
      }
      const orsCoords: [number, number][] = waypoints.map((w) => [w.lng, w.lat]);
      const lastW = waypoints[waypoints.length - 1];

      if (!orsKey) {
        let totalKm = 0;
        for (let i = 1; i < waypoints.length; i++) {
          totalKm += haversineKm(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
        }
        const stats = computeRouteStats(totalKm, weightKg, pace);
        res.json({ ...stats, geojson: { type: "LineString", coordinates: orsCoords }, note: "Custom path. Stats calculated based on your pace.", mode: "custom", start_coords: { lat, lng }, end_coords: { lat: lastW.lat, lng: lastW.lng } });
        return;
      }

      const result = await callORS(orsCoords, null, orsKey);
      if (!result) {
        res.status(500).json({ error: "Could not connect these points by walking. They may not be reachable on foot." });
        return;
      }
      const stats = computeRouteStats(result.distance / 1000, weightKg, pace);
      res.json({ ...stats, geojson: { type: "LineString", coordinates: result.coordinates }, note: "Custom path. Stats calculated based on your pace.", mode: "custom", start_coords: { lat, lng }, end_coords: { lat: lastW.lat, lng: lastW.lng } });
      return;
    }

    res.status(400).json({ error: "Invalid mode." });
  } catch (err) {
    req.log.error({ err }, "Failed to generate route");
    res.status(500).json({ error: "Failed to generate walking route." });
  }
});

// ─── Save route ────────────────────────────────────────────────────────────────

router.post("/routes", async (req, res): Promise<void> => {
  const parsed = SaveWalkingRouteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  try {
    const [route] = await db.insert(walkingRoutesTable).values({
      userId: data.user_id,
      startLocation: data.start_location as unknown as Record<string, unknown>,
      targetType: data.target_type,
      targetValue: data.target_value != null ? String(data.target_value) : null,
      generatedRoute: data.generated_route as unknown as Record<string, unknown>,
      distanceKm: String(data.distance_km),
      durationMin: String(data.duration_min),
      estimatedCalories: String(data.estimated_calories),
      completed: data.completed ?? false,
      actualCalories: data.actual_calories != null ? String(data.actual_calories) : null,
    }).returning();
    res.status(201).json({
      id: route.id, user_id: route.userId, start_location: route.startLocation,
      target_type: route.targetType, target_value: route.targetValue ? parseFloat(route.targetValue) : null,
      generated_route: route.generatedRoute, distance_km: parseFloat(route.distanceKm),
      duration_min: parseFloat(route.durationMin), estimated_calories: parseFloat(route.estimatedCalories),
      completed: route.completed, actual_calories: route.actualCalories ? parseFloat(route.actualCalories) : null,
      created_at: route.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save walking route");
    res.status(500).json({ error: "Failed to save route" });
  }
});

// ─── Route history ─────────────────────────────────────────────────────────────

router.get("/routes/history", async (req, res): Promise<void> => {
  const parsed = GetRouteHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const routes = await db.select().from(walkingRoutesTable).where(eq(walkingRoutesTable.userId, parsed.data.userId)).orderBy(desc(walkingRoutesTable.createdAt)).limit(20);
    res.json(routes.map((r) => ({
      id: r.id, user_id: r.userId, start_location: r.startLocation,
      target_type: r.targetType, target_value: r.targetValue ? parseFloat(r.targetValue) : null,
      generated_route: r.generatedRoute, distance_km: parseFloat(r.distanceKm),
      duration_min: parseFloat(r.durationMin), estimated_calories: parseFloat(r.estimatedCalories),
      completed: r.completed, actual_calories: r.actualCalories ? parseFloat(r.actualCalories) : null,
      created_at: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch route history");
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

export default router;
