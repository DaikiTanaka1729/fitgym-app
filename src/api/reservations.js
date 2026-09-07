// ============================================================
// 予約(トレーナー割当方式)
// ------------------------------------------------------------
// 予約枠 = トレーナー1人 × 30分。
// 会員は「メニューを選ぶ → 30分刻みで時刻を選ぶ」だけで、
// トレーナーはサーバー側が自動で割り当てる(指名は Phase2)。
//
// 所要時間60分のメニューは、同じトレーナーの連続する2枠を占有する。
//
// 判定(契約状況・空き)と枠の確保、回数券の減算は
// サーバーの RPC で1トランザクションにまとめている。
// クライアントから reservations を直接 INSERT することはできない。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const reservationApi = {
  // 指定メニュー・指定日(YYYY-MM-DD・日本時間)の予約可能な開始時刻。
  // 所要時間ぶん連続して空いているトレーナーがいる時刻だけが返る。
  // 返り値: [{ start_at, available, mine }]
  //   available … その時刻に対応できるトレーナーの人数
  //   mine      … 自分が既にその時刻に予約を持っているか
  listAvailableTimes({ date, menuId }) {
    return apiCall(() =>
      supabase.rpc("list_available_times", { p_date: date, p_menu_id: menuId })
    );
  },

  // 予約の作成。トレーナーの割当はサーバー側で行う。
  // memberId は管理者が代理予約するときだけ指定する(会員は指定しても無視される)。
  create({ menuId, startAt, memberId = null }) {
    return apiCall(() =>
      supabase.rpc("create_reservation", {
        p_menu_id: menuId,
        p_start_at: startAt,
        p_member_id: memberId,
      })
    );
  },

  cancel({ reservationId }) {
    return apiCall(() => supabase.rpc("cancel_reservation", { p_reservation_id: reservationId }));
  },

  // 管理者向け:指定日(YYYY-MM-DD・日本時間)の予約一覧
  listDay({ date }) {
    return apiCall(() => supabase.rpc("list_day_reservations", { p_date: date }));
  },

  // 自分の予約一覧。既定はこれからの予約のみ。
  // admins は RLS で会員から読めないため、担当トレーナー名を含めて
  // RPC 側で必要な項目だけ返す(メールアドレスは返さない)。
  // 返り値: [{ id, start_at, end_at, status, source, menu_name,
  //           billing_type, trainer_name, cancelable }]
  listMine({ includePast = false } = {}) {
    return apiCall(() => supabase.rpc("list_my_reservations", { p_include_past: includePast }));
  },
};
