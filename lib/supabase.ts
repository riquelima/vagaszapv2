import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ffxpsothavxbrdhshtoj.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
