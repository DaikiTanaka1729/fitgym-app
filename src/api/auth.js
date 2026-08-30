// ============================================================
// 認証(会員・管理者・パスワード再設定)
// ------------------------------------------------------------
// 認証基盤は Supabase Auth。パスワードは auth.users が保持し、
// members / admins は auth_user_id で紐づくプロフィール表として扱う。
// ============================================================
import { supabase } from "./client";
import { apiCall } from "./errors";

export const authApi = {
  // 会員登録。プロフィール(members)行はDBトリガで作成する。
  signUpMember({ name, email, password, birthDate }) {
    return apiCall(() =>
      supabase.auth.signUp({
        email,
        password,
        options: { data: { name, birth_date: birthDate || null, role: "member" } },
      })
    );
  },

  signInMember({ email, password }) {
    return apiCall(() => supabase.auth.signInWithPassword({ email, password }));
  },

  // 管理者ログイン。role を確認して会員と分離する。
  async signInAdmin({ email, password }) {
    const res = await apiCall(() => supabase.auth.signInWithPassword({ email, password }));
    if (res.error) return res;
    const role = res.data?.user?.user_metadata?.role;
    if (role !== "admin" && role !== "staff") {
      await supabase.auth.signOut();
      return { data: null, error: "管理者アカウントではありません" };
    }
    return res;
  },

  signOut() {
    return apiCall(() => supabase.auth.signOut());
  },

  getCurrentUser() {
    return apiCall(() => supabase.auth.getUser());
  },

  // セルフ再設定:登録メールへリンクを送る(有効期限60分)
  sendResetLink({ email }) {
    return apiCall(() =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password",
      })
    );
  },

  // 新パスワードの設定。仮パスワードからの強制変更でも同じ経路を使う。
  updatePassword({ password }) {
    return apiCall(() => supabase.auth.updateUser({ password }));
  },
};
