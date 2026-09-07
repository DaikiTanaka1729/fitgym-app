// ============================================================
// ご意見アンケート と 体験予約フォーム
// ------------------------------------------------------------
// 体験予約は未ログインから送信するため、店舗の解決も含めて
// サーバー側の関数で完結させる(テーブルは直接触らせない)。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const surveyApi = {
  // 会員が回答する。answers は { key: value } のオブジェクト。
  submit({ answers }) {
    return apiCall(() => supabase.rpc("submit_survey", { p_answers: answers }));
  },

  // 管理者向けの一覧
  list() {
    return apiCall(() => supabase.rpc("list_survey_responses"));
  },
};

export const trialApi = {
  // 未ログインからの体験予約申し込み
  create({ name, email, phone, preferredAt, note }) {
    return apiCall(() =>
      supabase.rpc("create_trial_booking", {
        p_name: name,
        p_email: email,
        p_phone: phone || null,
        p_preferred_at: preferredAt || null,
        p_note: note || null,
      })
    );
  },

  // 管理者向け。RLS により自店舗のぶんだけ返る。
  list() {
    return apiCall(() =>
      supabase
        .from("trial_bookings")
        .select("id, name, email, phone, preferred_at, note, status, created_at")
        .order("created_at", { ascending: false })
    );
  },

  setStatus({ id, status }) {
    return apiCall(() =>
      supabase.from("trial_bookings").update({ status }).eq("id", id).select("id").single()
    );
  },
};
