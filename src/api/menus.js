// ============================================================
// メニュー(3課金形態: time / unlimited / ticket)
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const menuApi = {
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
