// ============================================================
// 予約(共通枠 + 課金形態別チェック)
// ------------------------------------------------------------
// 予約可否は2段階:
//   A) 課金形態別チェック(契約期間・残回数・同時予約上限)
//   B) 枠の空きチェック(全形態共通・capacity 判定)
// A/B と残数の更新は同時実行で崩れるため、Supabase 側の RPC
// (create_reservation / cancel_reservation)でトランザクション実行する。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const reservationApi = {
  // 指定日(YYYY-MM-DD・日本時間)の予約枠と空き状況。
  // reservations は RLS で自分の分しか見えないため、埋まり具合は
  // list_slots RPC(SECURITY DEFINER)で件数だけ受け取る。
  // 返り値: [{ id, start_at, capacity, booked, is_closed, mine }]
  listSlots({ date }) {
    return apiCall(() => supabase.rpc("list_slots", { p_date: date }));
  },

  // 自分の予約一覧(枠とメニューを含む)
  listMine({ includePast = false } = {}) {
    return apiCall(() => {
      let q = supabase
        .from("reservations")
        .select("id, status, source, created_at, menus(name, billing_type), slots(start_at)")
        .eq("status", "booked");
      if (!includePast) q = q.gte("slots.start_at", new Date().toISOString());
      return q.order("created_at", { ascending: false });
    });
  },

  // source は消費元(time / membership / ticket)
  create({ memberId, menuId, slotId, source }) {
    return apiCall(() =>
      supabase.rpc("create_reservation", {
        p_member_id: memberId,
        p_menu_id: menuId,
        p_slot_id: slotId,
        p_source: source,
      })
    );
  },

  cancel({ reservationId }) {
    return apiCall(() => supabase.rpc("cancel_reservation", { p_reservation_id: reservationId }));
  },
};
