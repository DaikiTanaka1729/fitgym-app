// ============================================================
// 売上
// ------------------------------------------------------------
// 会員に権利を付与した時点(=購入)が売上として記録される。
// 記録はデータベース側の引き金で行うので、画面から書き込むことはない。
// ここでは読み出しと、誤登録の取り消しだけを扱う。
//
// 売上見込みは記録ではなく、未購入のまま入っている予約から
// そのつど数える。予約はキャンセルされうるため、確定分と混ぜない。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const salesApi = {
  // 期間内の売上明細(日付の新しい順)
  // 返り値: [{ id, sold_on, member_id, member_name, menu_name,
  //           kind, amount, admin_name, source, reservation_id }]
  list({ from, to }) {
    return apiCall(() => supabase.rpc("list_sales", { p_from: from, p_to: to }));
  },

  // メニュー別の集計。返り値: [{ menu_name, kind, count, amount }]
  summary({ from, to }) {
    return apiCall(() => supabase.rpc("sales_summary", { p_from: from, p_to: to }));
  },

  // 売上見込み。overdue は開始時刻を過ぎているのに未処理の分。
  // 返り値: [{ reservation_id, start_at, member_id, member_name,
  //           menu_name, kind, amount, overdue }]
  expected() {
    return apiCall(() => supabase.rpc("list_expected_sales"));
  },

  // 誤って登録された売上を取り消す。店舗管理者のみ。
  // 権利そのものは消さないので、必要なら会員詳細で調整する。
  remove({ saleId }) {
    return apiCall(() => supabase.rpc("delete_sale", { p_sale_id: saleId }));
  },
};
