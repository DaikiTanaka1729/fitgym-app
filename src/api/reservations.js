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
  // 指定日(YYYY-MM-DD)の予約枠と空き状況
  listSlots({ storeId, date }) {
    return apiCall(() =>
      supabase
        .from("slots")
        .select("*, reservations(count)")
        .eq("store_id", storeId)
        .gte("start_at", date + "T00:00:00")
        .lte("start_at", date + "T23:59:59")
        .eq("is_closed", false)
        .order("start_at")
    );
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
