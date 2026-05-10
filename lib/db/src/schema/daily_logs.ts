import { pgTable, text, uuid, date, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyLogsTable = pgTable("daily_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  date: date("date").notNull(),
  weightKg: numeric("weight_kg"),
  meals: jsonb("meals").default([]),
  workouts: jsonb("workouts").default([]),
  waterLiters: numeric("water_liters"),
  sleepHours: numeric("sleep_hours"),
  mood: text("mood"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyLogSchema = createInsertSchema(dailyLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyLog = z.infer<typeof insertDailyLogSchema>;
export type DailyLog = typeof dailyLogsTable.$inferSelect;
