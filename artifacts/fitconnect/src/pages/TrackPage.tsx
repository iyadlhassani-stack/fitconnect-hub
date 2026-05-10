import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { useGetTodayLog, getGetTodayLogQueryKey, useUpsertDailyLog, useEstimateMacros, useGetLogsHistory, getGetLogsHistoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Plus, Trash2, Sparkles, Upload, Camera } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type Tab = "today" | "history" | "photos";

import { MealEntryMealType } from "@workspace/api-client-react";
interface MealEntry { name: string; calories: number; protein?: number; carbs?: number; fat?: number; meal_type?: MealEntryMealType; }
interface WorkoutEntry { name: string; duration_min: number; calories_burned?: number; type?: string; }

function MacroRing({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min(1, value / (max || 1));
  const r = 28, cx = 36, cy = 36, stroke = 6;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={72} height={72}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="hsl(var(--foreground))">
          {Math.round(value)}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

export default function TrackPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const profile = useAppStore((s) => s.profile);
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const userId = profile?.id ?? "";

  const [tab, setTab] = useState<Tab>("today");
  const [mealModal, setMealModal] = useState(false);
  const [workoutModal, setWorkoutModal] = useState(false);
  const [aiDesc, setAiDesc] = useState("");
  const [meal, setMeal] = useState<Partial<MealEntry>>({ meal_type: "lunch" });
  const [workout, setWorkout] = useState<Partial<WorkoutEntry>>({ type: "running" });
  const [photoUploading, setPhotoUploading] = useState(false);

  const { data: todayLog, isLoading } = useGetTodayLog(
    { userId, date: today },
    { query: { enabled: !!userId, queryKey: getGetTodayLogQueryKey({ userId, date: today }) } }
  );

  const { data: history } = useGetLogsHistory(
    { userId, days: 30 },
    { query: { enabled: !!userId && tab === "history", queryKey: getGetLogsHistoryQueryKey({ userId, days: 30 }) } }
  );

  const upsertLog = useUpsertDailyLog();
  const estimateMacros = useEstimateMacros();

  const meals = (todayLog?.meals as MealEntry[]) ?? [];
  const workouts = (todayLog?.workouts as WorkoutEntry[]) ?? [];
  const totalCal = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
  const totalProt = meals.reduce((s, m) => s + (m.protein ?? 0), 0);
  const totalCarbs = meals.reduce((s, m) => s + (m.carbs ?? 0), 0);
  const totalFat = meals.reduce((s, m) => s + (m.fat ?? 0), 0);

  const calorieTarget = profile?.daily_calorie_target ?? 2000;
  const proteinTarget = profile?.daily_protein_target ?? 120;

  const saveMeal = async () => {
    if (!meal.name || !meal.calories) return;
    const updated = [...meals, meal as MealEntry];
    await upsertLog.mutateAsync({ data: { user_id: userId, date: today, meals: updated } });
    qc.invalidateQueries({ queryKey: getGetTodayLogQueryKey({ userId, date: today }) });
    setMealModal(false);
    setMeal({ meal_type: "lunch" });
    setAiDesc("");
    toast({ title: "Meal logged!" });
  };

  const deleteMeal = async (idx: number) => {
    const updated = meals.filter((_, i) => i !== idx);
    await upsertLog.mutateAsync({ data: { user_id: userId, date: today, meals: updated } });
    qc.invalidateQueries({ queryKey: getGetTodayLogQueryKey({ userId, date: today }) });
  };

  const saveWorkout = async () => {
    if (!workout.name || !workout.duration_min) return;
    const updated = [...workouts, workout as WorkoutEntry];
    await upsertLog.mutateAsync({ data: { user_id: userId, date: today, workouts: updated } });
    qc.invalidateQueries({ queryKey: getGetTodayLogQueryKey({ userId, date: today }) });
    setWorkoutModal(false);
    setWorkout({ type: "running" });
    toast({ title: "Workout logged!" });
  };

  const estimateWithAI = async () => {
    if (!aiDesc) return;
    const resp = await estimateMacros.mutateAsync({
      data: { description: aiDesc, language: profile?.language ?? "en" }
    });
    setMeal({ name: resp.name, calories: resp.calories, protein: resp.protein, carbs: resp.carbs, fat: resp.fat, meal_type: "lunch" });
  };

  const uploadPhoto = async (file: File) => {
    if (!profile?.id) return;
    setPhotoUploading(true);
    try {
      const path = `${profile.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("progress-photos").upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("progress-photos").getPublicUrl(path);
      await supabase.from("progress_photos").insert({ user_id: profile.id, photo_url: publicUrl, date: today });
      toast({ title: "Photo uploaded!" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const weightData = (history ?? [])
    .filter((l) => l.weight_kg)
    .map((l) => ({ date: format(new Date(l.date), "MM/dd"), weight: parseFloat(String(l.weight_kg)) }))
    .reverse();

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)] max-w-lg mx-auto w-full">
      {/* Tabs */}
      <div className="flex border-b border-border bg-card flex-shrink-0">
        {(["today", "history", "photos"] as Tab[]).map((t_) => (
          <button
            key={t_}
            data-testid={`tab-${t_}`}
            onClick={() => setTab(t_)}
            className={`flex-1 py-3 text-sm font-semibold transition-all border-b-2 ${tab === t_ ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            {t(`track.${t_}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* TODAY */}
        {tab === "today" && (
          <div className="px-4 py-4 space-y-5">
            {isLoading ? (
              <Skeleton className="h-32 rounded-2xl" />
            ) : (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Today's Macros</h3>
                <div className="flex justify-around">
                  <MacroRing value={totalCal} max={calorieTarget} color="#00C853" label={t("track.calories")} />
                  <MacroRing value={totalProt} max={proteinTarget} color="#6C5CE7" label={t("track.protein")} />
                  <MacroRing value={totalCarbs} max={200} color="#FF6B35" label={t("track.carbs")} />
                  <MacroRing value={totalFat} max={70} color="#00B8D4" label={t("track.fat")} />
                </div>
              </div>
            )}

            {/* Meals */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-foreground">Meals</h3>
                <Button size="sm" className="rounded-xl gap-1 h-8 text-xs" onClick={() => setMealModal(true)}>
                  <Plus className="w-3 h-3" /> {t("track.add_meal")}
                </Button>
              </div>
              <div className="space-y-2">
                {meals.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No meals logged yet</p>}
                {meals.map((m, i) => (
                  <div key={i} data-testid={`meal-item-${i}`} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.calories} kcal · {m.protein ?? 0}g protein</p>
                    </div>
                    <button onClick={() => deleteMeal(i)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Workouts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-foreground">Workouts</h3>
                <Button size="sm" variant="outline" className="rounded-xl gap-1 h-8 text-xs" onClick={() => setWorkoutModal(true)}>
                  <Plus className="w-3 h-3" /> {t("track.add_workout")}
                </Button>
              </div>
              <div className="space-y-2">
                {workouts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No workouts logged yet</p>}
                {workouts.map((w, i) => (
                  <div key={i} data-testid={`workout-item-${i}`} className="bg-card border border-border rounded-xl p-3">
                    <p className="font-semibold text-sm text-foreground">{w.name}</p>
                    <p className="text-xs text-muted-foreground">{w.duration_min} min · {w.calories_burned ?? "?"} kcal</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <div className="px-4 py-4 space-y-4">
            {weightData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Weight Trend</h3>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={weightData}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis domain={["auto", "auto"]} hide />
                    <Tooltip contentStyle={{ borderRadius: "12px", fontSize: 12 }} formatter={(v: number) => [`${v} kg`, "Weight"]} />
                    <Line type="monotone" dataKey="weight" stroke="#00C853" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="space-y-2">
              {(history ?? []).map((log) => {
                const logMeals = (log.meals as MealEntry[]) ?? [];
                const cals = logMeals.reduce((s, m) => s + (m.calories ?? 0), 0);
                return (
                  <div key={log.date} data-testid={`history-log-${log.date}`} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-foreground">{format(new Date(log.date), "EEE, MMM d")}</p>
                      <p className="text-xs text-muted-foreground">{cals} kcal · {logMeals.length} meals</p>
                    </div>
                    {log.weight_kg && <p className="text-sm font-bold text-foreground">{parseFloat(String(log.weight_kg))}kg</p>}
                  </div>
                );
              })}
              {(history ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No history yet. Start logging!</p>}
            </div>
          </div>
        )}

        {/* PHOTOS */}
        {tab === "photos" && (
          <div className="px-4 py-4 space-y-4">
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-2xl py-10 cursor-pointer active:bg-muted/50 transition-colors">
              {photoUploading ? (
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
              ) : (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-foreground">Upload Progress Photo</p>
                    <p className="text-xs text-muted-foreground mt-1">Track your visual progress over time</p>
                  </div>
                  <Button size="sm" className="rounded-xl gap-1" onClick={(e) => e.preventDefault()}>
                    <Upload className="w-3.5 h-3.5" /> Choose Photo
                  </Button>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
            </label>
          </div>
        )}
      </div>

      {/* Meal Modal */}
      <Dialog open={mealModal} onOpenChange={setMealModal}>
        <DialogContent className="rounded-2xl mx-4 max-w-sm max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("track.add_meal")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">AI Estimate</Label>
              <div className="flex gap-2 mt-1">
                <Textarea
                  value={aiDesc}
                  onChange={(e) => setAiDesc(e.target.value)}
                  placeholder="Describe your meal..."
                  className="resize-none rounded-xl text-sm"
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 rounded-xl gap-1 self-end h-9"
                  onClick={estimateWithAI}
                  disabled={estimateMacros.isPending || !aiDesc}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {estimateMacros.isPending ? "..." : "Estimate"}
                </Button>
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("track.meal_name")}</Label>
                <Input value={meal.name ?? ""} onChange={(e) => setMeal((p) => ({ ...p, name: e.target.value }))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {(["calories", "protein", "carbs", "fat"] as const).map((field) => (
                  <div key={field}>
                    <Label className="text-xs text-muted-foreground">{t(`track.${field}`)}</Label>
                    <Input type="number" value={meal[field] ?? ""} onChange={(e) => setMeal((p) => ({ ...p, [field]: parseFloat(e.target.value) || 0 }))} className="mt-1 h-10 rounded-xl text-sm" />
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">{t("track.meal_type")}</Label>
                <Select value={meal.meal_type ?? "lunch"} onValueChange={(v) => setMeal((p) => ({ ...p, meal_type: v as MealEntryMealType }))}>
                  <SelectTrigger className="mt-1 h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["breakfast", "lunch", "dinner", "snack"].map((v) => (
                      <SelectItem key={v} value={v}>{t(`track.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full h-11 rounded-xl" onClick={saveMeal} disabled={upsertLog.isPending}>
              {upsertLog.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Workout Modal */}
      <Dialog open={workoutModal} onOpenChange={setWorkoutModal}>
        <DialogContent className="rounded-2xl mx-4 max-w-sm">
          <DialogHeader><DialogTitle>{t("track.add_workout")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("track.workout_name")}</Label>
              <Input value={workout.name ?? ""} onChange={(e) => setWorkout((p) => ({ ...p, name: e.target.value }))} className="mt-1 h-10 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">{t("track.duration")}</Label>
                <Input type="number" value={workout.duration_min ?? ""} onChange={(e) => setWorkout((p) => ({ ...p, duration_min: parseInt(e.target.value) || 0 }))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Calories Burned</Label>
                <Input type="number" value={workout.calories_burned ?? ""} onChange={(e) => setWorkout((p) => ({ ...p, calories_burned: parseInt(e.target.value) || 0 }))} className="mt-1 h-10 rounded-xl" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("track.workout_type")}</Label>
              <Select value={workout.type ?? "running"} onValueChange={(v) => setWorkout((p) => ({ ...p, type: v }))}>
                <SelectTrigger className="mt-1 h-10 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["running", "cycling", "swimming", "strength", "yoga", "walking"].map((v) => (
                    <SelectItem key={v} value={v}>{t(`track.${v}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full h-11 rounded-xl" onClick={saveWorkout} disabled={upsertLog.isPending}>
              {upsertLog.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
