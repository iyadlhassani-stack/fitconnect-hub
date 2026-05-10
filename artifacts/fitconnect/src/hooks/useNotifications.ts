import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import { streakCheck } from "@workspace/api-client-react";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(onesignal: OneSignalNamespace) => void>;
  }
  interface OneSignalNamespace {
    init: (opts: { appId: string; allowLocalhostAsSecureOrigin?: boolean; serviceWorkerParam?: { scope: string } }) => Promise<void>;
    isPushNotificationsEnabled: () => Promise<boolean>;
    isPushNotificationsSupported: () => boolean;
    getSubscription: () => Promise<{ id: string | null }>;
    User: { PushSubscription: { optIn: () => Promise<void>; optOut: () => Promise<void>; id: string | null } };
    login: (userId: string) => Promise<void>;
    Notifications: { requestPermission: () => Promise<boolean>; permissionNative: string };
  }
}

const PLAYER_ID_KEY = "fc_onesignal_player_id";
const LAST_CHECK_KEY = "fc_last_streak_check";

export function useNotifications() {
  const profile = useAppStore((s) => s.profile);
  const initialized = useRef(false);

  const getOrFetchPlayerId = (): string | null => {
    return localStorage.getItem(PLAYER_ID_KEY);
  };

  const initOneSignal = async () => {
    const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
    if (!appId || initialized.current) return;

    initialized.current = true;

    window.OneSignalDeferred = window.OneSignalDeferred ?? [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerParam: { scope: "/" },
        });

        // Try to get player ID after init
        const subscription = OneSignal.User?.PushSubscription;
        if (subscription?.id) {
          localStorage.setItem(PLAYER_ID_KEY, subscription.id);
          if (profile?.id) {
            await supabase.from("profiles").update({ onesignal_player_id: subscription.id }).eq("id", profile.id);
          }
        }
      } catch (err) {
        console.warn("OneSignal init error:", err);
      }
    });
  };

  const requestPermission = async (): Promise<string | null> => {
    const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
    if (!appId) return null;

    return new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred ?? [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          if (!OneSignal.Notifications.permissionNative || OneSignal.Notifications.permissionNative === "default") {
            await OneSignal.Notifications.requestPermission();
          }
          await OneSignal.User?.PushSubscription?.optIn();

          // Wait a tick for ID to be assigned
          await new Promise((r) => setTimeout(r, 1500));

          const playerId = OneSignal.User?.PushSubscription?.id ?? null;
          if (playerId) {
            localStorage.setItem(PLAYER_ID_KEY, playerId);
            if (profile?.id) {
              await supabase.from("profiles").update({ onesignal_player_id: playerId }).eq("id", profile.id);
            }
          }
          resolve(playerId);
        } catch (err) {
          console.warn("OneSignal permission error:", err);
          resolve(null);
        }
      });
    });
  };

  const runStreakCheck = async () => {
    if (!profile?.id) return;

    // Throttle: only run once per hour
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    const now = Date.now();
    if (lastCheck && now - parseInt(lastCheck) < 60 * 60 * 1000) return;
    localStorage.setItem(LAST_CHECK_KEY, String(now));

    const playerId = getOrFetchPlayerId();
    const playerIds = playerId ? [playerId] : [];

    // Also check profile for stored player ID
    const profilePlayerId = (profile as Record<string, unknown>).onesignal_player_id as string | undefined;
    if (profilePlayerId && !playerIds.includes(profilePlayerId)) {
      playerIds.push(profilePlayerId);
    }

    if (!playerIds.length) return;

    try {
      await streakCheck({
        userId: profile.id,
        playerIds,
        language: profile.language ?? "en",
        currentHour: new Date().getHours(),
      });
    } catch {
      // Non-critical, swallow error
    }
  };

  // Initialize OneSignal on mount
  useEffect(() => {
    initOneSignal();
  }, []);

  // Run streak check when profile becomes available, and periodically
  useEffect(() => {
    if (!profile?.id) return;

    runStreakCheck();

    // Re-check every hour
    const interval = setInterval(runStreakCheck, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [profile?.id]);

  return { requestPermission, getPlayerId: getOrFetchPlayerId };
}
