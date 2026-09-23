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

  // 優先度(1=高 2=中 3=低)の高い順。同じ優先度は登録順。
  list({ storeId }) {
    return apiCall(() =>
      supabase
        .from("menus")
        .select("*")
        .eq("store_id", storeId)
        .order("priority")
        .order("created_at")
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

  // メニューの削除。店舗管理者のみ。
  // 予約・回数券・通い放題から使われている場合は消せない(menu_in_use)。
  // 担当の紐づけ・購入登録・指名券の適用は一緒に消える。
  remove({ menuId }) {
    return apiCall(() => supabase.rpc("delete_menu", { p_menu_id: menuId }));
  },

  // 削除できるかを先に見る。返り値: [{ reservations, tickets, memberships, deletable }]
  usage({ menuId }) {
    return apiCall(() => supabase.rpc("menu_usage", { p_menu_id: menuId }));
  },

  // 公開 / 公開停止。承認権限を持つ管理者のみ実行できる。
  setPublished({ menuId, published }) {
    return apiCall(() =>
      supabase.rpc("set_menu_published", { p_menu_id: menuId, p_published: published })
    );
  },
};
