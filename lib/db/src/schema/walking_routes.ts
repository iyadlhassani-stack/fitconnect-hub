import { pgTable, text, uuid, numeric, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWalkingRouteSchema = createInsertSchema(walkingRoutesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWalkingRoute = z.infer<typeof insertWalkingRouteSchema>;
export type WalkingRoute = typeof walkingRoutesTable.$inferSelect;
