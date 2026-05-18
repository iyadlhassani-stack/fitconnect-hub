import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet';
import L from 'leaflet';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import type { TrackingState } from '../../hooks/useTracking';
import { formatDuration, formatPace } from '../../utils/geoUtils';

interface RouteSummaryProps {
  tracking: TrackingState;
  plannedDistanceKm: number;
  plannedDurationMin: number;
  plannedCalories: number;
  plannedRouteCoords: [number, number][];
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}

const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
});
const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
});

export default function RouteSummary({
  tracking, plannedDistanceKm, plannedDurationMin, plannedCalories,
  plannedRouteCoords, onSave, onDiscard, saving,
}: RouteSummaryProps) {
  const { t } = useTranslation();

  const { distanceKm, elapsedSec, calories, avgSpeedKmh, track } = tracking;

  const pace = formatPace(distanceKm, elapsedSec);

  const speedData = track.filter((_, i) => i % 5 === 0).map((pt) => ({
    t: Math.round((pt.timestamp - (track[0]?.timestamp ?? pt.timestamp)) / 60000),
    speed: Math.round(pt.speed * 10) / 10,
  }));

  const walkedCoords: [number, number][] = track.map((p) => [p.lat, p.lng]);
  const startPos: [number, number] = walkedCoords[0] ?? [48.8566, 2.3522];
  const endPos: [number, number] | null = walkedCoords.length > 1 ? walkedCoords[walkedCoords.length - 1] : null;

  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function statDiff(actual: number, planned: number) {
    const diff = actual - planned;
    const pct = planned > 0 ? Math.round(Math.abs(diff) / planned * 100) : 0;
    if (Math.abs(diff) < planned * 0.02) return { text: '≈ on target', color: '#00C853' };
    const better = diff > 0;
    return {
      text: `${better ? '+' : '-'}${pct}%`,
      color: better ? '#00C853' : '#FF6B35',
    };
  }

  const distDiff = statDiff(distanceKm, plannedDistanceKm);
  const durDiff = statDiff(elapsedSec / 60, plannedDurationMin);
  const calDiff = statDiff(calories, plannedCalories);

  return (
    <div className="fixed inset-0 z-[600] bg-[#FAFAF7] overflow-y-auto pb-32">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="bg-white text-center px-6 py-8 border-b border-gray-100">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-2xl font-bold text-gray-900">{t('walk.summary_completed')}</h1>
          <p className="text-sm text-gray-500 mt-1">{dateStr} · {timeStr}</p>
        </div>

        {/* Big stats */}
        <div className="px-4 pt-6 pb-2 grid grid-cols-2 gap-3">
          {[
            { label: t('walk.distance'), value: `${distanceKm.toFixed(2)} km`, color: '#00C853', big: true },
            { label: t('walk.summary_duration'), value: formatDuration(elapsedSec), color: '#6C5CE7', big: true },
            { label: t('walk.est_calories'), value: `${calories} kcal`, color: '#FF6B35', big: false },
            { label: t('walk.summary_avg_pace'), value: `${pace} /km`, color: '#00B8D4', big: false },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-2xl p-4 shadow-sm text-center">
              <p style={{ color }} className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-gray-400 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Planned vs Actual */}
        <div className="px-4 py-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">{t('walk.summary_planned_vs_actual')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: t('walk.distance'), planned: `${plannedDistanceKm.toFixed(1)} km`, actual: `${distanceKm.toFixed(2)} km`, diff: distDiff },
                { label: t('walk.duration'), planned: `${plannedDurationMin} min`, actual: formatDuration(elapsedSec), diff: durDiff },
                { label: t('walk.est_calories'), planned: `${plannedCalories} kcal`, actual: `${calories} kcal`, diff: calDiff },
              ].map(({ label, planned, actual, diff }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-2">{label}</p>
                  <p className="text-xs text-gray-500">{t('walk.summary_planned')}: <span className="font-medium">{planned}</span></p>
                  <p className="text-xs text-gray-700 font-semibold mt-0.5">{actual}</p>
                  <p className="text-xs font-bold mt-1" style={{ color: diff.color }}>{diff.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Speed chart */}
        {speedData.length > 2 && (
          <div className="px-4 py-2">
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-500 mb-3">{t('walk.summary_speed_chart')}</h3>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={speedData}>
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} label={{ value: 'min', position: 'insideBottomRight', offset: 0, style: { fontSize: 10 } }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" km/h" width={55} />
                  <Tooltip formatter={(v: number) => [`${v} km/h`, 'Speed']} labelFormatter={(l) => `${l} min`} />
                  <ReferenceLine y={avgSpeedKmh} stroke="#00C853" strokeDasharray="4 4" label={{ value: `avg ${avgSpeedKmh}`, position: 'right', style: { fontSize: 10 } }} />
                  <Line type="monotone" dataKey="speed" stroke="#00B8D4" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Mini map */}
        {walkedCoords.length > 1 && (
          <div className="px-4 py-2">
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <div style={{ height: 180 }}>
                <MapContainer center={startPos} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {plannedRouteCoords.length > 1 && (
                    <Polyline positions={plannedRouteCoords.map(([lng, lat]) => [lat, lng] as [number, number])} color="#00C853" weight={4} opacity={0.4} />
                  )}
                  <Polyline positions={walkedCoords} color="#00B8D4" weight={4} opacity={0.9} />
                  <Marker position={startPos} icon={startIcon} />
                  {endPos && <Marker position={endPos} icon={endIcon} />}
                </MapContainer>
              </div>
              <div className="px-3 py-2 flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-1 bg-[#00C853] opacity-50 rounded" /> {t('walk.summary_planned_route')}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 h-1 bg-[#00B8D4] rounded" /> {t('walk.summary_actual_path')}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 space-y-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-sm disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #00C853, #00B8D4)' }}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t('common.loading')}
            </span>
          ) : t('walk.summary_save')}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="w-full py-3 text-sm text-gray-400"
        >
          {t('walk.summary_discard')}
        </button>
      </div>
    </div>
  );
}
