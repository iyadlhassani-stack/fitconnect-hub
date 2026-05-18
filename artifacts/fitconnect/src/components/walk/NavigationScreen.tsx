import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTracking } from '../../hooks/useTracking';
import type { TrackingState } from '../../hooks/useTracking';
import { formatDuration, distanceToRouteKm, bearingDeg } from '../../utils/geoUtils';
import { speak, vibrate } from '../../services/voiceService';

interface OrsStep {
  instruction: string;
  distance: number;
  type: number;
}

interface NavigationScreenProps {
  geojsonCoords: [number, number][];
  orsSteps: OrsStep[];
  weightKg: number;
  totalDistanceKm: number;
  voiceEnabled: boolean;
  keepScreenOn: boolean;
  lang: string;
  onStop: (finalState: TrackingState) => void;
}

function MapController({ pos, heading }: { pos: [number, number] | null; heading: number }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.panTo(pos, { animate: true, duration: 1 });
  }, [pos, map]);
  void heading;
  return null;
}

function userIcon(heading: number) {
  return new L.DivIcon({
    html: `<div style="position:relative;width:40px;height:40px">
      <div style="position:absolute;inset:0;background:#00B8D4;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);animation:pulse 2s infinite"></div>
      <div style="position:absolute;top:50%;left:50%;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #00B8D4;transform:translate(-50%,-100%) rotate(${heading}deg);transform-origin:center bottom"></div>
    </div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function NavigationScreen({
  geojsonCoords, orsSteps, weightKg, totalDistanceKm, voiceEnabled, keepScreenOn, lang, onStop,
}: NavigationScreenProps) {
  const { t } = useTranslation();
  const { state, start, pause, resume, stop } = useTracking(weightKg);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showOffRoute, setShowOffRoute] = useState(false);
  const [offRouteIgnored, setOffRouteIgnored] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [heading, setHeading] = useState(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const offRouteCountRef = useRef(0);
  const announced50Ref = useRef<Set<number>>(new Set());
  const announced0Ref = useRef<Set<number>>(new Set());

  const routeLatLngs: [number, number][] = geojsonCoords.map(([lng, lat]) => [lat, lng]);

  const currentPos = state.currentPos
    ? ([state.currentPos.lat, state.currentPos.lng] as [number, number])
    : null;

  useEffect(() => {
    start();
    if (keepScreenOn && 'wakeLock' in navigator) {
      (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } })
        .wakeLock.request('screen').then((lock) => { wakeLockRef.current = lock; }).catch(() => {});
    }
    return () => {
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && keepScreenOn && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen');
        } catch { /* graceful */ }
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, [keepScreenOn]);

  useEffect(() => {
    if (!state.currentPos || state.track.length < 2) return;
    const track = state.track;
    const prev = track[track.length - 2];
    const curr = track[track.length - 1];
    if (prev && curr) setHeading(bearingDeg(prev.lat, prev.lng, curr.lat, curr.lng));

    if (!offRouteIgnored && geojsonCoords.length > 1) {
      const distToRoute = distanceToRouteKm(state.currentPos.lat, state.currentPos.lng, geojsonCoords);
      if (distToRoute > 0.05) {
        offRouteCountRef.current += 1;
        if (offRouteCountRef.current >= 3 && !showOffRoute) {
          setShowOffRoute(true);
          vibrate([300, 100, 300, 100, 300]);
          if (voiceEnabled) speak(t('walk.nav_off_route'), lang);
        }
      } else {
        offRouteCountRef.current = 0;
      }
    }

    if (orsSteps.length > 0) {
      let accumulated = 0;
      for (let i = 0; i < orsSteps.length; i++) {
        accumulated += orsSteps[i].distance;
        const distToTurn = (accumulated - state.distanceKm * 1000);
        if (distToTurn > 0 && distToTurn < 100 && !announced50Ref.current.has(i)) {
          announced50Ref.current.add(i);
          const instr = orsSteps[i].instruction;
          const pre = lang === 'fr' ? `Dans ${formatMeters(distToTurn)}, ${instr}` : `In ${formatMeters(distToTurn)}, ${instr}`;
          if (voiceEnabled) speak(pre, lang);
          setCurrentStepIdx(i);
        }
        if (distToTurn <= 20 && distToTurn > -20 && !announced0Ref.current.has(i)) {
          announced0Ref.current.add(i);
          if (voiceEnabled) speak(orsSteps[i].instruction, lang);
          vibrate([200, 100, 200]);
          setCurrentStepIdx(Math.min(i + 1, orsSteps.length - 1));
        }
      }
    }
  }, [state.currentPos, state.distanceKm, state.track, geojsonCoords, orsSteps, offRouteIgnored, showOffRoute, voiceEnabled, lang, t]);

  const handleStop = useCallback(() => {
    setShowStopConfirm(true);
  }, []);

  const handleConfirmStop = useCallback(() => {
    const finalState = stop();
    if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
    onStop(finalState);
  }, [stop, onStop]);

  const currentStep = orsSteps[currentStepIdx];
  const nextStep = orsSteps[currentStepIdx + 1];
  let stepsAccum = 0;
  for (let i = 0; i <= currentStepIdx && i < orsSteps.length; i++) stepsAccum += orsSteps[i].distance;
  const distToNextTurn = Math.max(0, stepsAccum - state.distanceKm * 1000);

  const remainingKm = Math.max(0, totalDistanceKm - state.distanceKm);

  return (
    <div className="fixed inset-0 z-[500] flex flex-col bg-black">
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>

      {/* Top overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        {/* Nav header */}
        <div className="flex items-center gap-3 px-3 pt-10 pb-2 pointer-events-auto" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
          <button
            type="button"
            onClick={state.isRunning ? handleStop : handleConfirmStop}
            className="w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate opacity-80">{t('walk.nav_in_progress')}</p>
          </div>
          {state.gpsWeak && (
            <div className="flex items-center gap-1 bg-amber-500 px-2 py-1 rounded-full">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
              <span className="text-white text-xs font-medium">{t('walk.nav_gps_weak')}</span>
            </div>
          )}
        </div>

        {/* Turn instruction card */}
        {currentStep && (
          <div className="mx-3 mb-2 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#00C853' }}>
                  <span className="text-white text-lg">
                    {currentStep.type === 1 ? '↖' : currentStep.type === 2 ? '↗' : currentStep.type === 3 ? '↕' : '↑'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{currentStep.instruction}</p>
                  {distToNextTurn > 0 && (
                    <p className="text-xs text-[#00C853] font-semibold">{t('walk.nav_in')} {formatMeters(distToNextTurn)}</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-gray-400">{t('walk.nav_remaining')}</p>
                  <p className="text-sm font-bold text-[#6C5CE7]">{remainingKm.toFixed(1)} km</p>
                </div>
              </div>
              {nextStep && (
                <p className="text-xs text-gray-400 mt-1.5 truncate">↓ {nextStep.instruction}</p>
              )}
            </div>
          </div>
        )}

        {/* Banners */}
        {state.autoPaused && (
          <div className="mx-3 mb-2 pointer-events-none">
            <div className="bg-amber-500 rounded-xl px-4 py-2 text-center">
              <p className="text-white text-sm font-semibold">{t('walk.nav_auto_paused')}</p>
            </div>
          </div>
        )}
        {state.isPaused && !state.autoPaused && (
          <div className="mx-3 mb-2 pointer-events-none">
            <div className="bg-[#6C5CE7] rounded-xl px-4 py-2 text-center">
              <p className="text-white text-sm font-semibold">{t('walk.nav_paused')}</p>
            </div>
          </div>
        )}
        {state.gpsLost && (
          <div className="mx-3 mb-2 pointer-events-none">
            <div className="bg-red-500 rounded-xl px-4 py-2 text-center">
              <p className="text-white text-sm font-semibold">{t('walk.nav_gps_lost')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={currentPos ?? (routeLatLngs[0] ?? [48.8566, 2.3522])}
          zoom={17}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {routeLatLngs.length > 1 && (
            <Polyline positions={routeLatLngs} color="#00C853" weight={6} opacity={0.5} />
          )}
          {state.track.length > 1 && (
            <Polyline
              positions={state.track.map((p) => [p.lat, p.lng] as [number, number])}
              color="#00B8D4"
              weight={5}
              opacity={0.9}
            />
          )}
          {currentPos && (
            <>
              <Marker position={currentPos} icon={userIcon(heading)} />
              <Circle center={currentPos} radius={state.currentAccuracy} color="#00B8D4" fillColor="#00B8D4" fillOpacity={0.1} weight={1} />
            </>
          )}
          <MapController pos={currentPos} heading={heading} />
        </MapContainer>
      </div>

      {/* Bottom stats bar */}
      <div className="bg-white pb-safe" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        <div className="grid grid-cols-5 divide-x divide-gray-100 py-3">
          {[
            { label: t('walk.nav_distance'), value: `${state.distanceKm.toFixed(2)}\n/ ${totalDistanceKm} km` },
            { label: t('walk.nav_time'), value: formatDuration(state.elapsedSec) },
            { label: t('walk.est_calories'), value: `${state.calories}\nkcal` },
            { label: t('walk.nav_avg_speed'), value: `${state.avgSpeedKmh}\nkm/h` },
            { label: t('walk.nav_current_speed'), value: `${state.currentSpeedKmh}\nkm/h` },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center justify-center px-1 py-1">
              <p className="text-xs font-bold text-gray-800 text-center leading-tight whitespace-pre-line">{value}</p>
              <p className="text-[10px] text-gray-400 text-center mt-0.5 leading-tight">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 px-4 pb-3">
          <button
            type="button"
            onClick={state.isPaused ? resume : pause}
            className="flex-1 py-3 rounded-2xl font-bold text-sm"
            style={{ background: state.isPaused ? '#00C853' : '#FF9800', color: '#fff' }}
          >
            {state.isPaused ? t('walk.nav_resume') : t('walk.nav_pause')}
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold text-sm"
          >
            {t('walk.nav_stop')}
          </button>
        </div>
      </div>

      {/* Stop confirm */}
      {showStopConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t('walk.nav_end_title')}</h3>
            <p className="text-sm text-gray-500 mb-5">{t('walk.nav_end_desc')}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowStopConfirm(false)} className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold text-sm">{t('common.cancel')}</button>
              <button type="button" onClick={handleConfirmStop} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm">{t('walk.nav_end_confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Off-route alert */}
      {showOffRoute && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="text-lg font-bold text-gray-900">{t('walk.nav_off_route')}</h3>
              <p className="text-sm text-gray-500 mt-1">{t('walk.nav_off_route_desc')}</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setOffRouteIgnored(true); setShowOffRoute(false); offRouteCountRef.current = 0; }}
                className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold text-sm"
              >
                {t('walk.nav_continue_anyway')}
              </button>
              <button
                type="button"
                onClick={() => { setShowOffRoute(false); offRouteCountRef.current = 0; }}
                className="flex-1 py-3 rounded-xl bg-[#00C853] text-white font-bold text-sm"
              >
                {t('walk.nav_back_on_route')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
