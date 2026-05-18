import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useGenerateWalkingRoutes, useSaveWalkingRoute, useUpsertDailyLog } from '@workspace/api-client-react';
import type { RouteProposal } from '@workspace/api-client-react';
import { useAppStore } from '../store/useAppStore';
import { supabase } from '../lib/supabase';
import type { TrackingState } from '../hooks/useTracking';
import StartConfirmModal from '../components/walk/StartConfirmModal';
import NavigationScreen from '../components/walk/NavigationScreen';
import RouteSummary from '../components/walk/RouteSummary';

// ─── Leaflet icon fix ──────────────────────────────────────────────────────────
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
function makeNumberedIcon(n: number, bg: string) {
  return new L.DivIcon({
    html: `<div style="background:${bg};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${n}</div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
  });
}

// ─── Types ─────────────────────────────────────────────────────────────────────
type WalkMode = 'loop' | 'direct' | 'custom';
type TargetType = 'calories' | 'minutes' | 'distance';
type Pace = 'slow' | 'normal' | 'fast';
interface Coords { lat: number; lng: number }
interface NominatimResult { place_id: number; display_name: string; lat: string; lon: string }
interface CustomWaypoint { id: string; address: string; coords: Coords | null }
interface WeatherNow { temp: number; feelsLike: number; humidity: number; windSpeed: number; description: string; icon: string }
interface WeatherForecast { temp: number; description: string; icon: string; pop: number }
interface WeatherData { now: WeatherNow; forecast3h?: WeatherForecast }

// ─── Utilities ─────────────────────────────────────────────────────────────────

async function nominatimSearch(query: string): Promise<NominatimResult[]> {
  if (query.length < 3) return [];
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as NominatimResult[]) : [];
  } catch { return []; }
}
async function nominatimReverse(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = (await res.json()) as { display_name?: string };
    return d.display_name ?? null;
  } catch { return null; }
}
async function fetchWeather(lat: number, lng: number, lang: string): Promise<WeatherData | null> {
  const key = import.meta.env.VITE_OPENWEATHERMAP_API_KEY;
  if (!key) return null;
  const l = lang === 'fr' ? 'fr' : 'en';
  try {
    const [nowRes, fcRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${key}&units=metric&lang=${l}`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${key}&units=metric&cnt=2&lang=${l}`),
    ]);
    if (!nowRes.ok) return null;
    const now = await nowRes.json() as { main: { temp: number; feels_like: number; humidity: number }; wind: { speed: number }; weather: Array<{ description: string; icon: string }> };
    const fcData = fcRes.ok ? (await fcRes.json() as { list?: Array<{ main: { temp: number }; weather: Array<{ description: string; icon: string }>; pop: number }> }) : null;
    const fc1 = fcData?.list?.[1];
    return {
      now: { temp: Math.round(now.main.temp), feelsLike: Math.round(now.main.feels_like), humidity: now.main.humidity, windSpeed: now.wind.speed, description: now.weather[0]?.description ?? '', icon: now.weather[0]?.icon ?? '01d' },
      forecast3h: fc1 ? { temp: Math.round(fc1.main.temp), description: fc1.weather[0]?.description ?? '', icon: fc1.weather[0]?.icon ?? '01d', pop: fc1.pop ?? 0 } : undefined,
    };
  } catch { return null; }
}
function getWeatherBadge(weather: WeatherData, t: (k: string) => string): { color: string; text: string; key: string } {
  const { now, forecast3h } = weather;
  const wind = now.windSpeed * 3.6;
  const desc = now.description.toLowerCase();
  if (desc.includes('thunderstorm') || desc.includes('heavy')) return { color: 'red', text: t('walk.weather_bad'), key: 'bad' };
  if (now.temp < 0) return { color: 'blue', text: t('walk.weather_cold'), key: 'cold' };
  if (now.temp > 30) return { color: 'orange', text: t('walk.weather_hot'), key: 'hot' };
  if (wind > 30) return { color: 'orange', text: t('walk.weather_windy'), key: 'windy' };
  if (desc.includes('rain') || desc.includes('drizzle') || (forecast3h && forecast3h.pop > 0.5)) return { color: 'orange', text: t('walk.weather_light_rain'), key: 'light_rain' };
  if (now.temp >= 15 && now.temp <= 25 && (desc.includes('clear') || desc.includes('few clouds') || desc.includes('sun'))) return { color: 'green', text: t('walk.weather_perfect'), key: 'perfect' };
  return { color: 'blue', text: t('walk.weather_good'), key: 'good' };
}

// ─── Map helpers ───────────────────────────────────────────────────────────────
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}
function MapAutoFit({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates), { padding: [30, 30] });
    else if (coordinates.length === 1) map.setView(coordinates[0], 14);
  }, [coordinates, map]);
  return null;
}

// ─── WeatherCard ───────────────────────────────────────────────────────────────
const BADGE_CLS: Record<string, string> = { green: 'bg-emerald-100 text-emerald-700', blue: 'bg-blue-100 text-blue-700', orange: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700' };

function WeatherCard({ weather, loading, t }: { weather: WeatherData | null; loading: boolean; t: (k: string) => string }) {
  if (loading) return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
      <div className="w-5 h-5 border-2 border-[#00C853] border-t-transparent rounded-full animate-spin flex-shrink-0" />
      <span className="text-sm text-gray-400">Loading weather…</span>
    </div>
  );
  if (!weather) return null;
  const badge = getWeatherBadge(weather, t);
  const windKmh = (weather.now.windSpeed * 3.6).toFixed(0);
  const tempCls = weather.now.temp > 30 ? 'text-amber-500' : weather.now.temp < 0 ? 'text-blue-500' : 'text-gray-800';
  return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <img src={`https://openweathermap.org/img/wn/${weather.now.icon}@2x.png`} alt={weather.now.description} className="w-11 h-11 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xl font-bold ${tempCls}`}>{weather.now.temp}°C</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BADGE_CLS[badge.color] ?? BADGE_CLS.blue}`}>{badge.text}</span>
          </div>
          <p className="text-xs text-gray-400 capitalize truncate">{weather.now.description}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
        <span>{t('walk.weather_feels_like')} <strong className="text-gray-700">{weather.now.feelsLike}°</strong></span>
        <span>{t('walk.weather_humidity')} <strong className="text-gray-700">{weather.now.humidity}%</strong></span>
        <span>{t('walk.weather_wind')} <strong className="text-gray-700">{windKmh} km/h</strong></span>
        {weather.forecast3h && weather.forecast3h.pop > 0.1 && (
          <span className="ml-auto">{t('walk.weather_next_3h')} <strong className="text-gray-700">{weather.forecast3h.temp}°</strong> · {Math.round(weather.forecast3h.pop * 100)}% 🌧</span>
        )}
      </div>
    </div>
  );
}

// ─── AddressInput ──────────────────────────────────────────────────────────────
interface AddressInputProps {
  label: string; value: string; coords: Coords | null;
  onChange: (value: string, coords: Coords | null) => void;
  onSetOnMap: () => void; placeholder: string; compact?: boolean;
}
function AddressInput({ label, value, coords, onChange, onSetOnMap, placeholder, compact }: AddressInputProps) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = (val: string) => {
    onChange(val, null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 3) { setSuggestions([]); setShowSug(false); return; }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      const results = await nominatimSearch(val);
      setSuggestions(results); setShowSug(results.length > 0); setIsSearching(false);
    }, 300);
  };
  const handleSelect = (r: NominatimResult) => {
    onChange(r.display_name, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
    setSuggestions([]); setShowSug(false);
  };
  const handleUseLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const addr = await nominatimReverse(latitude, longitude);
      onChange(addr ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, { lat: latitude, lng: longitude });
      setIsLocating(false);
    }, () => setIsLocating(false), { timeout: 10000 });
  };
  return (
    <div className="relative">
      <label className={`block ${compact ? 'text-xs font-medium text-gray-400' : 'text-xs font-semibold text-gray-500 uppercase tracking-wide'} mb-1.5`}>{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input type="text" value={value} onChange={(e) => handleInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            placeholder={placeholder}
            className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-white outline-none transition-all ${coords ? 'border-[#00C853] ring-1 ring-[#00C853]/20' : 'border-gray-200 focus:border-[#00C853]'}`}
          />
          {isSearching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#00C853] border-t-transparent rounded-full animate-spin" />}
          {showSug && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 max-h-52 overflow-y-auto">
              {suggestions.map((s) => (
                <button key={s.place_id} onMouseDown={() => handleSelect(s)} className="w-full text-left px-3 py-2.5 text-xs hover:bg-[#00C853]/5 border-b border-gray-50 last:border-0">{s.display_name}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={handleUseLocation} disabled={isLocating} title={t('walk.use_my_location')}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#00C853]/10 text-[#00C853] flex items-center justify-center hover:bg-[#00C853]/20 transition-colors disabled:opacity-50">
          {isLocating ? <div className="w-4 h-4 border-2 border-[#00C853] border-t-transparent rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        </button>
        <button type="button" onClick={onSetOnMap} title={t('walk.set_on_map')}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#6C5CE7]/10 text-[#6C5CE7] flex items-center justify-center hover:bg-[#6C5CE7]/20 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
        </button>
      </div>
      {coords && <p className="mt-1 text-xs text-[#00C853] flex items-center gap-1"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</p>}
    </div>
  );
}

// ─── MapPickerModal ────────────────────────────────────────────────────────────
function MapPickerModal({ isOpen, title, initialCenter, markerPos, onMarkerChange, onConfirm, onClose }: {
  isOpen: boolean; title: string; initialCenter: [number, number];
  markerPos: [number, number] | null; onMarkerChange: (lat: number, lng: number) => void;
  onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/60" onClick={onClose}>
      <div className="mt-auto bg-white rounded-t-2xl overflow-hidden flex flex-col" style={{ height: '72vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <p className="text-xs text-center text-gray-500 py-2 bg-gray-50 flex-shrink-0">Tap anywhere on the map to place a pin</p>
        <div className="flex-1 min-h-0">
          <MapContainer center={initialCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            <MapClickHandler onMapClick={onMarkerChange} />
            {markerPos && <Marker position={markerPos} />}
          </MapContainer>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">{t('common.cancel')}</button>
          <button onClick={onConfirm} disabled={!markerPos} className="flex-1 py-2.5 rounded-xl bg-[#00C853] text-white text-sm font-bold disabled:opacity-40">Confirm location</button>
        </div>
      </div>
    </div>
  );
}

// ─── RouteResultMap ────────────────────────────────────────────────────────────
function RouteResultMap({ result, mode, customStops }: { result: RouteProposal; mode: WalkMode; customStops?: Coords[] }) {
  const geojson = result.geojson as { coordinates?: number[][] };
  const rawCoords = geojson?.coordinates ?? [];
  const latLngs: [number, number][] = rawCoords.map(([lng, lat]) => [lat as number, lng as number]);
  const startPos = latLngs[0] ?? [48.8566, 2.3522];
  const endPos = latLngs[latLngs.length - 1];
  const isLoop = mode === 'loop' || !endPos || (endPos[0] === startPos[0] && endPos[1] === startPos[1]);
  return (
    <div style={{ height: 220 }}>
      <MapContainer center={startPos} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {latLngs.length > 1 && <Polyline positions={latLngs} color="#00C853" weight={4} opacity={0.9} />}
        {mode === 'custom' ? (
          <>
            <Marker position={startPos} icon={makeNumberedIcon(1, '#00C853')} />
            {(customStops ?? []).map((s, i) => <Marker key={i} position={[s.lat, s.lng]} icon={makeNumberedIcon(i + 2, '#6C5CE7')} />)}
            {endPos && <Marker position={endPos} icon={makeNumberedIcon((customStops?.length ?? 0) + 2, '#FF6B35')} />}
          </>
        ) : (
          <>
            {startPos && <Marker position={startPos} icon={startIcon} />}
            {!isLoop && endPos && <Marker position={endPos} icon={endIcon} />}
          </>
        )}
        <MapAutoFit coordinates={latLngs} />
      </MapContainer>
    </div>
  );
}

// ─── WalkPage ──────────────────────────────────────────────────────────────────
export default function WalkPage() {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAppStore();

  const [mode, setMode] = useState<WalkMode>('loop');
  const [startAddress, setStartAddress] = useState('');
  const [startCoords, setStartCoords] = useState<Coords | null>(null);
  const [endAddress, setEndAddress] = useState('');
  const [endCoords, setEndCoords] = useState<Coords | null>(null);
  const [customWaypoints, setCustomWaypoints] = useState<CustomWaypoint[]>([]);
  const [targetType, setTargetType] = useState<TargetType>('calories');
  const [targetValue, setTargetValue] = useState('300');
  const [pace, setPace] = useState<Pace>('normal');
  const [result, setResult] = useState<RouteProposal | null>(null);
  const [showResult, setShowResult] = useState(false); // separate from result to control impossible display
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [wasSaved, setWasSaved] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [navVoiceEnabled, setNavVoiceEnabled] = useState(false);
  const [navKeepScreenOn, setNavKeepScreenOn] = useState(false);
  const [finalTracking, setFinalTracking] = useState<TrackingState | null>(null);
  const [isSavingWalk, setIsSavingWalk] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapPickerField, setMapPickerField] = useState<string | null>(null);
  const [mapTempCoords, setMapTempCoords] = useState<[number, number] | null>(null);
  const [mapPickerCenter, setMapPickerCenter] = useState<[number, number]>([48.8566, 2.3522]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const targetInputRef = useRef<HTMLInputElement>(null);
  const generateMutation = useGenerateWalkingRoutes();
  const saveMutation = useSaveWalkingRoute();
  const logMutation = useUpsertDailyLog();

  // ── Weather fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!startCoords) { setWeather(null); return; }
    const key = import.meta.env.VITE_OPENWEATHERMAP_API_KEY;
    if (!key) return;
    let aborted = false;
    setWeatherLoading(true);
    const timer = setTimeout(async () => {
      const data = await fetchWeather(startCoords.lat, startCoords.lng, i18n.language);
      if (!aborted) { setWeather(data); setWeatherLoading(false); }
    }, 600);
    return () => { aborted = true; clearTimeout(timer); setWeatherLoading(false); };
  }, [startCoords?.lat, startCoords?.lng, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Custom waypoint management ─────────────────────────────────────────────
  const addCustomWaypoint = useCallback(() => setCustomWaypoints((p) => [...p, { id: Date.now().toString(), address: '', coords: null }]), []);
  const removeCustomWaypoint = useCallback((id: string) => setCustomWaypoints((p) => p.filter((w) => w.id !== id)), []);
  const updateCustomWaypoint = useCallback((id: string, address: string, coords: Coords | null) => setCustomWaypoints((p) => p.map((w) => w.id === id ? { ...w, address, coords } : w)), []);

  // ── Form validity ──────────────────────────────────────────────────────────
  const hasGoal = mode === 'direct' && targetValue !== '' && parseFloat(targetValue) > 0;
  const isFormValid = useCallback(() => {
    if (!startCoords) return false;
    if (mode === 'direct') return !!endCoords;
    if (mode === 'custom') {
      if (!endCoords) return false;
      return customWaypoints.every((w) => !w.address || !!w.coords);
    }
    // loop: requires goal
    const val = parseFloat(targetValue);
    return !isNaN(val) && val > 0;
  }, [startCoords, endCoords, mode, targetValue, customWaypoints]);

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async (seed?: number) => {
    if (!isFormValid()) return;
    setIsGenerating(true);
    setGenError(null);
    setResult(null);
    setShowResult(false);
    setWasSaved(false);
    const weightKg = profile?.weight_kg ?? 70;

    try {
      let data: RouteProposal;

      if (mode === 'custom') {
        const allWaypoints = [
          { lat: startCoords!.lat, lng: startCoords!.lng },
          ...customWaypoints.filter((w) => w.coords).map((w) => ({ lat: w.coords!.lat, lng: w.coords!.lng })),
          { lat: endCoords!.lat, lng: endCoords!.lng },
        ];
        data = await generateMutation.mutateAsync({
          data: { mode: 'custom', lat: startCoords!.lat, lng: startCoords!.lng, address: startAddress || null, endLat: endCoords!.lat, endLng: endCoords!.lng, endAddress: endAddress || null, targetType: 'distance', targetValue: 1, pace, weightKg, seed: null, waypoints: allWaypoints },
        });
      } else {
        data = await generateMutation.mutateAsync({
          data: {
            mode,
            lat: startCoords!.lat, lng: startCoords!.lng, address: startAddress || null,
            endLat: endCoords?.lat ?? null, endLng: endCoords?.lng ?? null, endAddress: endAddress || null,
            targetType: (mode === 'direct' && !hasGoal) ? undefined : targetType,
            targetValue: (mode === 'direct' && !hasGoal) ? undefined : parseFloat(targetValue),
            pace, weightKg, seed: seed ?? Math.floor(Math.random() * 1000),
          },
        });
      }

      setResult(data);
      setShowResult(true);

      // Coach message on bad weather
      if (weather && user?.id) {
        const badge = getWeatherBadge(weather, t);
        if (['bad', 'cold', 'hot', 'light_rain'].includes(badge.key)) {
          supabase.from('coach_messages').insert({ user_id: user.id, role: 'assistant', content: `Heads up! The weather looks ${badge.key}. ${badge.text} 🌤️ Dress accordingly.`, type: 'proactive_suggestion', read: false }).then(() => {});
        }
      }
    } catch (err: unknown) {
      // Try to extract a useful message from the error
      let msg = t('walk.error_no_route');
      if (err && typeof err === 'object') {
        const e = err as { message?: string; response?: { data?: { error?: string } } };
        const raw = e?.response?.data?.error ?? e?.message ?? '';
        if (raw.includes('too short') || raw.includes('500m')) msg = t('walk.error_goal_too_short');
        else if (raw.includes('too long') || raw.includes('50km')) msg = t('walk.error_goal_too_long');
        else if (raw.includes('no walking path') || raw.includes('reachable on foot')) msg = t('walk.error_no_path');
        else if (raw.includes('no data') || raw.includes('major city')) msg = t('walk.error_area_no_data');
        else if (raw.includes('Custom mode requires')) msg = 'Please set both start and end points.';
        else if (raw) msg = raw;
      }
      setGenError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [isFormValid, profile, mode, startCoords, startAddress, endCoords, endAddress, customWaypoints, targetType, targetValue, pace, hasGoal, generateMutation, weather, user, t]);

  const handleRegenerate = useCallback(() => handleGenerate(Math.floor(Math.random() * 1000)), [handleGenerate]);

  const handleUseDirect = useCallback(() => {
    if (!result) return;
    // Clear goal_impossible flag — the direct route data is already in result
    setResult({ ...result, goal_impossible: null });
  }, [result]);

  const handleAdjustGoal = useCallback(() => {
    targetInputRef.current?.focus();
    targetInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // ── Navigation handlers ────────────────────────────────────────────────────
  const handleStartNavigation = useCallback((voice: boolean, screenOn: boolean) => {
    setNavVoiceEnabled(voice);
    setNavKeepScreenOn(screenOn);
    setShowStartConfirm(false);
    setShowNavigation(true);
  }, []);

  const handleWalkStop = useCallback((finalState: TrackingState) => {
    setFinalTracking(finalState);
    setShowNavigation(false);
    setShowSummary(true);
  }, []);

  const handleSaveWalk = useCallback(async () => {
    if (!finalTracking || !user || !result) return;
    setIsSavingWalk(true);
    try {
      const distKm = parseFloat(finalTracking.distanceKm.toFixed(3));
      const durationMin = Math.round(finalTracking.elapsedSec / 60);
      const today = new Date().toISOString().split('T')[0];

      await Promise.all([
        saveMutation.mutateAsync({
          data: {
            user_id: user.id,
            start_location: { lat: startCoords?.lat, lng: startCoords?.lng, address: startAddress || null },
            target_type: targetType,
            target_value: parseFloat(targetValue) || 0,
            generated_route: result.geojson as Record<string, unknown>,
            distance_km: result.distance_km,
            duration_min: result.duration_min,
            estimated_calories: result.estimated_calories,
            completed: true,
            actual_calories: finalTracking.calories,
            actual_distance_km: distKm,
            actual_duration_sec: finalTracking.elapsedSec,
            average_speed_kmh: finalTracking.avgSpeedKmh,
            pauses_count: finalTracking.pausesCount,
            completed_at: new Date().toISOString(),
          },
        }),
        logMutation.mutateAsync({
          data: {
            user_id: user.id,
            date: today,
            workouts: [{
              name: 'Walk (FitConnect)',
              type: 'walking',
              duration_min: durationMin,
              calories_burned: finalTracking.calories,
            }],
          },
        }),
      ]);

      if (user.id) {
        const name = profile?.full_name?.split(' ')[0] ?? t('home.good_morning');
        await supabase.from('coach_messages').insert({
          user_id: user.id,
          role: 'assistant',
          content: `Great walk ${name}! You walked ${distKm} km in ${durationMin} minutes and burned ${finalTracking.calories} kcal. Keep it up! 🎉`,
          type: 'proactive_suggestion',
          read: false,
        });
      }

      showToast(t('walk.summary_saved_toast'));
      setShowSummary(false);
      setFinalTracking(null);
      setResult(null);
      setShowResult(false);
    } catch {
      showToast('Could not save walk.');
    } finally {
      setIsSavingWalk(false);
    }
  }, [finalTracking, user, result, startCoords, startAddress, targetType, targetValue, saveMutation, logMutation, profile, t, showToast]);

  const handleDiscardWalk = useCallback(() => {
    setShowSummary(false);
    setFinalTracking(null);
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!result || !user || isSaving || wasSaved || result.goal_impossible) return;
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        data: { user_id: user.id, start_location: { lat: startCoords?.lat, lng: startCoords?.lng, address: startAddress || null }, target_type: targetType, target_value: parseFloat(targetValue) || 0, generated_route: result.geojson as Record<string, unknown>, distance_km: result.distance_km, duration_min: result.duration_min, estimated_calories: result.estimated_calories, completed: false },
      });
      setWasSaved(true);
      showToast(t('walk.saved'));
      if (user.id) {
        supabase.from('coach_messages').insert({ user_id: user.id, role: 'assistant', content: `Nice walk planned! ${result.distance_km} km for ~${result.estimated_calories} kcal. Let me know when you complete it — I'll log it in your daily total! 🚶`, type: 'proactive_suggestion', read: false }).then(() => {});
      }
    } catch { showToast('Could not save route.'); }
    finally { setIsSaving(false); }
  };

  // ── Map picker ─────────────────────────────────────────────────────────────
  const openMapPicker = (field: string) => {
    const existing = field === 'start' ? startCoords : field === 'end' ? endCoords : customWaypoints.find((w) => w.id === field.slice(3))?.coords;
    if (existing) { setMapPickerCenter([existing.lat, existing.lng]); setMapTempCoords([existing.lat, existing.lng]); }
    else if (startCoords) { setMapPickerCenter([startCoords.lat, startCoords.lng]); setMapTempCoords(null); }
    else setMapTempCoords(null);
    setMapPickerField(field);
  };
  const confirmMapPicker = async () => {
    if (!mapTempCoords) return;
    const [lat, lng] = mapTempCoords;
    const addr = await nominatimReverse(lat, lng);
    const addrStr = addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (mapPickerField === 'start') { setStartAddress(addrStr); setStartCoords({ lat, lng }); }
    else if (mapPickerField === 'end') { setEndAddress(addrStr); setEndCoords({ lat, lng }); }
    else if (mapPickerField?.startsWith('wp:')) updateCustomWaypoint(mapPickerField.slice(3), addrStr, { lat, lng });
    setMapPickerField(null); setMapTempCoords(null);
  };

  const mapPickerTitle = (() => {
    if (!mapPickerField) return '';
    if (mapPickerField === 'start') return t('walk.starting_point');
    if (mapPickerField === 'end') return mode === 'custom' ? t('walk.final_destination') : t('walk.ending_point');
    if (mapPickerField.startsWith('wp:')) { const idx = customWaypoints.findIndex((w) => w.id === mapPickerField.slice(3)); return `${t('walk.stop_label')} ${idx + 1}`; }
    return 'Set Location';
  })();

  const targetDefaultValues: Record<TargetType, string> = { calories: '300', minutes: '45', distance: '5' };
  const targetUnit: Record<TargetType, string> = { calories: 'kcal', minutes: 'min', distance: 'km' };
  const customStops = customWaypoints.filter((w) => !!w.coords).map((w) => w.coords!);
  const isImpossible = !!result?.goal_impossible;

  const modeConfigs: Array<{ key: WalkMode; label: string; color: string }> = [
    { key: 'loop', label: t('walk.mode_loop'), color: '#00C853' },
    { key: 'direct', label: t('walk.mode_direct'), color: '#6C5CE7' },
    { key: 'custom', label: t('walk.mode_custom'), color: '#00B8D4' },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF7] pb-28">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">{toast}</div>}

      <div className="pt-12 px-4 pb-4 bg-white border-b border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900">{t('walk.title')}</h1>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* ── Mode selector ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {modeConfigs.map(({ key, label, color }) => (
              <button key={key} onClick={() => { setMode(key); setResult(null); setGenError(null); setShowResult(false); }}
                className="px-3 py-3 rounded-xl text-sm font-semibold transition-all"
                style={mode === key ? { background: color, color: '#fff', boxShadow: `0 2px 8px ${color}55` } : { background: '#F5F5F0', color: '#666' }}>
                {label}
              </button>
            ))}
          </div>
          {mode === 'custom' && <p className="mt-2 text-xs text-[#00B8D4] text-center">{t('walk.custom_subtitle')}</p>}
        </div>

        {/* ── Location inputs ────────────────────────────────────────── */}
        {mode !== 'custom' ? (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
            <AddressInput label={t('walk.starting_point')} value={startAddress} coords={startCoords} onChange={(v, c) => { setStartAddress(v); setStartCoords(c); }} onSetOnMap={() => openMapPicker('start')} placeholder={t('walk.address_placeholder')} />
            {mode === 'direct' && <AddressInput label={t('walk.ending_point')} value={endAddress} coords={endCoords} onChange={(v, c) => { setEndAddress(v); setEndCoords(c); }} onSetOnMap={() => openMapPicker('end')} placeholder={t('walk.address_placeholder')} />}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            {/* Start */}
            <div className="flex items-start gap-2">
              <div className="flex flex-col items-center pt-7 flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-[#00C853] text-white text-xs font-bold flex items-center justify-center">1</div>
                <div className="w-0.5 bg-gray-200 my-1" style={{ minHeight: 20 }} />
              </div>
              <div className="flex-1 min-w-0">
                <AddressInput label={t('walk.starting_point')} value={startAddress} coords={startCoords} onChange={(v, c) => { setStartAddress(v); setStartCoords(c); }} onSetOnMap={() => openMapPicker('start')} placeholder={t('walk.address_placeholder')} compact />
              </div>
            </div>
            {/* Intermediate stops */}
            {customWaypoints.map((wp, i) => (
              <div key={wp.id} className="flex items-start gap-2">
                <div className="flex flex-col items-center pt-5 flex-shrink-0">
                  <div className="w-6 h-6 rounded-full bg-[#6C5CE7] text-white text-xs font-bold flex items-center justify-center">{i + 2}</div>
                  <div className="w-0.5 bg-gray-200 my-1" style={{ minHeight: 20 }} />
                </div>
                <div className="flex-1 min-w-0 flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <AddressInput label={`${t('walk.stop_label')} ${i + 1}`} value={wp.address} coords={wp.coords} onChange={(v, c) => updateCustomWaypoint(wp.id, v, c)} onSetOnMap={() => openMapPicker(`wp:${wp.id}`)} placeholder={t('walk.address_placeholder')} compact />
                  </div>
                  <button onClick={() => removeCustomWaypoint(wp.id)} className="flex-shrink-0 mt-5 w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 flex items-center justify-center text-lg">×</button>
                </div>
              </div>
            ))}
            <div className="pl-8">
              <button onClick={addCustomWaypoint} className="w-full py-2.5 border-2 border-dashed border-[#6C5CE7]/30 text-[#6C5CE7] text-sm font-semibold rounded-xl hover:border-[#6C5CE7]/60 hover:bg-[#6C5CE7]/5 transition-colors">{t('walk.add_stop')}</button>
            </div>
            {/* End */}
            <div className="flex items-start gap-2">
              <div className="flex flex-col items-center pt-5 flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-[#FF6B35] text-white text-xs font-bold flex items-center justify-center">{customWaypoints.length + 2}</div>
              </div>
              <div className="flex-1 min-w-0">
                <AddressInput label={t('walk.final_destination')} value={endAddress} coords={endCoords} onChange={(v, c) => { setEndAddress(v); setEndCoords(c); }} onSetOnMap={() => openMapPicker('end')} placeholder={t('walk.address_placeholder')} compact />
              </div>
            </div>
            <p className="text-xs text-gray-400 italic pl-8">{t('walk.custom_note')}</p>
          </div>
        )}

        {/* ── Weather card ───────────────────────────────────────────── */}
        {(weatherLoading || weather) && startCoords && <WeatherCard weather={weather} loading={weatherLoading} t={t} />}

        {/* ── Goal + Pace ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          {/* Goal: shown for loop (required) and direct (optional) */}
          {mode !== 'custom' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {mode === 'direct' ? t('walk.goal_optional') : t('walk.target_type')}
              </p>
              {mode === 'direct' && <p className="text-xs text-gray-400 mb-2">{t('walk.goal_optional_hint')}</p>}
              <div className="flex gap-2 mb-3">
                {(['calories', 'minutes', 'distance'] as TargetType[]).map((tt) => {
                  const labels: Record<TargetType, string> = { calories: t('walk.calories_target'), minutes: t('walk.minutes_target'), distance: t('walk.distance_target') };
                  return (
                    <button key={tt} onClick={() => { setTargetType(tt); if (!targetValue) setTargetValue(targetDefaultValues[tt]); }}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={targetType === tt ? { background: '#00C853', color: '#fff' } : { background: '#F5F5F0', color: '#666' }}>
                      {labels[tt]}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <input ref={targetInputRef} type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)}
                  placeholder={mode === 'direct' ? '0' : targetDefaultValues[targetType]}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#00C853]"
                  min="0" />
                <span className="text-sm font-semibold text-gray-500 w-10">{targetUnit[targetType]}</span>
              </div>
            </div>
          )}
          {/* Pace */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('walk.pace')}</p>
            <div className="flex gap-2">
              {(['slow', 'normal', 'fast'] as Pace[]).map((p) => {
                const labels: Record<Pace, string> = { slow: t('walk.slow'), normal: t('walk.normal'), fast: t('walk.fast') };
                return <button key={p} onClick={() => setPace(p)} className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all" style={pace === p ? { background: '#6C5CE7', color: '#fff' } : { background: '#F5F5F0', color: '#666' }}>{labels[p]}</button>;
              })}
            </div>
          </div>
        </div>

        {!startCoords && <p className="text-xs text-center text-gray-400 -mt-1">{t('walk.enter_address')}</p>}

        {/* ── Generate button ────────────────────────────────────────── */}
        <button onClick={() => handleGenerate()} disabled={!isFormValid() || isGenerating}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: isFormValid() ? 'linear-gradient(135deg, #00C853, #00B8D4)' : '#e5e5e5', color: isFormValid() ? '#fff' : '#aaa' }}>
          {isGenerating ? <span className="flex items-center justify-center gap-2"><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />{t('walk.generating')}</span> : t('walk.generate_route')}
        </button>

        {/* ── Generic error card (red) ───────────────────────────────── */}
        {genError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-start gap-2">
              <span className="text-red-500 text-lg flex-shrink-0">⚠️</span>
              <p className="text-red-700 text-sm">{genError}</p>
            </div>
          </div>
        )}

        {/* ── Impossible goal card (red with actions) ────────────────── */}
        {isImpossible && result && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-red-500 text-xl flex-shrink-0">🚫</span>
              <div>
                <p className="font-bold text-red-700 text-sm">{t('walk.error_goal_impossible')}</p>
                <p className="text-red-600 text-xs mt-1">{result.note}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 bg-white rounded-xl p-3 border border-red-100">
              {[
                { label: t('walk.distance'), value: `${result.direct_km ?? result.distance_km} km`, color: '#00C853' },
                { label: t('walk.duration'), value: `${result.direct_duration_min ?? result.duration_min} min`, color: '#6C5CE7' },
                { label: t('walk.est_calories'), value: `${result.direct_calories ?? result.estimated_calories} kcal`, color: '#FF6B35' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p style={{ color }} className="text-sm font-bold">{value}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleUseDirect} className="flex-1 py-2.5 rounded-xl bg-[#00C853] text-white text-sm font-bold">{t('walk.use_direct_anyway')}</button>
              <button onClick={handleAdjustGoal} className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 text-sm font-semibold">{t('walk.adjust_goal')}</button>
            </div>
          </div>
        )}

        {/* ── Result card ────────────────────────────────────────────── */}
        {result && !isImpossible && showResult && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <RouteResultMap result={result} mode={mode} customStops={mode === 'custom' ? customStops : undefined} />
            <div className="p-4 space-y-3">
              {/* Warning banner */}
              {result.warning && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="text-amber-500 text-sm flex-shrink-0">⚠️</span>
                  <p className="text-xs text-amber-700">{t('walk.warning_approximate')}{result.note ? ` — ${result.note}` : ''}</p>
                </div>
              )}
              {/* Info note */}
              {result.note && !result.warning && (
                <p className="text-xs text-[#6C5CE7] bg-[#6C5CE7]/5 px-3 py-2 rounded-xl">{result.note}</p>
              )}
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t('walk.distance'), value: `${result.distance_km} km`, color: '#00C853' },
                  { label: t('walk.duration'), value: `${result.duration_min} min`, color: '#6C5CE7' },
                  { label: t('walk.est_calories'), value: `${result.estimated_calories} kcal`, color: '#FF6B35' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center bg-gray-50 rounded-xl p-3">
                    <p style={{ color }} className="text-lg font-bold">{value}</p>
                    <p className="text-xs text-gray-400">{label}</p>
                  </div>
                ))}
              </div>
              {/* Actions */}
              <div className="flex gap-2">
                <button onClick={() => setShowStartConfirm(true)}
                  className="flex-1 py-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-1.5"
                  style={{ background: 'linear-gradient(135deg, #00C853, #00B8D4)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                  {t('walk.start_navigation')}
                </button>
                <button onClick={handleRegenerate} disabled={isGenerating} className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 disabled:opacity-40 flex-shrink-0" title={t('walk.regenerate')}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={handleSave} disabled={isSaving || wasSaved}
                  className="flex-1 py-3 rounded-xl font-bold text-sm border-2 flex items-center justify-center gap-1.5 transition-colors"
                  style={wasSaved ? { borderColor: '#00C853', color: '#00C853' } : { borderColor: '#e5e5e5', color: '#666' }}>
                  {wasSaved ? '✓ Saved' : t('walk.save_history')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────── */}
        {!result && !isGenerating && !genError && (
          <div className="text-center py-8 text-gray-400">
            <div className="text-4xl mb-3">🚶</div>
            <p className="text-sm">{t('walk.no_routes_yet')}</p>
          </div>
        )}
      </div>

      <MapPickerModal isOpen={mapPickerField !== null} title={mapPickerTitle} initialCenter={mapPickerCenter} markerPos={mapTempCoords}
        onMarkerChange={(lat, lng) => setMapTempCoords([lat, lng])} onConfirm={confirmMapPicker}
        onClose={() => { setMapPickerField(null); setMapTempCoords(null); }} />

      {result && !isImpossible && (
        <StartConfirmModal
          isOpen={showStartConfirm}
          routeName={result.note ?? `${result.distance_km} km ${t('walk.mode_' + mode)}`}
          distanceKm={result.distance_km}
          durationMin={result.duration_min}
          estimatedCalories={result.estimated_calories}
          onStart={handleStartNavigation}
          onClose={() => setShowStartConfirm(false)}
        />
      )}

      {showNavigation && result && (
        <NavigationScreen
          geojsonCoords={(result.geojson as { coordinates?: [number, number][] })?.coordinates ?? []}
          orsSteps={[]}
          weightKg={profile?.weight_kg ?? 70}
          totalDistanceKm={result.distance_km}
          voiceEnabled={navVoiceEnabled}
          keepScreenOn={navKeepScreenOn}
          lang={i18n.language}
          onStop={handleWalkStop}
        />
      )}

      {showSummary && finalTracking && result && (
        <RouteSummary
          tracking={finalTracking}
          plannedDistanceKm={result.distance_km}
          plannedDurationMin={result.duration_min}
          plannedCalories={result.estimated_calories}
          plannedRouteCoords={(result.geojson as { coordinates?: [number, number][] })?.coordinates ?? []}
          onSave={handleSaveWalk}
          onDiscard={handleDiscardWalk}
          saving={isSavingWalk}
        />
      )}
    </div>
  );
}
