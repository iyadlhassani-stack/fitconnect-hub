-- Run this in your Supabase project's SQL Editor (https://supabase.com/dashboard)
-- This creates the profiles table and the required RLS policies.

-- 1. Create the profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text,
  full_name     text,
  language      text DEFAULT 'en',
  goal          text,
  weight_kg     numeric,
  height_cm     numeric,
  age           integer,
  gender        text,
  level         text,
  diet_preferences  jsonb,
  daily_calorie_target  integer,
  daily_protein_target  integer,
  streak_count  integer DEFAULT 0,
  checkin_times jsonb,
  last_checkin_date text,
  onesignal_player_id text,
  created_at    timestamptz DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Policy: users can read and write only their own profile
CREATE POLICY "Users can manage their own profile"
  ON public.profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4. Create the coach_messages table
CREATE TABLE IF NOT EXISTS public.coach_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  content     text NOT NULL,
  type        text DEFAULT 'chat',
  read        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own messages"
  ON public.coach_messages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Create the daily_logs table (used by the API server)
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  date        date NOT NULL,
  weight_kg   numeric,
  meals       jsonb DEFAULT '[]',
  workouts    jsonb DEFAULT '[]',
  water_liters numeric,
  sleep_hours numeric,
  mood        text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own logs"
  ON public.daily_logs
  FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- 6. Create the walking_routes table (used by the API server)
CREATE TABLE IF NOT EXISTS public.walking_routes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  start_location      jsonb,
  target_type         text,
  target_value        numeric,
  generated_route     jsonb,
  distance_km         numeric NOT NULL,
  duration_min        numeric NOT NULL,
  estimated_calories  numeric NOT NULL,
  completed           boolean DEFAULT false,
  actual_calories     numeric,
  actual_distance_km  numeric,
  actual_duration_sec integer,
  gps_track           jsonb,
  average_speed_kmh   numeric,
  pauses_count        integer,
  completed_at        timestamptz,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.walking_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own routes"
  ON public.walking_routes
  FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- 7. Create storage bucket for progress photos
-- (Do this in the Supabase dashboard: Storage > New bucket > "progress-photos" > Public)
