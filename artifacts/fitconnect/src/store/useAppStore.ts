import { create } from 'zustand';

export type UserProfile = {
  id: string;
  email?: string;
  full_name?: string;
  language: 'fr' | 'en';
  weight_kg?: number;
  height_cm?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  goal?: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  diet_preferences?: string[];
  allergies?: string;
  daily_calorie_target?: number;
  daily_protein_target?: number;
  streak_count: number;
  checkin_times?: string[];
  last_checkin_date?: string;
};

interface AppState {
  user: any | null;
  profile: UserProfile | null;
  todayLog: any | null;
  messages: any[];
  setUser: (user: any) => void;
  setProfile: (profile: UserProfile | null) => void;
  setTodayLog: (log: any) => void;
  addMessage: (message: any) => void;
  setMessages: (messages: any[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  profile: null,
  todayLog: null,
  messages: [],
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setTodayLog: (log) => set({ todayLog: log }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setMessages: (messages) => set({ messages }),
}));
