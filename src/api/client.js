// ============================================================
// Supabase 接続の一元管理
// ------------------------------------------------------------
// 接続情報は環境変数から読む(コードに直書きしない)。
// 未設定でもアプリが落ちないようにし、環境構築前でも画面が動く状態を保つ。
// ============================================================
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
