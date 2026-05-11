ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_calibrated boolean DEFAULT false;
