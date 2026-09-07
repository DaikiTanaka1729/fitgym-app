// ============================================================
// トレーニング記録(管理者の代理入力)
// ------------------------------------------------------------
// 会員向けの記録画面は 9/20版では封印。入力は管理者側のみ。
// training_records は RLS により、管理者は自店舗のぶんを読み書きできる。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const recordApi = {
  // exercises は [{ name, weight, reps, sets }] の配列
  create({ storeId, memberId, adminId, performedOn, exercises, trainerMemo }) {
    return apiCall(() =>
      supabase
        .from("training_records")
        .insert({
          store_id: storeId,
          member_id: memberId,
          admin_id: adminId,
          performed_on: performedOn,
          exercises,
          trainer_memo: trainerMemo || null,
        })
        .select()
        .single()
    );
  },

  update(id, patch) {
    return apiCall(() =>
      supabase.from("training_records").update(patch).eq("id", id).select().single()
    );
  },

  remove(id) {
    return apiCall(() => supabase.from("training_records").delete().eq("id", id));
  },

  listByMember({ memberId }) {
    return apiCall(() =>
      supabase
        .from("training_records")
        .select("id, performed_on, exercises, trainer_memo, created_at, admins(name)")
        .eq("member_id", memberId)
        .order("performed_on", { ascending: false })
        .limit(50)
    );
  },
};
