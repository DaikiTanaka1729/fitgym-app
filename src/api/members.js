// ============================================================
// 会員管理(管理者向け)
// ------------------------------------------------------------
// 予約件数や回数券残数を含む一覧は、RLS の都合で普通の SELECT では
// 集計できないため、権限確認つきの RPC を経由する。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const memberApi = {
  // 会員一覧。query は氏名・メールの部分一致。
  // 返り値: [{ id, name, email, birth_date, grade, created_at,
  //           upcoming, total_reservations, tickets_left,
  //           membership_until, last_visit }]
  list({ query = "" } = {}) {
    return apiCall(() => supabase.rpc("list_members", { p_query: query || null }));
  },

  get({ memberId }) {
    return apiCall(() => supabase.rpc("get_member_detail", { p_member_id: memberId }));
  },

  // 会員情報の更新。members は RLS で管理者が自店舗のみ更新できる。
  update({ memberId, patch }) {
    return apiCall(() =>
      supabase.from("members").update(patch).eq("id", memberId).select().single()
    );
  },

  listReservations({ memberId }) {
    return apiCall(() => supabase.rpc("list_member_reservations", { p_member_id: memberId }));
  },
};

// CSV へ変換する。Excel が文字化けしないよう BOM を付ける。
export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")).join("\r\n");
  return "﻿" + head + "\r\n" + body;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
