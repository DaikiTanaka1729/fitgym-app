// ============================================================
// 【仮実装】認証モック
// ------------------------------------------------------------
// Supabase 未接続の状態でも画面遷移を確認できるようにするための暫定層。
// Step 3(認証の本番接続)で src/api の authApi に差し替え、このファイルは削除する。
//   mockAuth.signUpMember    -> authApi.signUpMember
//   mockAuth.signInMember    -> authApi.signInMember
//   mockAuth.signInAdmin     -> authApi.signInAdmin
//   mockAuth.sendResetLink   -> authApi.sendResetLink
//   mockAuth.updatePassword  -> authApi.updatePassword
// ============================================================

const authStore = {
  members: [{ email: "tanaka@example.com", password: "password123", name: "田中 大貴" }],
  admins: [{ email: "admin@fitgym.jp", password: "admin12345", role: "店舗管理者" }],
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const mockAuth = {
  async signUpMember({ name, email, password }) {
    await delay(500);
    if (authStore.members.some((m) => m.email === email))
      return { error: "このメールアドレスは既に登録されています" };
    authStore.members.push({ name, email, password });
    return { user: { email, name } };
  },

  async signInMember({ email, password }) {
    await delay(500);
    const m = authStore.members.find((m) => m.email === email);
    if (!m || m.password !== password)
      return { error: "メールアドレスまたはパスワードが正しくありません" };
    return { user: { email: m.email, name: m.name } };
  },

  async signInAdmin({ email, password }) {
    await delay(500);
    const a = authStore.admins.find((a) => a.email === email);
    if (!a || a.password !== password)
      return { error: "メールアドレスまたはパスワードが正しくありません" };
    return { user: { email: a.email, role: a.role } };
  },

  // 未登録アドレスでも成功として扱う(存在有無を推測させない)
  async sendResetLink() {
    await delay(500);
    return { ok: true };
  },

  async updatePassword({ email, password }) {
    await delay(500);
    const m = authStore.members.find((m) => m.email === email);
    if (m) m.password = password;
    return { ok: true };
  },
};
