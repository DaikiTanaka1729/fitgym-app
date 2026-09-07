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

  // 受付枠の一括操作。
  //   action: "create"(作成)| "delete"(削除)| "close"(クローズ)| "open"(再開)
  //   adminId を null にすると店舗の全トレーナーが対象。
  //   weekdays に [1,3,5] のように渡すと、その曜日だけを対象にする(0=日)。
  // 終了時刻の枠は含まない(18:00 指定なら最後の枠は 17:30)。
  // 返り値: [{ affected, skipped }] skipped は予約が入っていて削除を見送った数。
  bulk({ adminId = null, from, to, start = "00:00", end = "24:00", action, capacity = 1, weekdays = null }) {
    return apiCall(() =>
      supabase.rpc("bulk_shifts", {
        p_admin_id: adminId,
        p_from: from,
        p_to: to,
        p_start: start,
        p_end: end,
        p_action: action,
        p_capacity: capacity,
        p_weekdays: weekdays,
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

  // タイムテーブル表示用。指定日の枠をトレーナー名・予約件数つきで取得する。
  // 返り値: [{ id, staff_id, staff_name, start_at, capacity, is_closed, booked }]
  listDay({ date }) {
    return apiCall(() => supabase.rpc("list_day_slots", { p_date: date }));
  },

  // 枠の配置 / 解除。戻り値は 'added' か 'removed'。
  // 予約が入っている枠は解除できない(slot_in_use)。
  toggleSlot({ staffId, startAt, capacity = 1 }) {
    return apiCall(() =>
      supabase.rpc("toggle_slot", {
        p_staff_id: staffId,
        p_start_at: startAt,
        p_capacity: capacity,
      })
    );
  },
};

// ============================================================
// 管理者の共有メモ(日付ごとの申し送り)
// ------------------------------------------------------------
// 店舗の管理者・スタッフ全員が読み書きできる。会員には見せない。
// ============================================================
export const noteApi = {
  get({ date }) {
    return apiCall(() => supabase.rpc("get_admin_note", { p_date: date }));
  },
  save({ date, body }) {
    return apiCall(() => supabase.rpc("save_admin_note", { p_date: date, p_body: body }));
  },
};
