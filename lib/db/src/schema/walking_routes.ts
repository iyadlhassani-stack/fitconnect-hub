import { pgTable, text, uuid, numeric, boolean, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walkingRoutesTable = pgTable("walking_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  startLocation: jsonb("start_location"),
  targetType: text("target_type"),
  targetValue: numeric("target_value"),
  generatedRoute: jsonb("generated_route"),
  distanceKm: numeric("distance_km").notNull(),
  durationMin: numeric("duration_min").notNull(),
  estimatedCalories: numeric("estimated_calories").notNull(),
  completed: boolean("completed").default(false),
  actualCalories: numeric("actual_calories"),
  actualDistanceKm: numeric("actual_distance_km"),
  actualDurationSec: integer("actual_duration_sec"),
  gpsTrack: jsonb("gps_track"),
  averageSpeedKmh: numeric("average_speed_kmh"),
  pausesCount: integer("pauses_count"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalkingRouteSchema = createInsertSchema(walkingRoutesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWalkingRoute = z.infer<typeof insertWalkingRouteSchema>;
export type WalkingRoute = typeof walkingRoutesTable.$inferSelect;
