// ============================================================
// メニュー(3課金形態: time / unlimited / ticket)
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const menuApi = {
  // 会員向け。各メニューについて、いま予約できるか(bookable)と
  // その理由(note: 「残り8回」「契約期間 2026/12/31 まで」等)を添えて返す。
  listMine() {
    return apiCall(() => supabase.rpc("list_my_menus"));
  },

  list({ storeId }) {
    return apiCall(() =>
      supabase.from("menus").select("*").eq("store_id", storeId).order("created_at")
    );
  },
  create(menu) {
    return apiCall(() => supabase.from("menus").insert(menu).select().single());
  },
  update(id, patch) {
    return apiCall(() => supabase.from("menus").update(patch).eq("id", id).select().single());
  },
};
