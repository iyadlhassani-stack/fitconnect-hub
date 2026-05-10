import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { useGenerateWalkingRoutes, useSaveWalkingRoute, useGetRouteHistory, getGetRouteHistoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Navigation, Flame, Clock, Route, ChevronRight, History } from "lucide-react";

type TargetType = "calories" | "minutes" | "distance";
type Pace = "slow" | "normal" | "fast";

interface RouteProposal {
  distance_km: number;
  duration_min: number;
  estimated_calories: number;
  geojson: object;
}

function SimpleMapPreview({ route }: { route: RouteProposal }) {
  const coords = (route.geojson as { coordinates?: number[][] })?.coordinates;
  if (!coords || coords.length < 2) return (
    <div className="h-28 rounded-xl bg-muted flex items-center justify-center">
      <Route className="w-8 h-8 text-muted-foreground" />
    </div>
  );

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const rangeLng = maxLng - minLng || 0.001;
  const rangeLat = maxLat - minLat || 0.001;
  const W = 280, H = 112, pad = 12;

  const toX = (lng: number) => pad + ((lng - minLng) / rangeLng) * (W - 2 * pad);
  const toY = (lat: number) => H - pad - ((lat - minLat) / rangeLat) * (H - 2 * pad);

  const points = coords.map((c) => `${toX(c[0])},${toY(c[1])}`).join(" ");

  return (
    <div className="h-28 rounded-xl bg-green-50 dark:bg-green-950/20 overflow-hidden">
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#00C853" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coords[0] && <circle cx={toX(coords[0][0])} cy={toY(coords[0][1])} r="5" fill="#00C853" />}
      </svg>
    </div>
  );
}

export default function WalkPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const profile = useAppStore((s) => s.profile);
  const qc = useQueryClient();
  const userId = profile?.id ?? "";

  const [startAddress, setStartAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<TargetType>("calories");
  const [targetValue, setTargetValue] = useState("300");
  const [pace, setPace] = useState<Pace>("normal");
  const [routes, setRoutes] = useState<RouteProposal[]>([]);
  const [activeRoute, setActiveRoute] = useState<RouteProposal | null>(null);
  const [walking, setWalking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timer, setTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const generateRoutes = useGenerateWalkingRoutes();
  const saveRoute = useSaveWalkingRoute();
  const { data: history } = useGetRouteHistory(
    { userId },
    { query: { enabled: !!userId, queryKey: getGetRouteHistoryQueryKey({ userId }) } }
  );

  const getLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Error", description: "Geolocation not supported", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setStartAddress(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
      },
      () => toast({ title: "Error", description: "Could not get location", variant: "destructive" })
    );
  };

  const handleGenerate = async () => {
    const locLat = lat ?? 48.8566;
    const locLng = lng ?? 2.3522;
    try {
      const results = await generateRoutes.mutateAsync({
        data: {
          lat: locLat,
          lng: locLng,
          address: startAddress || null,
          targetType,
          targetValue: parseFloat(targetValue) || 300,
          pace,
          weightKg: profile?.weight_kg ?? 70,
        },
      });
      setRoutes(results as RouteProposal[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate routes";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const startWalk = (route: RouteProposal) => {
    setActiveRoute(route);
    setWalking(true);
    setElapsed(0);
    const t_ = setInterval(() => setElapsed((s) => s + 1), 1000);
    setTimer(t_);
  };

  const finishWalk = async () => {
    if (timer) clearInterval(timer);
    setWalking(false);
    if (!activeRoute || !userId) return;
    const actualMin = Math.round(elapsed / 60);
    const met = { slow: 3, normal: 3.5, fast: 4.5 }[pace];
    const actualCal = Math.round(met * (profile?.weight_kg ?? 70) * (actualMin / 60));
    await saveRoute.mutateAsync({
      data: {
        user_id: userId,
        start_location: { lat: lat ?? 48.8566, lng: lng ?? 2.3522, address: startAddress || null },
        target_type: targetType,
        target_value: parseFloat(targetValue),
        generated_route: activeRoute.geojson as Record<string, unknown>,
        distance_km: activeRoute.distance_km,
        duration_min: activeRoute.duration_min,
        estimated_calories: activeRoute.estimated_calories,
        completed: true,
        actual_calories: actualCal,
      },
    });
    qc.invalidateQueries({ queryKey: getGetRouteHistoryQueryKey({ userId }) });
    toast({ title: "Walk completed!", description: `${actualCal} calories burned in ${actualMin} minutes.` });
    setActiveRoute(null);
    setElapsed(0);
  };

  useEffect(() => {
    return () => { if (timer) clearInterval(timer); };
  }, [timer]);

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const unitLabel = targetType === "calories" ? "kcal" : targetType === "minutes" ? "min" : "km";

  if (walking && activeRoute) {
    return (
      <div className="flex flex-col h-[calc(100dvh-64px)] max-w-lg mx-auto w-full px-4 py-6 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Navigation className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-extrabold text-foreground">{formatTime(elapsed)}</p>
            <p className="text-muted-foreground text-sm mt-1">elapsed time</p>
          </div>
          <div className="flex gap-6 text-center">
            <div><p className="font-bold text-foreground">{activeRoute.distance_km} km</p><p className="text-xs text-muted-foreground">distance</p></div>
            <div><p className="font-bold text-foreground">{activeRoute.estimated_calories}</p><p className="text-xs text-muted-foreground">est. kcal</p></div>
          </div>
        </div>

        <SimpleMapPreview route={activeRoute} />

        <Button
          data-testid="button-finish-walk"
          className="w-full h-14 rounded-2xl text-lg font-bold"
          style={{ background: "#FF6B35" }}
          onClick={finishWalk}
        >
          {t("walk.finish_walk")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("walk.disclaimer")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)] overflow-y-auto max-w-lg mx-auto w-full px-4 py-4 gap-5">
      <h1 className="text-xl font-extrabold text-foreground">{t("walk.title")}</h1>

      {/* Form */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("walk.starting_point")}</Label>
          <div className="flex gap-2 mt-1">
            <Input
              data-testid="input-start-address"
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              placeholder="Enter address or use location"
              className="flex-1 h-11 rounded-xl"
            />
            <Button variant="outline" className="h-11 px-3 rounded-xl flex-shrink-0" onClick={getLocation}>
              <MapPin className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{t("walk.target_type")}</Label>
          <div className="flex gap-2">
            {(["calories", "minutes", "distance"] as TargetType[]).map((type) => (
              <button
                key={type}
                data-testid={`target-type-${type}`}
                onClick={() => setTargetType(type)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${targetType === type ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
              >
                {t(`walk.${type}_target`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Target ({unitLabel})
          </Label>
          <Input
            data-testid="input-target-value"
            type="number"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            className="mt-1 h-11 rounded-xl text-lg font-semibold"
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{t("walk.pace")}</Label>
          <div className="flex gap-2">
            {(["slow", "normal", "fast"] as Pace[]).map((p) => (
              <button
                key={p}
                data-testid={`pace-${p}`}
                onClick={() => setPace(p)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${pace === p ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
              >
                {t(`walk.${p}`)}
              </button>
            ))}
          </div>
        </div>

        <Button
          data-testid="button-generate-routes"
          className="w-full h-12 rounded-xl font-semibold"
          onClick={handleGenerate}
          disabled={generateRoutes.isPending}
        >
          {generateRoutes.isPending ? "Generating..." : t("walk.generate_routes")}
        </Button>

        <p className="text-xs text-muted-foreground text-center">{t("walk.loop_only")} — point-to-point coming soon</p>
      </div>

      {/* Route proposals */}
      {generateRoutes.isPending && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      )}

      {routes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-foreground">Route Proposals</h2>
          {routes.map((route, i) => (
            <div key={i} data-testid={`route-card-${i}`} className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <SimpleMapPreview route={route} />
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <Route className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{route.distance_km} km</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{route.duration_min} min</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Flame className="w-4 h-4" style={{ color: "#FF6B35" }} />
                  <span className="text-sm text-muted-foreground">{route.estimated_calories} kcal</span>
                </div>
              </div>
              <Button
                data-testid={`button-start-route-${i}`}
                className="w-full h-11 rounded-xl"
                onClick={() => startWalk(route)}
              >
                {t("walk.start_walk")} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {routes.length === 0 && !generateRoutes.isPending && (
        <p className="text-center text-sm text-muted-foreground py-4">{t("walk.no_routes_yet")}</p>
      )}

      {/* History */}
      {(history ?? []).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-bold text-foreground">Past Walks</h2>
          </div>
          <div className="space-y-2">
            {(history ?? []).slice(0, 5).map((r) => (
              <div key={r.id} data-testid={`history-route-${r.id}`} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm text-foreground">{r.distance_km} km walk</p>
                  <p className="text-xs text-muted-foreground">{r.estimated_calories} kcal est.</p>
                </div>
                {r.completed && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">{t("walk.disclaimer")}</p>
    </div>
  );
}
