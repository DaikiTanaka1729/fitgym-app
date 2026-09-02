// ============================================================
// トレーナーの受付枠(シフト)
// ------------------------------------------------------------
// 「その時間に誰がいて、どのメニューを担当できるか」を登録する。
// これが無いと予約可能時刻が1つも出ない。
// 労務管理としてのシフト作成ではなく、受付可能時間の登録に絞る。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const shiftApi = {
  // トレーナー(admins)の一覧。管理者のみ参照できる。
  listStaff() {
    return apiCall(() =>
      supabase.from("admins").select("id, name, email, role").order("created_at")
    );
  },

  // 担当できるメニューの紐づけ
  listStaffMenus() {
    return apiCall(() =>
      supabase.from("staff_menus").select("id, admin_id, menu_id")
    );
  },

  linkMenu({ adminId, menuId, storeId }) {
    return apiCall(() =>
      supabase
        .from("staff_menus")
        .insert({ admin_id: adminId, menu_id: menuId, store_id: storeId })
        .select()
        .single()
    );
  },

  unlinkMenu({ adminId, menuId }) {
    return apiCall(() =>
      supabase.from("staff_menus").delete().eq("admin_id", adminId).eq("menu_id", menuId)
    );
  },

  // 受付枠の一括作成。作成した枠数が返る。
  // 終了時刻の枠は作らない(18:00 指定なら最後の枠は 17:30)。
  create({ adminId, from, to, start = "00:00", end = "24:00", capacity = 1 }) {
    return apiCall(() =>
      supabase.rpc("create_shift", {
        p_admin_id: adminId,
        p_from: from,
        p_to: to,
        p_start: start,
        p_end: end,
        p_capacity: capacity,
      })
    );
  },

  // 指定日の枠(管理者向け。定員クローズの操作に使う)
  listByDate({ storeId, date }) {
    const from = `${date}T00:00:00+09:00`;
    const to = `${date}T23:59:59+09:00`;
    return apiCall(() =>
      supabase
        .from("slots")
        .select("id, staff_id, start_at, capacity, is_closed, admins(name)")
        .eq("store_id", storeId)
        .gte("start_at", from)
        .lte("start_at", to)
        .order("start_at")
    );
  },

  // 枠のクローズ / 再開
  setClosed({ slotIds, closed }) {
    return apiCall(() =>
      supabase.from("slots").update({ is_closed: closed }).in("id", slotIds).select("id")
    );
  },
};
