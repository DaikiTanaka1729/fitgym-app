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

  // 指名券がどのメニューに使えるかの紐づけ
  // 返り値: [{ nomination_menu_id, menu_id }]
  listNominationLinks() {
    return apiCall(() => supabase.rpc("list_nomination_links"));
  },

  setNominationLink({ nominationMenuId, menuId, on }) {
    return apiCall(() =>
      supabase.rpc("set_nomination_link", {
        p_nomination_menu_id: nominationMenuId,
        p_menu_id: menuId,
        p_on: on,
      })
    );
  },

  // 公開 / 公開停止。承認権限を持つ管理者のみ実行できる。
  setPublished({ menuId, published }) {
    return apiCall(() =>
      supabase.rpc("set_menu_published", { p_menu_id: menuId, p_published: published })
    );
  },
};
