// ============================================================
// API 基盤の窓口
// ------------------------------------------------------------
//   画面(React)  ->  src/api/*(この層)  ->  Supabase
//
// ・Supabase接続は client.js に集約
// ・エラー処理は errors.js に統一
// ・戻り値はすべて { data, error }
//
// 使い方:
//   import { authApi } from "../../api";
//   const { data, error } = await authApi.signInMember({ email, password });
//   if (error) { setBanner(error); return; }
// ============================================================
export { supabase, isSupabaseConfigured } from "./client";
export { apiCall, toFriendlyError } from "./errors";
export { authApi } from "./auth";
export { menuApi } from "./menus";
export { memberApi, toCsv, downloadCsv, generateTempPassword } from "./members";
export { reservationApi } from "./reservations";
export { shiftApi, noteApi } from "./shifts";
export { recordApi } from "./records";
export { surveyApi, trialApi } from "./feedback";
