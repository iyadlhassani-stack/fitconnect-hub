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

router.post("/routes/generate", async (req, res): Promise<void> => {
  const parsed = GenerateWalkingRoutesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { lat, lng, targetType, targetValue, pace, weightKg } = parsed.data;

  const speedKmh = SPEED[pace] ?? 5;
  const met = MET[pace] ?? 3.5;

  let distanceKm: number;
  let durationMin: number;

  if (targetType === "calories") {
    // calories = MET * weight * (duration_h) => duration_h = calories / (MET * weight)
    const durationH = Number(targetValue) / (met * Number(weightKg));
    durationMin = Math.round(durationH * 60);
    distanceKm = durationH * speedKmh;
  } else if (targetType === "minutes") {
    durationMin = Number(targetValue);
    distanceKm = (durationMin / 60) * speedKmh;
  } else {
    distanceKm = Number(targetValue);
    durationMin = Math.round((distanceKm / speedKmh) * 60);
  }

  const distanceM = Math.round(distanceKm * 1000);
  const estimatedCalories = Math.round(met * Number(weightKg) * (durationMin / 60));

  const orsKey = process.env.VITE_OPENROUTESERVICE_API_KEY;

  if (!orsKey) {
    req.log.warn("No ORS API key, returning mock routes");
    const mockRoutes = [1, 2, 3].map((seed) => ({
      distance_km: parseFloat((distanceKm * (0.9 + seed * 0.05)).toFixed(2)),
      duration_min: Math.round(durationMin * (0.9 + seed * 0.05)),
      estimated_calories: Math.round(estimatedCalories * (0.9 + seed * 0.05)),
      geojson: {
        type: "LineString",
        coordinates: [
          [lng, lat],
          [lng + 0.005 * seed, lat + 0.003],
          [lng + 0.008, lat + 0.007 * seed],
          [lng + 0.003, lat + 0.010],
          [lng, lat],
        ],
      },
    }));
    res.json(mockRoutes);
    return;
  }

  try {
    const routes = await Promise.all(
      [1, 2, 3].map(async (seed) => {
        const body = {
          coordinates: [[lng, lat]],
          options: {
            round_trip: {
              length: distanceM,
              points: 3,
              seed,
            },
          },
        };

        const response = await fetch(
          "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: orsKey,
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          req.log.warn({ status: response.status, text }, "ORS API error");
          return null;
        }

        const data = (await response.json()) as {
          features?: Array<{
            geometry: { type: string; coordinates: number[][] };
            properties: { summary: { distance: number; duration: number } };
          }>;
        };

        if (!data.features?.[0]) return null;

        const feature = data.features[0];
        const summary = feature.properties.summary;
        const actualDistanceKm = summary.distance / 1000;
        const actualDurationMin = Math.round(summary.duration / 60);
        const actualCalories = Math.round(met * Number(weightKg) * (actualDurationMin / 60));

        return {
          distance_km: parseFloat(actualDistanceKm.toFixed(2)),
          duration_min: actualDurationMin,
          estimated_calories: actualCalories,
          geojson: feature.geometry,
        };
      })
    );

    const validRoutes = routes.filter(Boolean);

    if (validRoutes.length === 0) {
      // Fallback to mock
      const mockRoutes = [1, 2, 3].map((seed) => ({
        distance_km: parseFloat((distanceKm * (0.9 + seed * 0.05)).toFixed(2)),
        duration_min: Math.round(durationMin * (0.9 + seed * 0.05)),
        estimated_calories: Math.round(estimatedCalories * (0.9 + seed * 0.05)),
        geojson: {
          type: "LineString",
          coordinates: [
            [lng, lat],
            [lng + 0.005 * seed, lat + 0.003],
            [lng + 0.008, lat + 0.007 * seed],
            [lng + 0.003, lat + 0.010],
            [lng, lat],
          ],
        },
      }));
      res.json(mockRoutes);
      return;
    }

    res.json(validRoutes);
  } catch (err) {
    req.log.error({ err }, "Failed to generate routes");
    res.status(500).json({ error: "Failed to generate walking routes" });
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
