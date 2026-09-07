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

  // 管理者ログイン。
  // 権限の判定は必ず admins テーブルで行う。user_metadata の role は
  // 登録時にクライアントから自由に指定できるため、判定に使ってはいけない。
  // admins は RLS により本人(管理者)しか読めないので、
  // 会員が同じ問い合わせをしても 0 件になり、ここで弾かれる。
  async signInAdmin({ email, password }) {
    const res = await apiCall(() => supabase.auth.signInWithPassword({ email, password }));
    if (res.error) return res;

    const { data: admin } = await supabase
      .from("admins")
      .select("id, role, store_id, must_change_password")
      .eq("auth_user_id", res.data.user.id)
      .maybeSingle();

    if (!admin) {
      await supabase.auth.signOut();
      return { data: null, error: "管理者アカウントではありません" };
    }
    return { data: { ...res.data, admin }, error: null };
  },

  signOut() {
    return apiCall(() => supabase.auth.signOut());
  },

  getCurrentUser() {
    return apiCall(() => supabase.auth.getUser());
  },

  // セルフ再設定:登録メールへリンクを送る(有効期限60分)
  // ネイティブアプリでは origin が capacitor://localhost になりメールのリンクから戻れないため、
  // Universal Links / App Links 用のURLを VITE_PASSWORD_RESET_URL で指定する。
  sendResetLink({ email }) {
    const redirectTo =
      import.meta.env?.VITE_PASSWORD_RESET_URL ||
      window.location.origin + "/reset-password";
    return apiCall(() => supabase.auth.resetPasswordForEmail(email, { redirectTo }));
  },

  // 新パスワードの設定。仮パスワードからの強制変更でも同じ経路を使う。
  updatePassword({ password }) {
    return apiCall(() => supabase.auth.updateUser({ password }));
  },

  // 会員のプロフィール。初回パスワード変更の要否判定に使う。
  getMyProfile() {
    return apiCall(() => supabase.rpc("get_my_profile"));
  },

  // 初回パスワード変更を終えたことを記録する
  clearMustChangePassword() {
    return apiCall(() => supabase.rpc("clear_must_change_password"));
  },
};
