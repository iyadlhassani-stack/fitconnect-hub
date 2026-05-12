import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, walkingRoutesTable } from "@workspace/db";
import {
  GenerateWalkingRoutesBody,
  SaveWalkingRouteBody,
  GetRouteHistoryQueryParams,
} from "@workspace/api-zod";

const router = Router();

const MET: Record<string, number> = { slow: 3, normal: 3.5, fast: 4.5 };
const SPEED: Record<string, number> = { slow: 4, normal: 5, fast: 6 };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function perpendicularWaypoint(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  offsetKm: number,
  side: 1 | -1
): [number, number] {
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const perpLat = -dLng;
  const perpLng = dLat;
  const len = Math.sqrt(perpLat ** 2 + perpLng ** 2);
  if (len === 0) return [(lat1 + lat2) / 2, (lng1 + lng2) / 2];
  const normLat = perpLat / len;
  const normLng = perpLng / len;
  const offsetDeg = offsetKm / 111;
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  return [
    midLat + side * normLat * offsetDeg,
    midLng + side * normLng * offsetDeg,
  ];
}

interface OrsResult {
  distance: number;
  duration: number;
  coordinates: number[][];
}

async function callORS(
  coords: [number, number][],
  options: Record<string, unknown> | null,
  orsKey: string
): Promise<OrsResult | null> {
  const body: Record<string, unknown> = { coordinates: coords };
  if (options) body.options = options;

  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: orsKey },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    features?: Array<{
      geometry: { coordinates: number[][] };
      properties: { summary: { distance: number; duration: number } };
    }>;
  };

  if (!data.features?.[0]) return null;

  const feature = data.features[0];
  return {
    distance: feature.properties.summary.distance,
    duration: feature.properties.summary.duration,
    coordinates: feature.geometry.coordinates,
  };
}

router.post("/routes/generate", async (req, res): Promise<void> => {
  const parsed = GenerateWalkingRoutesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { mode = "loop", lat, lng, endLat, endLng, targetType, targetValue, pace, weightKg, seed } = parsed.data;

  const speedKmh = SPEED[pace] ?? 5;
  const met = MET[pace] ?? 3.5;

  let targetKm: number;
  if (targetType === "calories") {
    const durationH = Number(targetValue) / (met * Number(weightKg));
    targetKm = durationH * speedKmh;
  } else if (targetType === "minutes") {
    targetKm = (Number(targetValue) / 60) * speedKmh;
  } else {
    targetKm = Number(targetValue);
  }

  const orsKey = process.env.VITE_OPENROUTESERVICE_API_KEY;

  const buildResult = (
    distanceM: number,
    durationS: number,
    coordinates: number[][],
    note?: string
  ) => {
    const distanceKm = distanceM / 1000;
    const durationMin = Math.round(durationS / 60);
    const calories = Math.round(met * Number(weightKg) * (durationMin / 60));
    return {
      distance_km: parseFloat(distanceKm.toFixed(2)),
      duration_min: durationMin,
      estimated_calories: calories,
      geojson: { type: "LineString", coordinates },
      note: note ?? null,
      mode,
      start_coords: { lat, lng },
      end_coords:
        endLat != null && endLng != null ? { lat: endLat, lng: endLng } : { lat, lng },
    };
  };

  const mockLoop = () => {
    const mockCoords = [
      [lng, lat],
      [lng + 0.012, lat + 0.008],
      [lng + 0.018, lat - 0.004],
      [lng + 0.006, lat - 0.012],
      [lng, lat],
    ];
    return buildResult(targetKm * 1000, (targetKm / speedKmh) * 3600, mockCoords);
  };

  try {
    if (mode === "loop") {
      const usedSeed = seed ?? Math.floor(Math.random() * 1000);

      if (!orsKey) {
        res.json(mockLoop());
        return;
      }

      const result = await callORS(
        [[lng, lat]],
        { round_trip: { length: Math.round(targetKm * 1000), points: 5, seed: usedSeed } },
        orsKey
      );

      if (!result) {
        req.log.warn("ORS loop failed, using mock");
        res.json(mockLoop());
        return;
      }

      res.json(buildResult(result.distance, result.duration, result.coordinates));
      return;
    }

    if (mode === "direct") {
      if (endLat == null || endLng == null) {
        res.status(400).json({ error: "End coordinates required for direct mode" });
        return;
      }

      if (!orsKey) {
        const d = haversineKm(lat, lng, endLat, endLng);
        res.json(buildResult(d * 1000, (d / speedKmh) * 3600, [[lng, lat], [endLng, endLat]], "Direct route shown."));
        return;
      }

      const result = await callORS([[lng, lat], [endLng, endLat]], null, orsKey);

      if (!result) {
        req.log.warn("ORS direct failed");
        const d = haversineKm(lat, lng, endLat, endLng);
        res.json(buildResult(d * 1000, (d / speedKmh) * 3600, [[lng, lat], [endLng, endLat]], "This is the direct route between your points."));
        return;
      }

      res.json(buildResult(result.distance, result.duration, result.coordinates, "This is the direct route between your points."));
      return;
    }

    if (mode === "calorie_detour") {
      if (endLat == null || endLng == null) {
        res.status(400).json({ error: "End coordinates required for calorie_detour mode" });
        return;
      }

      if (!orsKey) {
        const mockCoords = [
          [lng, lat],
          [lng + 0.015, lat + 0.018],
          [(lng + endLng) / 2, (lat + endLat) / 2],
          [endLng, endLat],
        ];
        res.json(buildResult(targetKm * 1000, (targetKm / speedKmh) * 3600, mockCoords));
        return;
      }

      const directResult = await callORS([[lng, lat], [endLng, endLat]], null, orsKey);
      const directKm = directResult
        ? directResult.distance / 1000
        : haversineKm(lat, lng, endLat, endLng);

      if (targetKm <= directKm) {
        const coords = directResult?.coordinates ?? [[lng, lat], [endLng, endLat]];
        const dur = directResult?.duration ?? (directKm / speedKmh) * 3600;
        const dist = directResult?.distance ?? directKm * 1000;
        res.json(
          buildResult(dist, dur, coords, `Direct route already covers ${directKm.toFixed(1)} km (target: ${targetKm.toFixed(1)} km).`)
        );
        return;
      }

      const offsetKm = (targetKm - directKm) / 2;
      let bestResult: OrsResult | null = null;
      let bestNote: string | null = null;

      for (const side of [1, -1] as const) {
        for (const multiplier of [1, 1.4]) {
          const [wLat, wLng] = perpendicularWaypoint(lat, lng, endLat, endLng, offsetKm * multiplier, side);
          const result = await callORS([[lng, lat], [wLng, wLat], [endLng, endLat]], null, orsKey);
          if (!result) continue;

          const actualKm = result.distance / 1000;
          const errorPct = Math.abs(actualKm - targetKm) / targetKm;

          if (errorPct <= 0.18) {
            res.json(buildResult(result.distance, result.duration, result.coordinates));
            return;
          }

          if (!bestResult || Math.abs(actualKm - targetKm) < Math.abs((bestResult.distance / 1000) - targetKm)) {
            bestResult = result;
            bestNote = `Route is approximate (${actualKm.toFixed(1)} km, target was ${targetKm.toFixed(1)} km)`;
          }
        }
      }

      if (bestResult) {
        res.json(buildResult(bestResult.distance, bestResult.duration, bestResult.coordinates, bestNote ?? undefined));
      } else {
        const coords = directResult?.coordinates ?? [[lng, lat], [endLng, endLat]];
        const dur = directResult?.duration ?? (directKm / speedKmh) * 3600;
        res.json(buildResult(directResult?.distance ?? directKm * 1000, dur, coords, "Could not find a detour — showing direct route."));
      }
      return;
    }

    res.status(400).json({ error: "Invalid mode" });
  } catch (err) {
    req.log.error({ err }, "Failed to generate route");
    res.status(500).json({ error: "Failed to generate walking route" });
  }
});

router.post("/routes", async (req, res): Promise<void> => {
  const parsed = SaveWalkingRouteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  try {
    const [route] = await db
      .insert(walkingRoutesTable)
      .values({
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
      })
      .returning();

    res.status(201).json({
      id: route.id,
      user_id: route.userId,
      start_location: route.startLocation,
      target_type: route.targetType,
      target_value: route.targetValue ? parseFloat(route.targetValue) : null,
      generated_route: route.generatedRoute,
      distance_km: parseFloat(route.distanceKm),
      duration_min: parseFloat(route.durationMin),
      estimated_calories: parseFloat(route.estimatedCalories),
      completed: route.completed,
      actual_calories: route.actualCalories ? parseFloat(route.actualCalories) : null,
      created_at: route.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save walking route");
    res.status(500).json({ error: "Failed to save route" });
  }
});

router.get("/routes/history", async (req, res): Promise<void> => {
  const parsed = GetRouteHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId } = parsed.data;

  try {
    const routes = await db
      .select()
      .from(walkingRoutesTable)
      .where(eq(walkingRoutesTable.userId, userId))
      .orderBy(desc(walkingRoutesTable.createdAt))
      .limit(20);

    res.json(
      routes.map((r) => ({
        id: r.id,
        user_id: r.userId,
        start_location: r.startLocation,
        target_type: r.targetType,
        target_value: r.targetValue ? parseFloat(r.targetValue) : null,
        generated_route: r.generatedRoute,
        distance_km: parseFloat(r.distanceKm),
        duration_min: parseFloat(r.durationMin),
        estimated_calories: parseFloat(r.estimatedCalories),
        completed: r.completed,
        actual_calories: r.actualCalories ? parseFloat(r.actualCalories) : null,
        created_at: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch route history");
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

export default router;
