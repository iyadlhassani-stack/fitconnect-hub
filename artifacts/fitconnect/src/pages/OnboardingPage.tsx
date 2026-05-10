import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, TrendingDown, Dumbbell, Heart, Globe,
  ChevronRight, ChevronLeft, Check
} from "lucide-react";
import i18n from "@/i18n";

type Goal = "lose_weight" | "gain_muscle" | "maintain" | "health";
type Level = "beginner" | "intermediate" | "advanced";
type Gender = "male" | "female" | "other";

export default function OnboardingPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const user = useAppStore((s) => s.user);
  const setProfile = useAppStore((s) => s.setProfile);

  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<"en" | "fr">("en");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [diets, setDiets] = useState<string[]>([]);
  const [allergies, setAllergies] = useState("");
  const [loading, setLoading] = useState(false);

  const switchLang = (l: "en" | "fr") => {
    setLang(l);
    i18n.changeLanguage(l);
  };

  const goals: { key: Goal; icon: typeof Activity; color: string }[] = [
    { key: "lose_weight", icon: TrendingDown, color: "#FF6B35" },
    { key: "gain_muscle", icon: Dumbbell, color: "#6C5CE7" },
    { key: "maintain", icon: Activity, color: "#00C853" },
    { key: "health", icon: Heart, color: "#00B8D4" },
  ];

  const dietOptions = ["standard", "halal", "vegan", "vegetarian", "keto"];

  const toggleDiet = (d: string) => {
    setDiets((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const calcCalories = () => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseFloat(age);
    if (!w || !h || !a) return { cal: 2000, protein: 120 };
    const bmr =
      gender === "male"
        ? 10 * w + 6.25 * h - 5 * a + 5
        : 10 * w + 6.25 * h - 5 * a - 161;
    const cal = Math.round(bmr * 1.4);
    const protein = Math.round(w * 2);
    return { cal, protein };
  };

  const extractErrorMessage = (err: unknown): string => {
    if (!err) return "Unknown error";
    if (err instanceof Error) return err.message;
    if (typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.message === "string" && e.message) return e.message;
      if (typeof e.details === "string" && e.details) return e.details;
      if (typeof e.hint === "string" && e.hint) return e.hint;
      if (typeof e.error_description === "string") return e.error_description;
      try { return JSON.stringify(err); } catch { return "Unknown error"; }
    }
    return String(err);
  };

  const handleFinish = async () => {
    if (!user) return;
    setLoading(true);
    const { cal, protein } = calcCalories();
    try {
      const payload = {
        id: user.id,
        email: user.email ?? null,
        full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? null,
        language: lang,
        goal: goal ?? "health",
        weight_kg: parseFloat(weight) || null,
        height_cm: parseFloat(height) || null,
        age: parseInt(age) || null,
        gender: gender ?? null,
        level: level ?? "beginner",
        diet_preferences: { diets, allergies },
        daily_calorie_target: cal,
        daily_protein_target: protein,
        streak_count: 0,
        checkin_times: { morning: "08:00", lunch: "13:00", evening: "18:00", night: "21:00" },
        last_checkin_date: null,
      };

      const { data, error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select()
        .single();

      if (error) {
        const msg = extractErrorMessage(error);
        if (msg.includes("relation") && msg.includes("does not exist")) {
          throw new Error(
            "The 'profiles' table doesn't exist in Supabase yet. " +
            "Please run the setup SQL from the project README in your Supabase SQL editor."
          );
        }
        if (msg.includes("row-level security") || msg.includes("policy")) {
          throw new Error(
            "Supabase Row Level Security is blocking the insert. " +
            "Add an RLS policy: allow users to manage their own profile (auth.uid() = id)."
          );
        }
        throw new Error(msg);
      }

      setProfile(data);

      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      setLocation("/");
    } catch (err: unknown) {
      const message = extractErrorMessage(err);
      toast({ title: t("common.error"), description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${((step + 1) / 4) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col px-6 py-8">
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-8">
            <div className="flex justify-end w-full">
              <div className="flex rounded-xl bg-muted p-1 gap-1">
                {(["en", "fr"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => switchLang(l)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${lang === l ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-6 text-center">
              <div className="w-24 h-24 rounded-3xl bg-primary flex items-center justify-center shadow-xl">
                <Activity className="w-14 h-14 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-4xl font-extrabold text-foreground tracking-tight">FitConnect</h1>
                <p className="text-lg text-muted-foreground mt-2">{t("onboarding.tagline")}</p>
              </div>
            </div>

            <Button
              data-testid="button-get-started"
              className="w-full h-14 rounded-2xl text-lg font-bold"
              onClick={() => setStep(1)}
            >
              {t("onboarding.get_started")} <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 1: Goal */}
        {step === 1 && (
          <div className="flex-1 flex flex-col gap-6">
            <h2 className="text-2xl font-extrabold text-foreground">{t("onboarding.your_goal")}</h2>
            <div className="grid grid-cols-2 gap-3 flex-1">
              {goals.map(({ key, icon: Icon, color }) => (
                <button
                  key={key}
                  data-testid={`goal-${key}`}
                  onClick={() => { setGoal(key); setStep(2); }}
                  className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 transition-all ${goal === key ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                >
                  {goal === key && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
                    <Icon className="w-7 h-7" style={{ color }} />
                  </div>
                  <span className="text-sm font-semibold text-foreground text-center leading-tight">
                    {t(`onboarding.${key === "gain_muscle" ? "build_muscle" : key === "health" ? "improve_health" : key}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: About You */}
        {step === 2 && (
          <div className="flex-1 flex flex-col gap-6">
            <h2 className="text-2xl font-extrabold text-foreground">{t("onboarding.about_you")}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("onboarding.weight_kg")}</Label>
                  <Input
                    data-testid="input-weight"
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="mt-1 h-12 rounded-xl text-lg font-semibold"
                    placeholder="70"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("onboarding.height_cm")}</Label>
                  <Input
                    data-testid="input-height"
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="mt-1 h-12 rounded-xl text-lg font-semibold"
                    placeholder="170"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("onboarding.age")}</Label>
                <Input
                  data-testid="input-age"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="mt-1 h-12 rounded-xl text-lg font-semibold"
                  placeholder="28"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{t("onboarding.gender")}</Label>
                <div className="flex gap-2">
                  {(["male", "female", "other"] as Gender[]).map((g) => (
                    <button
                      key={g}
                      data-testid={`gender-${g}`}
                      onClick={() => setGender(g)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${gender === g ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                    >
                      {t(`onboarding.${g}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{t("onboarding.fitness_level")}</Label>
                <div className="flex gap-2">
                  {(["beginner", "intermediate", "advanced"] as Level[]).map((l) => (
                    <button
                      key={l}
                      data-testid={`level-${l}`}
                      onClick={() => setLevel(l)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${level === l ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                    >
                      {t(`onboarding.${l}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-auto pt-4">
              <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="flex-1 h-12 rounded-xl font-semibold" onClick={() => setStep(3)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Preferences */}
        {step === 3 && (
          <div className="flex-1 flex flex-col gap-6">
            <h2 className="text-2xl font-extrabold text-foreground">{t("onboarding.preferences")}</h2>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Diet</Label>
              <div className="flex flex-wrap gap-2">
                {dietOptions.map((d) => (
                  <button
                    key={d}
                    data-testid={`diet-${d}`}
                    onClick={() => toggleDiet(d)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all ${diets.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {t(`onboarding.diet_${d}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("onboarding.allergies")}</Label>
              <Input
                data-testid="input-allergies"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                className="mt-1 h-12 rounded-xl"
                placeholder="e.g. nuts, gluten, dairy"
              />
            </div>

            <div className="bg-card rounded-2xl p-4 border border-border">
              <p className="text-sm font-semibold text-foreground mb-1">{t("onboarding.allow_notifications")}</p>
              <p className="text-xs text-muted-foreground">Your AI coach will send you timely check-ins to keep you on track.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 rounded-xl"
                onClick={() => "Notification" in window && Notification.requestPermission()}
              >
                Enable Notifications
              </Button>
            </div>

            <div className="flex gap-3 mt-auto pt-4">
              <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                data-testid="button-create-profile"
                className="flex-1 h-12 rounded-xl font-semibold"
                onClick={handleFinish}
                disabled={loading}
              >
                {loading ? t("onboarding.calculating") : t("onboarding.creating_profile")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
