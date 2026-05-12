import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useGenerateWalkingRoutes, useSaveWalkingRoute } from '@workspace/api-client-react';
import type { RouteProposal } from '@workspace/api-client-react';
import { useAppStore } from '../store/useAppStore';
import { supabase } from '../lib/supabase';

// Fix Leaflet default marker icon for Vite builds
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type WalkMode = 'loop' | 'direct' | 'calorie_detour';
type TargetType = 'calories' | 'minutes' | 'distance';
type Pace = 'slow' | 'normal' | 'fast';

interface Coords { lat: number; lng: number }
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

// ─── Nominatim helpers ────────────────────────────────────────────────────────

async function nominatimSearch(query: string): Promise<NominatimResult[]> {
  if (query.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    return (await res.json()) as NominatimResult[];
  } catch {
    return [];
  }
}

async function nominatimReverse(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

// ─── Map helpers ──────────────────────────────────────────────────────────────

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function MapAutoFit({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length > 1) {
      const bounds = L.latLngBounds(coordinates);
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (coordinates.length === 1) {
      map.setView(coordinates[0], 14);
    }
  }, [coordinates, map]);
  return null;
}

// ─── AddressInput component ────────────────────────────────────────────────────

interface AddressInputProps {
  label: string;
  value: string;
  coords: Coords | null;
  onChange: (value: string, coords: Coords | null) => void;
  onSetOnMap: () => void;
  placeholder: string;
}

function AddressInput({ label, value, coords, onChange, onSetOnMap, placeholder }: AddressInputProps) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = (val: string) => {
    onChange(val, null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 3) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      const results = await nominatimSearch(val);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setIsSearching(false);
    }, 300);
  };

  const handleSelect = (result: NominatimResult) => {
    onChange(result.display_name, { lat: parseFloat(result.lat), lng: parseFloat(result.lon) });
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const address = await nominatimReverse(latitude, longitude);
        onChange(address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, { lat: latitude, lng: longitude });
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { timeout: 10000 }
    );
  };

  return (
    <div className="relative">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={placeholder}
            className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-white outline-none transition-all ${
              coords ? 'border-[#00C853] ring-1 ring-[#00C853]/20' : 'border-gray-200 focus:border-[#00C853]'
            }`}
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#00C853] border-t-transparent rounded-full animate-spin" />
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 max-h-52 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.place_id}
                  onMouseDown={() => handleSelect(s)}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-[#00C853]/5 border-b border-gray-50 last:border-0"
                >
                  {s.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Use my location */}
        <button
          type="button"
          onClick={handleUseLocation}
          disabled={isLocating}
          title={t('walk.use_my_location')}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#00C853]/10 text-[#00C853] flex items-center justify-center hover:bg-[#00C853]/20 transition-colors disabled:opacity-50"
        >
          {isLocating ? (
            <div className="w-4 h-4 border-2 border-[#00C853] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </button>
        {/* Set on map */}
        <button
          type="button"
          onClick={onSetOnMap}
          title={t('walk.set_on_map')}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#6C5CE7]/10 text-[#6C5CE7] flex items-center justify-center hover:bg-[#6C5CE7]/20 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </button>
      </div>
      {coords && (
        <p className="mt-1 text-xs text-[#00C853] flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </p>
      )}
    </div>
  );
}

// ─── MapPickerModal ────────────────────────────────────────────────────────────

interface MapPickerModalProps {
  isOpen: boolean;
  title: string;
  initialCenter: [number, number];
  markerPos: [number, number] | null;
  onMarkerChange: (lat: number, lng: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function MapPickerModal({ isOpen, title, initialCenter, markerPos, onMarkerChange, onConfirm, onClose }: MapPickerModalProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="mt-auto bg-white rounded-t-2xl overflow-hidden flex flex-col"
        style={{ height: '72vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-center text-gray-500 py-2 bg-gray-50 flex-shrink-0">Tap anywhere on the map to place a pin</p>
        {/* Map */}
        <div className="flex-1 min-h-0">
          <MapContainer
            center={initialCenter}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapClickHandler onMapClick={onMarkerChange} />
            {markerPos && <Marker position={markerPos} />}
          </MapContainer>
        </div>
        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!markerPos}
            className="flex-1 py-2.5 rounded-xl bg-[#00C853] text-white text-sm font-bold disabled:opacity-40"
          >
            Confirm location
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Route Result Map ──────────────────────────────────────────────────────────

function RouteResultMap({ result }: { result: RouteProposal }) {
  const geojson = result.geojson as { coordinates?: number[][] };
  const rawCoords = geojson?.coordinates ?? [];
  // GeoJSON = [lng, lat], Leaflet = [lat, lng]
  const latLngs: [number, number][] = rawCoords.map(([lng, lat]) => [lat as number, lng as number]);
  const startPos = latLngs[0] ?? [48.8566, 2.3522];
  const endPos = latLngs[latLngs.length - 1];
  const isLoop = !endPos || (endPos[0] === startPos[0] && endPos[1] === startPos[1]);

  return (
    <div style={{ height: 220 }}>
      <MapContainer
        center={startPos}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {latLngs.length > 1 && (
          <Polyline positions={latLngs} color="#00C853" weight={4} opacity={0.9} />
        )}
        {startPos && <Marker position={startPos} icon={startIcon} />}
        {!isLoop && endPos && <Marker position={endPos} icon={endIcon} />}
        <MapAutoFit coordinates={latLngs} />
      </MapContainer>
    </div>
  );
}

// ─── Navigation Sheet ──────────────────────────────────────────────────────────

function NavigationSheet({ isOpen, onClose, result }: { isOpen: boolean; onClose: () => void; result: RouteProposal }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const sc = result.start_coords;
  const ec = result.end_coords;
  const startLat = sc?.lat ?? 0;
  const startLng = sc?.lng ?? 0;
  const destLat = ec?.lat ?? startLat;
  const destLng = ec?.lng ?? startLng;

  const geojson = result.geojson as { coordinates?: number[][] };
  const coords = geojson?.coordinates ?? [];
  const midPoints = coords.filter((_, i) => i % 12 === 0 && i > 0 && i < coords.length - 1).slice(0, 6);
  const waypointsStr = midPoints.map(([lng, lat]) => `${lat},${lng}`).join('|');

  const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${destLat},${destLng}&travelmode=walking${waypointsStr ? `&waypoints=${waypointsStr}` : ''}`;
  const appleUrl = `https://maps.apple.com/?saddr=${startLat},${startLng}&daddr=${destLat},${destLng}&dirflg=w`;
  const wazeUrl = `https://waze.com/ul?ll=${destLat},${destLng}&navigate=yes`;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const links = [
    { label: t('walk.maps_google'), emoji: '🗺️', url: googleUrl, recommended: !isIOS },
    { label: t('walk.maps_apple'), emoji: '🍎', url: appleUrl, recommended: isIOS },
    { label: t('walk.maps_waze'), emoji: '🚗', url: wazeUrl, recommended: false },
  ].sort((a, b) => Number(b.recommended) - Number(a.recommended));

  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl p-5 pb-10 safe-area-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('walk.start_navigation')}</h3>
        <div className="space-y-3">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              <span className="text-2xl">{link.emoji}</span>
              <span className="font-semibold text-gray-800">{link.label}</span>
              {link.recommended && (
                <span className="ml-auto text-xs bg-[#00C853]/10 text-[#00C853] font-semibold px-2.5 py-1 rounded-full">
                  Recommended
                </span>
              )}
              <svg className="w-4 h-4 text-gray-400 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── WalkPage ──────────────────────────────────────────────────────────────────

export default function WalkPage() {
  const { t } = useTranslation();
  const { user, profile } = useAppStore();

  const [mode, setMode] = useState<WalkMode>('loop');
  const [startAddress, setStartAddress] = useState('');
  const [startCoords, setStartCoords] = useState<Coords | null>(null);
  const [endAddress, setEndAddress] = useState('');
  const [endCoords, setEndCoords] = useState<Coords | null>(null);
  const [targetType, setTargetType] = useState<TargetType>('calories');
  const [targetValue, setTargetValue] = useState('300');
  const [pace, setPace] = useState<Pace>('normal');
  const [result, setResult] = useState<RouteProposal | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [wasSaved, setWasSaved] = useState(false);
  const [showNavSheet, setShowNavSheet] = useState(false);
  const [mapPickerField, setMapPickerField] = useState<'start' | 'end' | null>(null);
  const [mapTempCoords, setMapTempCoords] = useState<[number, number] | null>(null);
  const [mapPickerCenter, setMapPickerCenter] = useState<[number, number]>([48.8566, 2.3522]);
  const [genError, setGenError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const generateMutation = useGenerateWalkingRoutes();
  const saveMutation = useSaveWalkingRoute();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const isFormValid = useCallback(() => {
    if (!startCoords) return false;
    if ((mode === 'direct' || mode === 'calorie_detour') && !endCoords) return false;
    const val = parseFloat(targetValue);
    return !isNaN(val) && val > 0;
  }, [startCoords, endCoords, mode, targetValue]);

  const handleGenerate = useCallback(async (seed?: number) => {
    if (!isFormValid()) return;
    setIsGenerating(true);
    setGenError(null);
    setResult(null);
    setWasSaved(false);

    const weightKg = profile?.weight_kg ?? 70;
    const usedSeed = seed ?? Math.floor(Math.random() * 1000);

    try {
      const data = await generateMutation.mutateAsync({
        data: {
          mode,
          lat: startCoords!.lat,
          lng: startCoords!.lng,
          address: startAddress || null,
          endLat: endCoords?.lat ?? null,
          endLng: endCoords?.lng ?? null,
          endAddress: endAddress || null,
          targetType,
          targetValue: parseFloat(targetValue),
          pace,
          weightKg,
          seed: usedSeed,
        },
      });
      setResult(data);
    } catch {
      setGenError(t('walk.error_no_route'));
    } finally {
      setIsGenerating(false);
    }
  }, [isFormValid, profile, mode, startCoords, startAddress, endCoords, endAddress, targetType, targetValue, pace, generateMutation, t]);

  const handleRegenerate = useCallback(() => {
    handleGenerate(Math.floor(Math.random() * 1000));
  }, [handleGenerate]);

  const handleSave = async () => {
    if (!result || !user || isSaving || wasSaved) return;
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        data: {
          user_id: user.id,
          start_location: {
            lat: startCoords?.lat,
            lng: startCoords?.lng,
            address: startAddress || null,
          },
          target_type: targetType,
          target_value: parseFloat(targetValue),
          generated_route: result.geojson as Record<string, unknown>,
          distance_km: result.distance_km,
          duration_min: result.duration_min,
          estimated_calories: result.estimated_calories,
          completed: false,
        },
      });
      setWasSaved(true);
      showToast(t('walk.saved'));

      // Coach message in background
      if (user.id) {
        supabase.from('coach_messages').insert({
          user_id: user.id,
          role: 'assistant',
          content: `Nice walk planned! ${result.distance_km} km for ~${result.estimated_calories} kcal. Let me know when you complete it — I'll log it in your daily total! 🚶`,
          type: 'proactive_suggestion',
          read: false,
        }).then(() => {});
      }
    } catch {
      showToast('Could not save route.');
    } finally {
      setIsSaving(false);
    }
  };

  const openMapPicker = (field: 'start' | 'end') => {
    const existing = field === 'start' ? startCoords : endCoords;
    if (existing) {
      setMapPickerCenter([existing.lat, existing.lng]);
      setMapTempCoords([existing.lat, existing.lng]);
    } else if (startCoords && field === 'end') {
      setMapPickerCenter([startCoords.lat, startCoords.lng]);
      setMapTempCoords(null);
    }
    setMapPickerField(field);
  };

  const confirmMapPicker = async () => {
    if (!mapTempCoords) return;
    const [lat, lng] = mapTempCoords;
    const address = await nominatimReverse(lat, lng);
    const addrStr = address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (mapPickerField === 'start') {
      setStartAddress(addrStr);
      setStartCoords({ lat, lng });
    } else {
      setEndAddress(addrStr);
      setEndCoords({ lat, lng });
    }
    setMapPickerField(null);
    setMapTempCoords(null);
  };

  const targetDefaultValues: Record<TargetType, string> = { calories: '300', minutes: '45', distance: '5' };
  const targetUnit: Record<TargetType, string> = { calories: 'kcal', minutes: 'min', distance: 'km' };

  return (
    <div className="min-h-screen bg-[#FAFAF7] pb-28">
      {/* Header */}
      <div className="pt-12 px-4 pb-4 bg-white border-b border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900">{t('walk.title')}</h1>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* ── Mode Selector ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mode</p>
          <div className="flex gap-2 flex-wrap">
            {(['loop', 'direct', 'calorie_detour'] as WalkMode[]).map((m) => {
              const labels: Record<WalkMode, string> = {
                loop: t('walk.mode_loop'),
                direct: t('walk.mode_direct'),
                calorie_detour: t('walk.mode_calorie'),
              };
              return (
                <button
                  key={m}
                  onClick={() => { setMode(m); setResult(null); setGenError(null); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    mode === m
                      ? 'bg-[#00C853] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {labels[m]}
                  {m === 'calorie_detour' && (
                    <span className="text-[9px] font-bold bg-[#FF6B35] text-white px-1.5 py-0.5 rounded-full leading-none">
                      {t('walk.beta')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Address Fields ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          <AddressInput
            label={t('walk.starting_point')}
            value={startAddress}
            coords={startCoords}
            onChange={(v, c) => { setStartAddress(v); setStartCoords(c); setResult(null); }}
            onSetOnMap={() => openMapPicker('start')}
            placeholder={t('walk.address_placeholder')}
          />
          {(mode === 'direct' || mode === 'calorie_detour') && (
            <AddressInput
              label={t('walk.ending_point')}
              value={endAddress}
              coords={endCoords}
              onChange={(v, c) => { setEndAddress(v); setEndCoords(c); setResult(null); }}
              onSetOnMap={() => openMapPicker('end')}
              placeholder={t('walk.address_placeholder')}
            />
          )}
        </div>

        {/* ── Goal ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('walk.target_type')}</p>
          <div className="flex gap-2 mb-3">
            {(['calories', 'minutes', 'distance'] as TargetType[]).map((type) => {
              const icons: Record<TargetType, string> = { calories: '🔥', minutes: '⏱', distance: '📍' };
              const shortLabels: Record<TargetType, string> = {
                calories: t('walk.calories_target'),
                minutes: t('walk.minutes_target'),
                distance: t('walk.distance_target'),
              };
              return (
                <button
                  key={type}
                  onClick={() => { setTargetType(type); setTargetValue(targetDefaultValues[type]); }}
                  className={`flex-1 py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all border-2 ${
                    targetType === type
                      ? 'border-[#00C853] bg-[#00C853]/5 text-[#00C853]'
                      : 'border-transparent bg-gray-50 text-gray-500'
                  }`}
                >
                  <div className="text-base mb-0.5">{icons[type]}</div>
                  {shortLabels[type]}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <input
              type="number"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              min="1"
              className="w-full px-4 py-3 pr-16 rounded-xl border border-gray-200 focus:border-[#00C853] outline-none text-xl font-bold text-gray-800 bg-gray-50 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
              {targetUnit[targetType]}
            </span>
          </div>
        </div>

        {/* ── Pace ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('walk.pace')}</p>
          <div className="space-y-2">
            {(['slow', 'normal', 'fast'] as Pace[]).map((p) => {
              const labels: Record<Pace, string> = {
                slow: t('walk.slow'),
                normal: t('walk.normal'),
                fast: t('walk.fast'),
              };
              const met: Record<Pace, string> = { slow: 'MET 3.0', normal: 'MET 3.5', fast: 'MET 4.5' };
              const emoji: Record<Pace, string> = { slow: '🚶', normal: '🚶‍♂️', fast: '🏃' };
              return (
                <button
                  key={p}
                  onClick={() => setPace(p)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                    pace === p
                      ? 'border-[#00C853] bg-[#00C853]/5'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <span className="text-lg">{emoji[p]}</span>
                  <span className={`font-semibold text-sm flex-1 text-left ${pace === p ? 'text-[#00C853]' : 'text-gray-700'}`}>
                    {labels[p]}
                  </span>
                  <span className="text-xs text-gray-400">{met[p]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Generate Button ─────────────────────────────────────────── */}
        <button
          onClick={() => handleGenerate()}
          disabled={!isFormValid() || isGenerating}
          className="w-full py-4 rounded-2xl bg-[#00C853] text-white text-base font-bold shadow-lg shadow-[#00C853]/30 disabled:opacity-40 disabled:shadow-none transition-all active:scale-[0.98]"
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t('walk.generating')}
            </span>
          ) : t('walk.generate_route')}
        </button>

        {!isFormValid() && !isGenerating && (
          <p className="text-xs text-center text-gray-400 -mt-1">{t('walk.enter_address')}</p>
        )}

        {genError && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600 text-center">
            {genError}
          </div>
        )}

        {/* ── Result Card ─────────────────────────────────────────────── */}
        {result && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Route map */}
            <RouteResultMap result={result} />

            <div className="p-4 space-y-3">
              {/* Note */}
              {result.note && (
                <div className="px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700 leading-relaxed">
                  ℹ️ {result.note}
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">📍 {t('walk.distance')}</p>
                  <p className="text-xl font-bold text-gray-800">{result.distance_km}</p>
                  <p className="text-xs text-gray-400">km</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">⏱ {t('walk.duration')}</p>
                  <p className="text-xl font-bold text-gray-800">{result.duration_min}</p>
                  <p className="text-xs text-gray-400">min</p>
                </div>
                <div className="bg-[#00C853]/5 rounded-xl p-3 text-center">
                  <p className="text-xs text-[#00C853]/70 mb-1">🔥 {t('walk.est_calories')}</p>
                  <p className="text-xl font-bold text-[#00C853]">{result.estimated_calories}</p>
                  <p className="text-xs text-[#00C853]/70">kcal</p>
                </div>
              </div>

              {/* Start Navigation CTA */}
              <button
                onClick={() => setShowNavSheet(true)}
                className="w-full py-3.5 rounded-xl bg-[#00C853] text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                {t('walk.start_navigation')}
              </button>

              {/* Secondary actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-gray-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {t('walk.regenerate')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || wasSaved}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                    wasSaved
                      ? 'bg-[#00C853]/10 text-[#00C853] border border-[#00C853]/30'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40'
                  }`}
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  ) : wasSaved ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Saved!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                      {t('walk.save_history')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!result && !isGenerating && !genError && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🗺️</div>
            <p className="text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">{t('walk.no_routes_yet')}</p>
          </div>
        )}
      </div>

      {/* ── Map Picker Modal ───────────────────────────────────────── */}
      <MapPickerModal
        isOpen={mapPickerField !== null}
        title={mapPickerField === 'start' ? t('walk.starting_point') : t('walk.ending_point')}
        initialCenter={mapPickerCenter}
        markerPos={mapTempCoords}
        onMarkerChange={(lat, lng) => setMapTempCoords([lat, lng])}
        onConfirm={confirmMapPicker}
        onClose={() => { setMapPickerField(null); setMapTempCoords(null); }}
      />

      {/* ── Navigation Sheet ───────────────────────────────────────── */}
      {result && (
        <NavigationSheet
          isOpen={showNavSheet}
          onClose={() => setShowNavSheet(false)}
          result={result}
        />
      )}

      {/* ── Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[300] bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-full shadow-lg whitespace-nowrap pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
