import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, dailyLogsTable } from "@workspace/db";
import {
  SubscribeNotificationsBody,
  SendPushNotificationBody,
  StreakCheckBody,
} from "@workspace/api-zod";

// Suppress unused-import lint — StreakCheckBody used below via .safeParse
void StreakCheckBody;

const router = Router();

async function sendOneSignalPush(
  appId: string,
  apiKey: string,
  playerIds: string[],
  title: string,
  message: string,
  language: string
): Promise<boolean> {
  const response = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_player_ids: playerIds,
      headings: { [language]: title, en: title },
      contents: { [language]: message, en: message },
      priority: 10,
    }),
  });
  return response.ok;
}

router.post("/notifications/subscribe", async (req, res): Promise<void> => {
  const parsed = SubscribeNotificationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, playerId } = parsed.data;
  req.log.info({ userId, playerId }, "User subscribed to notifications");
  res.json({ success: true, message: "Subscribed successfully" });
});

router.post("/notifications/send", async (req, res): Promise<void> => {
  const parsed = SendPushNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { playerId, title, message } = parsed.data;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  const appId = process.env.VITE_ONESIGNAL_APP_ID;

  if (!apiKey || !appId) {
    req.log.warn("OneSignal not configured, skipping push");
    res.json({ success: true, message: "Push not configured" });
    return;
  }

  try {
    const ok = await sendOneSignalPush(appId, apiKey, [playerId], title, message, "en");
    if (!ok) {
      res.status(500).json({ success: false, message: "Push notification failed" });
      return;
    }
    res.json({ success: true, message: "Notification sent" });
  } catch (err) {
    req.log.error({ err }, "Failed to send push notification");
    res.status(500).json({ success: false, message: "Failed to send notification" });
  }
});

router.post("/notifications/streak-check", async (req, res): Promise<void> => {
  const parsed = StreakCheckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, playerIds, language, currentHour } = parsed.data;
  const today = new Date().toISOString().split("T")[0];
  const hour = currentHour ?? new Date().getHours();

  // Only send reminders between 18:00–22:00 local time
  if (hour < 18 || hour >= 22) {
    res.json({ hasLoggedToday: false, notificationSent: false, message: "Outside reminder window" });
    return;
  }

  try {
    // Check if user logged anything today
    const [log] = await db
      .select()
      .from(dailyLogsTable)
      .where(and(eq(dailyLogsTable.userId, userId), eq(dailyLogsTable.date, today)))
      .limit(1);

    const meals = (log?.meals as unknown[]) ?? [];
    const workouts = (log?.workouts as unknown[]) ?? [];
    const hasLoggedToday = meals.length > 0 || workouts.length > 0;

    if (hasLoggedToday) {
      res.json({ hasLoggedToday: true, notificationSent: false, message: "Already logged today" });
      return;
    }

    // User has not logged today — send streak-protection notification
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    const appId = process.env.VITE_ONESIGNAL_APP_ID;

    if (!apiKey || !appId || !playerIds.length) {
      res.json({ hasLoggedToday: false, notificationSent: false, message: "Push not configured" });
      return;
    }

    const isFr = language === "fr";
    const title = isFr ? "🔥 Ne brise pas ta série !" : "🔥 Don't break your streak!";
    const body = isFr
      ? `Tu n'as pas encore enregistré de repas aujourd'hui. Ouvre FitConnect pour maintenir ta série !`
      : `You haven't logged any meals today. Open FitConnect to keep your streak going!`;

    const ok = await sendOneSignalPush(appId, apiKey, playerIds, title, body, language);
    req.log.info({ userId, notificationSent: ok }, "Streak protection notification sent");

    res.json({ hasLoggedToday: false, notificationSent: ok, message: ok ? "Reminder sent" : "Push failed" });
  } catch (err) {
    req.log.error({ err }, "Streak check error");
    res.status(500).json({ hasLoggedToday: false, notificationSent: false, message: "Server error" });
  }
});

export default router;
