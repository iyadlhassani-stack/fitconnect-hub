import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { BottomNav } from "@/components/layout/BottomNav";
import { useAppStore } from "@/store/useAppStore";

import AuthPage from "@/pages/AuthPage";
import OnboardingPage from "@/pages/OnboardingPage";
import HomePage from "@/pages/HomePage";
import CoachPage from "@/pages/CoachPage";
import TrackPage from "@/pages/TrackPage";
import WalkPage from "@/pages/WalkPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Router() {
  const { loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const user = useAppStore((s) => s.user);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (authLoading || profileLoading) return;

    if (!user) {
      if (location !== "/auth") setLocation("/auth");
    } else if (!profile) {
      if (location !== "/onboarding") setLocation("/onboarding");
    } else if (location === "/auth" || location === "/onboarding") {
      setLocation("/");
    }
  }, [authLoading, profileLoading, user, profile, location, setLocation]);

  if (authLoading || profileLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center flex-col gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white fill-none stroke-white" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground font-medium">Loading FitConnect…</p>
      </div>
    );
  }

  const showNav = !!profile && location !== "/auth" && location !== "/onboarding";

  return (
    <div className="min-h-[100dvh] w-full flex flex-col" style={{ paddingBottom: showNav ? "64px" : 0 }}>
      <Switch>
        <Route path="/auth" component={AuthPage} />
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/" component={HomePage} />
        <Route path="/coach" component={CoachPage} />
        <Route path="/track" component={TrackPage} />
        <Route path="/walk" component={WalkPage} />
        <Route component={NotFound} />
      </Switch>
      {showNav && <BottomNav />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

export default App;
