import { Router } from "express";
import {
  SubscribeNotificationsBody,
  SendPushNotificationBody,
} from "@workspace/api-zod";

const router = Router();

router.post("/notifications/subscribe", async (req, res): Promise<void> => {
  const parsed = SubscribeNotificationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { userId, playerId } = parsed.data;
  req.log.info({ userId, playerId }, "User subscribed to notifications");
  // Player ID would normally be saved to the user's profile in Supabase
  // The frontend handles Supabase directly for profile updates
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
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: message },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      req.log.error({ status: response.status, text }, "OneSignal API error");
      res.status(500).json({ success: false, message: "Push notification failed" });
      return;
    }

    res.json({ success: true, message: "Notification sent" });
  } catch (err) {
    req.log.error({ err }, "Failed to send push notification");
    res.status(500).json({ success: false, message: "Failed to send notification" });
  }
});

export default router;
