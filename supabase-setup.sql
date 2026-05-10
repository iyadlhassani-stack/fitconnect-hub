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

-- 5. Create storage bucket for progress photos
-- (Do this in the Supabase dashboard: Storage > New bucket > "progress-photos" > Public)
