import { useState, useRef, useCallback, useEffect } from 'react';
import { haversineKm, metForSpeed } from '../utils/geoUtils';

export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed: number;
  accuracy: number;
}

export interface TrackingState {
  isRunning: boolean;
  isPaused: boolean;
  distanceKm: number;
  elapsedSec: number;
  currentSpeedKmh: number;
  avgSpeedKmh: number;
  calories: number;
  pausesCount: number;
  track: TrackPoint[];
  currentPos: { lat: number; lng: number } | null;
  currentAccuracy: number;
  gpsWeak: boolean;
  gpsLost: boolean;
  autoPaused: boolean;
}

const INITIAL_STATE: TrackingState = {
  isRunning: false, isPaused: false,
  distanceKm: 0, elapsedSec: 0,
  currentSpeedKmh: 0, avgSpeedKmh: 0,
  calories: 0, pausesCount: 0,
  track: [], currentPos: null,
  currentAccuracy: 0, gpsWeak: false, gpsLost: false, autoPaused: false,
};

export function useTracking(weightKg: number) {
  const [state, setState] = useState<TrackingState>(INITIAL_STATE);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<TrackPoint | null>(null);
  const recentSpeedsRef = useRef<{ speed: number; ts: number }[]>([]);
  const autoPausedRef = useRef(false);
  const isPausedRef = useRef(false);
  const manualPauseRef = useRef(false);
  const trackRef = useRef<TrackPoint[]>([]);
  const distanceRef = useRef(0);
  const caloriesRef = useRef(0);
  const elapsedRef = useRef(0);
  const gpsLostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setState(INITIAL_STATE);
    trackRef.current = [];
    distanceRef.current = 0;
    caloriesRef.current = 0;
    elapsedRef.current = 0;
    lastPosRef.current = null;
    recentSpeedsRef.current = [];
    autoPausedRef.current = false;
    isPausedRef.current = false;
    manualPauseRef.current = false;

    setState((s) => ({ ...s, isRunning: true }));

    timerRef.current = setInterval(() => {
      if (!isPausedRef.current) {
        elapsedRef.current += 1;
        const distKm = distanceRef.current;
        const elapsed = elapsedRef.current;
        const avgSpd = elapsed > 0 ? (distKm / elapsed) * 3600 : 0;
        setState((s) => ({
          ...s,
          elapsedSec: elapsed,
          avgSpeedKmh: Math.round(avgSpd * 10) / 10,
          calories: caloriesRef.current,
        }));
      }
    }, 1000);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
        if (accuracy > 100) return;
        if (gpsLostTimerRef.current) { clearTimeout(gpsLostTimerRef.current); gpsLostTimerRef.current = null; }
        const gpsWeak = accuracy > 50;
        const speedKmh = speed != null ? speed * 3.6 : 0;
        const now = Date.now();
        const pt: TrackPoint = { lat, lng, timestamp: now, speed: speedKmh, accuracy };

        let addedDistKm = 0;
        if (lastPosRef.current && !isPausedRef.current) {
          const d = haversineKm(lastPosRef.current.lat, lastPosRef.current.lng, lat, lng);
          if (d < 0.5) {
            distanceRef.current += d;
            addedDistKm = d;
          }
        }

        if (!isPausedRef.current) {
          const elapsedHours = elapsedRef.current / 3600;
          const met = metForSpeed(speedKmh);
          caloriesRef.current = Math.round(met * weightKg * elapsedHours);

          recentSpeedsRef.current.push({ speed: speedKmh, ts: now });
          recentSpeedsRef.current = recentSpeedsRef.current.filter((p) => now - p.ts < 30000);
          const avgRecent = recentSpeedsRef.current.reduce((a, b) => a + b.speed, 0) / Math.max(recentSpeedsRef.current.length, 1);

          if (!manualPauseRef.current && avgRecent < 0.5 && recentSpeedsRef.current.length >= 5) {
            if (!autoPausedRef.current) {
              autoPausedRef.current = true;
              isPausedRef.current = true;
              setState((s) => ({ ...s, autoPaused: true, isPaused: true }));
            }
          } else if (autoPausedRef.current && avgRecent > 1.0) {
            autoPausedRef.current = false;
            isPausedRef.current = false;
            setState((s) => ({ ...s, autoPaused: false, isPaused: false }));
          }
        }

        trackRef.current.push(pt);
        lastPosRef.current = pt;

        gpsLostTimerRef.current = setTimeout(() => {
          setState((s) => ({ ...s, gpsLost: true }));
        }, 30000);

        setState((s) => ({
          ...s,
          currentPos: { lat, lng },
          currentAccuracy: accuracy,
          gpsWeak,
          gpsLost: false,
          currentSpeedKmh: Math.round(speedKmh * 10) / 10,
          distanceKm: Math.round(distanceRef.current * 1000) / 1000,
          track: [...trackRef.current],
        }));
        void addedDistKm;
      },
      (err) => {
        console.warn('GPS error:', err.code);
        gpsLostTimerRef.current = setTimeout(() => {
          setState((s) => ({ ...s, gpsLost: true }));
        }, 5000);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }, [weightKg]);

  const pause = useCallback(() => {
    manualPauseRef.current = true;
    isPausedRef.current = true;
    setState((s) => ({ ...s, isPaused: true, autoPaused: false, pausesCount: s.pausesCount + 1 }));
  }, []);

  const resume = useCallback(() => {
    manualPauseRef.current = false;
    autoPausedRef.current = false;
    isPausedRef.current = false;
    setState((s) => ({ ...s, isPaused: false, autoPaused: false }));
  }, []);

  const stop = useCallback((): TrackingState => {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (gpsLostTimerRef.current) clearTimeout(gpsLostTimerRef.current);
    const finalState: TrackingState = {
      ...state,
      isRunning: false,
      isPaused: false,
      distanceKm: distanceRef.current,
      elapsedSec: elapsedRef.current,
      calories: caloriesRef.current,
      track: trackRef.current,
      avgSpeedKmh: elapsedRef.current > 0 ? Math.round((distanceRef.current / elapsedRef.current) * 3600 * 10) / 10 : 0,
    };
    setState(finalState);
    return finalState;
  }, [state]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (gpsLostTimerRef.current) clearTimeout(gpsLostTimerRef.current);
    };
  }, []);

  return { state, start, pause, resume, stop };
}
