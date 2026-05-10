import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/useAppStore";
import { useGetTodayLog, getGetTodayLogQueryKey, useGetUserStats, getGetUserStatsQueryKey, useGetLogsHistory, getGetLogsHistoryQueryKey, useUpsertDailyLog } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Flame, Zap, Footprints, Droplets, Plus, TrendingUp, Bot, Dumbbell, Scale } from "lucide-react";
import { format, subDays } from "date-fns";

function getGreeting(t: (key: string) => string) {
  const h = new Date().getHours();
  if (h < 12) return t("home.good_morning");
  if (h < 17) return t("home.good_afternoon");
  if (h < 21) return t("home.good_evening");
  return t("home.good_night");
}

export default function HomePage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const profile = useAppStore((s) => s.profile);
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [waterModal, setWaterModal] = useState(false);
  const [weightModal, setWeightModal] = useState(false);
  const [weightValue, setWeightValue] = useState("");

  const userId = profile?.id ?? "";

  const { data: todayLog, isLoading: logLoading } = useGetTodayLog(
    { userId, date: today },
    { query: { enabled: !!userId, queryKey: getGetTodayLogQueryKey({ userId, date: today }) } }
  );

  const { data: stats, isLoading: statsLoading } = useGetUserStats(
    { userId },
    { query: { enabled: !!userId, queryKey: getGetUserStatsQueryKey({ userId }) } }
  );

  const { data: history } = useGetLogsHistory(
    { userId, days: 7 },
    { query: { enabled: !!userId, queryKey: getGetLogsHistoryQueryKey({ userId, days: 7 }) } }
  );

  const upsertLog = useUpsertDailyLog();

  const meals = (todayLog?.meals as Array<{ calories?: number; protein?: number }>) ?? [];
  const workouts = (todayLog?.workouts as Array<{ name: string }>) ?? [];
  const totalCalories = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein ?? 0), 0);
  const waterLiters = (todayLog?.water_liters as number) ?? 0;
  const calorieTarget = profile?.daily_calorie_target ?? 2000;
  const proteinTarget = profile?.daily_protein_target ?? 120;

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date = format(subDays(new Date(), 6 - i), "yyyy-MM-dd");
    const log = (history ?? []).find((l) => l.date === date);
    const cals = log ? (log.meals as Array<{ calories?: number }>).reduce((s, m) => s + (m.calories ?? 0), 0) : 0;
    return { day: format(subDays(new Date(), 6 - i), "EEE"), calories: cals };
  });

  const addWater = async (amount: number) => {
    if (!userId) return;
    const newWater = waterLiters + amount;
    await upsertLog.mutateAsync({ data: { user_id: userId, date: today, water_liters: newWater } });
    qc.invalidateQueries({ queryKey: getGetTodayLogQueryKey({ userId, date: today }) });
    toast({ title: `+${amount * 1000}ml logged` });
  };

  const logWeight = async () => {
    if (!userId || !weightValue) return;
    await upsertLog.mutateAsync({ data: { user_id: userId, date: today, weight_kg: parseFloat(weightValue) } });
    qc.invalidateQueries({ queryKey: getGetTodayLogQueryKey({ userId, date: today }) });
    qc.invalidateQueries({ queryKey: getGetUserStatsQueryKey({ userId }) });
    setWeightModal(false);
    setWeightValue("");
    toast({ title: "Weight logged!" });
  };

  const name = profile?.full_name?.split(" ")[0] ?? "there";
  const streak = stats?.streak_count ?? profile?.streak_count ?? 0;

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-4 max-w-lg mx-auto w-full">
      {/* Greeting */}
      <div>
        <p className="text-muted-foreground text-sm font-medium">{getGreeting(t)},</p>
        <h1 data-testid="text-greeting" className="text-2xl font-extrabold text-foreground tracking-tight">{name} 👋</h1>
      </div>

      {/* Streak card */}
      {statsLoading ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : (
        <div className="rounded-2xl p-4 flex items-center gap-4" style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%)" }}>
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white/80 text-xs font-semibold uppercase tracking-wide">{t("home.dont_break_chain") ?? "Don't break the chain!"}</p>
            <p data-testid="text-streak" className="text-white text-2xl font-extrabold">{streak} <span className="text-lg font-semibold">{t("home.streak_days")}</span></p>
          </div>
        </div>
      )}

      {/* Quick stats */}
      {logLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* Calories */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("home.calories")}</span>
            </div>
            <p className="text-xl font-extrabold text-foreground">{totalCalories}</p>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (totalCalories / calorieTarget) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">/ {calorieTarget} kcal</p>
          </div>

          {/* Protein */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Dumbbell className="w-4 h-4" style={{ color: "#6C5CE7" }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("home.protein")}</span>
            </div>
            <p className="text-xl font-extrabold text-foreground">{Math.round(totalProtein)}g</p>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (totalProtein / proteinTarget) * 100)}%`, backgroundColor: "#6C5CE7" }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">/ {proteinTarget}g</p>
          </div>

          {/* Workouts */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Footprints className="w-4 h-4" style={{ color: "#00B8D4" }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("home.workouts")}</span>
            </div>
            <p className="text-xl font-extrabold text-foreground">{workouts.length}</p>
            <p className="text-xs text-muted-foreground mt-1">logged today</p>
          </div>

          {/* Water */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Droplets className="w-4 h-4" style={{ color: "#00B8D4" }} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("home.water")}</span>
            </div>
            <p className="text-xl font-extrabold text-foreground">{waterLiters.toFixed(1)}L</p>
            <button
              data-testid="button-add-water"
              onClick={() => setWaterModal(true)}
              className="mt-2 flex items-center gap-1 text-xs text-primary font-semibold"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">{t("home.quick_actions")}</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t("home.log_meal"), icon: Plus, action: () => setLocation("/track"), color: "#00C853" },
            { label: t("home.log_workout"), icon: Dumbbell, action: () => setLocation("/track"), color: "#6C5CE7" },
            { label: t("home.log_weight"), icon: Scale, action: () => setWeightModal(true), color: "#FF6B35" },
            { label: t("home.generate_walk"), icon: Footprints, action: () => setLocation("/walk"), color: "#00B8D4" },
          ].map(({ label, icon: Icon, action, color }) => (
            <button
              key={label}
              data-testid={`button-quick-${label.replace(/\s/g, "-").toLowerCase()}`}
              onClick={action}
              className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3 active:scale-95 transition-transform"
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}18` }}>
                <Icon className="w-5 h-5" style={{ color }} />
              </div>
              <span className="text-sm font-semibold text-foreground text-left">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* AI Coach teaser */}
      <button
        data-testid="button-coach-teaser"
        onClick={() => setLocation("/coach")}
        className="rounded-2xl p-4 flex items-center gap-4 text-left"
        style={{ background: "linear-gradient(135deg, #6C5CE7 0%, #8B7CF8 100%)" }}
      >
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-white font-bold">Chat with your AI Coach</p>
          <p className="text-white/70 text-sm">Available 24/7 to help you reach your goals</p>
        </div>
      </button>

      {/* Weekly chart */}
      <div className="bg-card rounded-2xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">This Week</h2>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} barSize={20}>
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))", fontSize: 12 }}
              formatter={(v: number) => [`${v} kcal`, ""]}
            />
            <Bar dataKey="calories" radius={6}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.day === format(new Date(), "EEE") ? "#00C853" : "#E8F5E9"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Water modal */}
      <Dialog open={waterModal} onOpenChange={setWaterModal}>
        <DialogContent className="rounded-2xl mx-4 max-w-sm">
          <DialogHeader><DialogTitle>Add Water</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {[0.25, 0.5, 0.75, 1].map((amt) => (
              <Button
                key={amt}
                variant="outline"
                className="h-14 rounded-xl text-lg font-bold"
                onClick={() => { addWater(amt); setWaterModal(false); }}
              >
                +{amt * 1000}ml
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Weight modal */}
      <Dialog open={weightModal} onOpenChange={setWeightModal}>
        <DialogContent className="rounded-2xl mx-4 max-w-sm">
          <DialogHeader><DialogTitle>Log Weight</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Weight (kg)</Label>
              <Input
                data-testid="input-weight-log"
                type="number"
                value={weightValue}
                onChange={(e) => setWeightValue(e.target.value)}
                className="mt-1 h-12 rounded-xl text-lg"
                placeholder="70.5"
              />
            </div>
            <Button className="w-full h-12 rounded-xl" onClick={logWeight}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
