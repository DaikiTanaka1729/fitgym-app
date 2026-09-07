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

  // 会員へパスワード再設定メールを送る(会員自身が新しいパスワードを決める。推奨)
  sendResetMail({ email }) {
    const redirectTo =
      import.meta.env?.VITE_PASSWORD_RESET_URL ||
      window.location.origin + "/reset-password";
    return apiCall(() => supabase.auth.resetPasswordForEmail(email, { redirectTo }));
  },

  // 仮パスワードを発行する。店舗管理者のみ実行できる。
  // 発行と同時に「初回ログイン時の変更」が必須になる。
  // 仮パスワードは画面側で生成し、口頭・書面で会員へ伝える運用。
  issueTempPassword({ memberId, tempPassword }) {
    return apiCall(() =>
      supabase.rpc("issue_temp_password", {
        p_member_id: memberId,
        p_temp_password: tempPassword,
      })
    );
  },

  listAudit({ memberId }) {
    return apiCall(() => supabase.rpc("list_member_audit", { p_member_id: memberId }));
  },

  // 会員が持つ権利(回数券・通い放題)の一覧
  listEntitlements({ memberId }) {
    return apiCall(() => supabase.rpc("list_member_entitlements", { p_member_id: memberId }));
  },

  // 回数券を付与する。RLS により自店舗の会員にのみ登録できる。
  grantTicket({ storeId, memberId, menuId, remaining, expireOn }) {
    return apiCall(() =>
      supabase
        .from("tickets")
        .insert({
          store_id: storeId,
          member_id: memberId,
          menu_id: menuId,
          remaining,
          expire_on: expireOn || null,
        })
        .select()
        .single()
    );
  },

  // 通い放題の契約を登録する
  grantMembership({ storeId, memberId, menuId, startOn, endOn }) {
    return apiCall(() =>
      supabase
        .from("memberships")
        .insert({
          store_id: storeId,
          member_id: memberId,
          menu_id: menuId,
          start_on: startOn,
          end_on: endOn,
        })
        .select()
        .single()
    );
  },

  // 回数券の残数を直接書き換える(調整・失効に使う)
  updateTicket({ ticketId, patch }) {
    return apiCall(() =>
      supabase.from("tickets").update(patch).eq("id", ticketId).select().single()
    );
  },

  // 通い放題の契約期間を変更する(途中終了に使う)
  updateMembership({ membershipId, patch }) {
    return apiCall(() =>
      supabase.from("memberships").update(patch).eq("id", membershipId).select().single()
    );
  },
};

// 推測されにくい仮パスワードを作る。
// 紛らわしい文字(0/O/1/l/I)は口頭で伝える都合上あえて外す。
export function generateTempPassword(length = 10) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

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
