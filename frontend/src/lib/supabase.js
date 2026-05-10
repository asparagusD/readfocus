import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lvfhuszvuiowyeizstru.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_1Fcu6nbBPjeLfQteisEqxw_B4rtJ-f5';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
