// ============================================================
// トレーニング記録(管理者の代理入力)
// ------------------------------------------------------------
// 会員向けの記録画面は 9/20版では封印。入力は管理者側のみ。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const recordApi = {
  create({ memberId, adminId, performedOn, exercises, trainerMemo }) {
    return apiCall(() =>
      supabase
        .from("training_records")
        .insert({
          member_id: memberId,
          admin_id: adminId,
          performed_on: performedOn,
          exercises,
          trainer_memo: trainerMemo,
        })
        .select()
        .single()
    );
  },
  listByMember({ memberId }) {
    return apiCall(() =>
      supabase
        .from("training_records")
        .select("*")
        .eq("member_id", memberId)
        .order("performed_on", { ascending: false })
    );
  },
};
