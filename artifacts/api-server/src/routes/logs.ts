import { Router } from "express";
import { eq, and, gte, desc } from "drizzle-orm";
import { db, dailyLogsTable } from "@workspace/db";
import {
  GetTodayLogQueryParams,
  UpsertDailyLogBody,
  GetLogsHistoryQueryParams,
  GetUserStatsQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/logs/today", async (req, res): Promise<void> => {
  const parsed = GetTodayLogQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, date } = parsed.data;
  const targetDate = date ?? new Date().toISOString().split("T")[0];

  try {
    const [log] = await db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.userId, userId), eq(dailyLogsTable.date, targetDate)))
      .limit(1);

    if (!log) {
      const emptyLog = {
        id: `temp-${Date.now()}`,
        user_id: userId,
        date: targetDate,
        weight_kg: null,
        meals: [],
        workouts: [],
        water_liters: null,
        sleep_hours: null,
        mood: null,
        notes: null,
        created_at: new Date().toISOString(),
      };
      res.json(emptyLog);
      return;
    }

    res.json({
      id: log.id,
      user_id: log.userId,
      date: log.date,
      weight_kg: log.weightKg ? parseFloat(log.weightKg) : null,
      meals: log.meals ?? [],
      workouts: log.workouts ?? [],
      water_liters: log.waterLiters ? parseFloat(log.waterLiters) : null,
      sleep_hours: log.sleepHours ? parseFloat(log.sleepHours) : null,
      mood: log.mood,
      notes: log.notes,
      created_at: log.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch today log");
    res.status(500).json({ error: "Failed to fetch log" });
  }
});

router.post("/logs", async (req, res): Promise<void> => {
  const parsed = UpsertDailyLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  try {
    const [existing] = await db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.userId, data.user_id), eq(dailyLogsTable.date, data.date)))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(dailyLogsTable)
        .set({
          weightKg: data.weight_kg != null ? String(data.weight_kg) : existing.weightKg,
          meals: (data.meals as unknown[]) ?? existing.meals,
          workouts: (data.workouts as unknown[]) ?? existing.workouts,
          waterLiters: data.water_liters != null ? String(data.water_liters) : existing.waterLiters,
          sleepHours: data.sleep_hours != null ? String(data.sleep_hours) : existing.sleepHours,
          mood: data.mood ?? existing.mood,
          notes: data.notes ?? existing.notes,
        })
        .where(eq(dailyLogsTable.id, existing.id))
        .returning();

      res.json({
        id: updated.id,
        user_id: updated.userId,
        date: updated.date,
        weight_kg: updated.weightKg ? parseFloat(updated.weightKg) : null,
        meals: updated.meals ?? [],
        workouts: updated.workouts ?? [],
        water_liters: updated.waterLiters ? parseFloat(updated.waterLiters) : null,
        sleep_hours: updated.sleepHours ? parseFloat(updated.sleepHours) : null,
        mood: updated.mood,
        notes: updated.notes,
        created_at: updated.createdAt.toISOString(),
      });
    } else {
      const [created] = await db
        .insert(dailyLogsTable)
        .values({
          userId: data.user_id,
          date: data.date,
          weightKg: data.weight_kg != null ? String(data.weight_kg) : null,
          meals: (data.meals as unknown[]) ?? [],
          workouts: (data.workouts as unknown[]) ?? [],
          waterLiters: data.water_liters != null ? String(data.water_liters) : null,
          sleepHours: data.sleep_hours != null ? String(data.sleep_hours) : null,
          mood: data.mood ?? null,
          notes: data.notes ?? null,
        })
        .returning();

      res.json({
        id: created.id,
        user_id: created.userId,
        date: created.date,
        weight_kg: created.weightKg ? parseFloat(created.weightKg) : null,
        meals: created.meals ?? [],
        workouts: created.workouts ?? [],
        water_liters: created.waterLiters ? parseFloat(created.waterLiters) : null,
        sleep_hours: created.sleepHours ? parseFloat(created.sleepHours) : null,
        mood: created.mood,
        notes: created.notes,
        created_at: created.createdAt.toISOString(),
      });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to upsert daily log");
    res.status(500).json({ error: "Failed to save log" });
  }
});

router.get("/logs/history", async (req, res): Promise<void> => {
  const parsed = GetLogsHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, days = 30 } = parsed.data;
  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  const sinceDate = since.toISOString().split("T")[0];

  try {
    const logs = await db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.userId, userId), gte(dailyLogsTable.date, sinceDate)))
      .orderBy(desc(dailyLogsTable.date));

    res.json(
      logs.map((log) => ({
        id: log.id,
        user_id: log.userId,
        date: log.date,
        weight_kg: log.weightKg ? parseFloat(log.weightKg) : null,
        meals: log.meals ?? [],
        workouts: log.workouts ?? [],
        water_liters: log.waterLiters ? parseFloat(log.waterLiters) : null,
        sleep_hours: log.sleepHours ? parseFloat(log.sleepHours) : null,
        mood: log.mood,
        notes: log.notes,
        created_at: log.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch log history");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.get("/logs/stats", async (req, res): Promise<void> => {
  const parsed = GetUserStatsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId } = parsed.data;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sinceDate = thirtyDaysAgo.toISOString().split("T")[0];

    const logs = await db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.userId, userId), gte(dailyLogsTable.date, sinceDate)))
      .orderBy(desc(dailyLogsTable.date));

    let totalCalories = 0;
    let totalProtein = 0;
    let totalWorkouts = 0;
    let thisWeekCalories = 0;
    let thisWeekWorkouts = 0;
    let streakCount = 0;
    const weightTrend: Array<{ date: string; weight_kg: number }> = [];

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const today = new Date().toISOString().split("T")[0];
    let currentDate = today;
    let prevDate: string | null = null;

    for (const log of logs) {
      const meals = (log.meals as Array<{ calories?: number; protein?: number }>) ?? [];
      const workouts = (log.workouts as Array<{ calories_burned?: number }>) ?? [];

      const dayCalories = meals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
      const dayProtein = meals.reduce((sum, m) => sum + (m.protein ?? 0), 0);
      const dayWorkoutCount = workouts.length;

      totalCalories += dayCalories;
      totalProtein += dayProtein;
      totalWorkouts += dayWorkoutCount;

      if (new Date(log.date) >= weekAgo) {
        thisWeekCalories += dayCalories;
        thisWeekWorkouts += dayWorkoutCount;
      }

      if (log.weightKg) {
        weightTrend.push({ date: log.date, weight_kg: parseFloat(log.weightKg) });
      }

      // Streak calculation
      if (prevDate === null && log.date === currentDate) {
        streakCount = 1;
        prevDate = log.date;
      } else if (prevDate !== null) {
        const prev = new Date(prevDate);
        const curr = new Date(log.date);
        const diff = Math.round((prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          streakCount++;
          prevDate = log.date;
        } else {
          break;
        }
      }
    }

    const count = logs.length || 1;

    res.json({
      streak_count: streakCount,
      total_logs: logs.length,
      avg_daily_calories: Math.round(totalCalories / count),
      avg_daily_protein: Math.round(totalProtein / count),
      total_workouts: totalWorkouts,
      this_week_calories: thisWeekCalories,
      this_week_workouts: thisWeekWorkouts,
      weight_trend: weightTrend.slice(0, 30).reverse(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute stats");
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

export default router;
