import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, walkingRoutesTable } from "@workspace/db";
import {
  GenerateWalkingRoutesBody,
  SaveWalkingRouteBody,
  GetRouteHistoryQueryParams,
} from "@workspace/api-zod";
import { findPOIsForRoute } from "../services/poiService";

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

  const {
    mode = "loop",
    lat, lng, endLat, endLng,
    targetType, targetValue, pace, weightKg, seed,
    enablePOI, poiCategories, language,
  } = parsed.data;

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
  const categories = Array.isArray(poiCategories) ? poiCategories as string[] : [];
  const shouldFindPOIs =
    mode !== 'custom' &&
    (enablePOI ?? true) !== false &&
    categories.length > 0;

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

  // ── POI discovery pipeline (runs after any non-custom route) ─────────────
  const withPOIs = async (
    base: ReturnType<typeof buildResult>,
    baseCoords: number[][]
  ): Promise<object> => {
    if (!shouldFindPOIs || baseCoords.length < 2) {
      return { ...base, pois: null };
    }
    try {
      const poiResult = await Promise.race([
        findPOIsForRoute({
          baseCoordinates: baseCoords,
          mode,
          startLng: lng,
          startLat: lat,
          endLng: endLng ?? lng,
          endLat: endLat ?? lat,
          goalKm: targetKm,
          categories,
          language: (language as string) ?? 'en',
          orsKey,
        }),
        new Promise<{ pois: never[]; enhancedRoute: null }>((resolve) =>
          setTimeout(() => resolve({ pois: [], enhancedRoute: null }), 7000)
        ),
      ]);

      if (poiResult.enhancedRoute) {
        const er = poiResult.enhancedRoute;
        return {
          ...buildResult(er.distance, er.duration, er.coordinates),
          pois: poiResult.pois,
        };
      }
      return { ...base, pois: poiResult.pois };
    } catch {
      return { ...base, pois: [] };
    }
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
        const base = mockLoop();
        res.json({ ...base, pois: null });
        return;
      }

      const result = await callORS(
        [[lng, lat]],
        { round_trip: { length: Math.round(targetKm * 1000), points: 5, seed: usedSeed } },
        orsKey
      );

      if (!result) {
        req.log.warn("ORS loop failed, using mock");
        const base = mockLoop();
        res.json({ ...base, pois: null });
        return;
      }

      const base = buildResult(result.distance, result.duration, result.coordinates);
      res.json(await withPOIs(base, result.coordinates));
      return;
    }

    if (mode === "direct") {
      if (endLat == null || endLng == null) {
        res.status(400).json({ error: "End coordinates required for direct mode" });
        return;
      }

      if (!orsKey) {
        const d = haversineKm(lat, lng, endLat, endLng);
        const base = buildResult(d * 1000, (d / speedKmh) * 3600, [[lng, lat], [endLng, endLat]], "Direct route shown.");
        res.json({ ...base, pois: null });
        return;
      }

      const result = await callORS([[lng, lat], [endLng, endLat]], null, orsKey);

      if (!result) {
        req.log.warn("ORS direct failed");
        const d = haversineKm(lat, lng, endLat, endLng);
        const base = buildResult(d * 1000, (d / speedKmh) * 3600, [[lng, lat], [endLng, endLat]], "This is the direct route between your points.");
        res.json({ ...base, pois: null });
        return;
      }

      const base = buildResult(result.distance, result.duration, result.coordinates, "This is the direct route between your points.");
      res.json(await withPOIs(base, result.coordinates));
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
        const base = buildResult(targetKm * 1000, (targetKm / speedKmh) * 3600, mockCoords);
        res.json({ ...base, pois: null });
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
        const base = buildResult(dist, dur, coords, `Direct route already covers ${directKm.toFixed(1)} km (target: ${targetKm.toFixed(1)} km).`);
        res.json(await withPOIs(base, coords));
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
            const base = buildResult(result.distance, result.duration, result.coordinates);
            res.json(await withPOIs(base, result.coordinates));
            return;
          }

          if (!bestResult || Math.abs(actualKm - targetKm) < Math.abs((bestResult.distance / 1000) - targetKm)) {
            bestResult = result;
            bestNote = `Route is approximate (${actualKm.toFixed(1)} km, target was ${targetKm.toFixed(1)} km)`;
          }
        }
      }

      if (bestResult) {
        const base = buildResult(bestResult.distance, bestResult.duration, bestResult.coordinates, bestNote ?? undefined);
        res.json(await withPOIs(base, bestResult.coordinates));
      } else {
        const coords = directResult?.coordinates ?? [[lng, lat], [endLng, endLat]];
        const dur = directResult?.duration ?? (directKm / speedKmh) * 3600;
        const base = buildResult(directResult?.distance ?? directKm * 1000, dur, coords, "Could not find a detour — showing direct route.");
        res.json(await withPOIs(base, coords));
      }
      return;
    }

    if (mode === 'custom') {
      const waypoints = parsed.data.waypoints as Array<{ lat: number; lng: number }> | null | undefined;
      if (!waypoints || waypoints.length < 2) {
        res.status(400).json({ error: 'Custom mode requires at least 2 waypoints (start and end).' });
        return;
      }

      const orsCoords: [number, number][] = waypoints.map((w) => [w.lng, w.lat]);
      const lastW = waypoints[waypoints.length - 1];

      if (!orsKey) {
        let totalKm = 0;
        for (let i = 1; i < waypoints.length; i++) {
          totalKm += haversineKm(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
        }
        const durationS = (totalKm / speedKmh) * 3600;
        res.json({
          ...buildResult(totalKm * 1000, durationS, orsCoords, 'Custom route through your chosen stops.'),
          end_coords: { lat: lastW.lat, lng: lastW.lng },
          pois: null,
        });
        return;
      }

      const result = await callORS(orsCoords, null, orsKey);
      if (!result) {
        req.log.warn('ORS custom route failed');
        res.status(500).json({ error: 'Failed to generate custom route. Try adjusting your stops.' });
        return;
      }

      res.json({
        ...buildResult(result.distance, result.duration, result.coordinates, 'Custom route through your chosen stops.'),
        end_coords: { lat: lastW.lat, lng: lastW.lng },
        pois: null,
      });
      return;
    }

    res.status(400).json({ error: 'Invalid mode' });
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
        poisIncluded: (data.pois_included as unknown as Record<string, unknown>[]) ?? null,
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
      pois_included: route.poisIncluded ?? null,
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
        pois_included: r.poisIncluded ?? null,
        created_at: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch route history");
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

export default router;
