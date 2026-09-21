// ============================================================
// Supabase 接続の一元管理
// ------------------------------------------------------------
// 接続情報は環境変数から読む(コードに直書きしない)。
// 未設定でもアプリが落ちないようにし、環境構築前でも画面が動く状態を保つ。
// ============================================================
import { createClient } from "@supabase/supabase-js";

// 既定値。環境変数が設定されていればそちらが優先される。
//
// この2つはブラウザに配信される公開情報で、正しく動いている状態でも
// ビルド後の JavaScript に平文で含まれる。したがってコードに置いても
// 秘匿性は変わらない。実際の防御は RLS(行レベルセキュリティ)が担う。
//
// ※ service_role キーは全権限を持つためここに置いてはならない。
const DEFAULT_URL = "https://rwtbvwyozazlsacsjtlj.supabase.co";
const DEFAULT_ANON_KEY = "sb_publishable_OFCVt4gER0wFjqhnN5IjAA_29w-43QL";

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || DEFAULT_URL;
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
