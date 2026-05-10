import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Activity, Mail, Lock, Chrome } from "lucide-react";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (forgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        toast({ title: "Email sent!", description: "Check your inbox for a reset link." });
        setForgotPassword(false);
        setLoading(false);
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast({ title: "Account created!", description: t("auth.verify_email") });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setLocation("/");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      toast({ title: t("common.error"), description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) toast({ title: t("common.error"), description: error.message, variant: "destructive" });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <Activity className="w-9 h-9 text-white" strokeWidth={2.5} />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">FitConnect</h1>
            <p className="text-muted-foreground text-sm mt-1">{t("onboarding.tagline")}</p>
          </div>
        </div>

        {/* Mode tabs */}
        {!forgotPassword && (
          <div className="flex rounded-xl bg-muted p-1 gap-1">
            <button
              data-testid="tab-signin"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "signin" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {t("auth.sign_in")}
            </button>
            <button
              data-testid="tab-signup"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === "signup" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {t("auth.sign_up")}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {forgotPassword && (
            <h2 className="text-xl font-bold text-foreground">{t("auth.forgot_password")}</h2>
          )}

          <div className="space-y-1">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                data-testid="input-email"
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12 rounded-xl"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          {!forgotPassword && (
            <div className="space-y-1">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  data-testid="input-password"
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-12 rounded-xl"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
            </div>
          )}

          <Button
            data-testid="button-submit"
            type="submit"
            className="w-full h-12 rounded-xl font-semibold text-base"
            disabled={loading}
          >
            {loading ? t("common.loading") : forgotPassword ? "Send Reset Link" : mode === "signin" ? t("auth.sign_in") : t("auth.sign_up")}
          </Button>
        </form>

        {!forgotPassword && (
          <>
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-border" />
              <span className="mx-3 text-muted-foreground text-xs">or</span>
              <div className="flex-grow border-t border-border" />
            </div>

            <Button
              data-testid="button-google"
              variant="outline"
              className="w-full h-12 rounded-xl font-semibold gap-2"
              onClick={handleGoogle}
            >
              <Chrome className="w-4 h-4" />
              {t("auth.google_signin")}
            </Button>
          </>
        )}

        <div className="text-center text-sm">
          {forgotPassword ? (
            <button
              className="text-primary font-medium"
              onClick={() => setForgotPassword(false)}
            >
              Back to sign in
            </button>
          ) : mode === "signin" ? (
            <div className="space-y-2">
              <button
                className="text-muted-foreground hover:text-primary transition-colors block mx-auto"
                onClick={() => setForgotPassword(true)}
              >
                {t("auth.forgot_password")}
              </button>
              <p className="text-muted-foreground">
                {t("auth.no_account")}{" "}
                <button className="text-primary font-semibold" onClick={() => setMode("signup")}>
                  {t("auth.sign_up")}
                </button>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              {t("auth.have_account")}{" "}
              <button className="text-primary font-semibold" onClick={() => setMode("signin")}>
                {t("auth.sign_in")}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
