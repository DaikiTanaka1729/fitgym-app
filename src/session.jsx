// ============================================================
// ログイン状態の共有
// ------------------------------------------------------------
// Supabase のセッションを購読し、アプリ全体で参照できるようにする。
// 管理者かどうかは admins テーブルを引いて判定する。
// user_metadata の role は登録時にクライアントから指定できるため使わない。
// ============================================================
import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authApi, supabase, isSupabaseConfigured } from "./api";
import { T, font } from "./theme/tokens";

const SessionContext = createContext({ session: null, admin: null, member: null, loading: true });

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let alive = true;

    async function resolve(s) {
      if (!alive) return;
      setSession(s);
      if (!s) {
        setAdmin(null);
        setMember(null);
        setLoading(false);
        return;
      }
      // 管理者かどうかを admins テーブルで判定する。
      // 会員が同じ問い合わせをしても RLS により 0 件になる。
      // 承認待ちの管理者は RLS で admins を読めないため、専用の入口で取得する
      const [a, m] = await Promise.all([authApi.getMyAdmin(), authApi.getMyProfile()]);
      if (!alive) return;
      setAdmin(a.data?.[0] || null);
      setMember(m.data?.[0] || null);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setLoading(true);
      resolve(s);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // パスワード変更後などにプロフィールを取り直す
  const refreshProfile = async () => {
    const { data } = await authApi.getMyProfile();
    setMember(data?.[0] || null);
  };

  return (
    <SessionContext.Provider value={{ session, admin, member, loading, refreshProfile }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);

// 会員の表示名。登録時のメタデータに入れた氏名を使う。
export function useDisplayName() {
  const { session } = useSession();
  return session?.user?.user_metadata?.name || session?.user?.email || "";
}

function Loading() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: T.textMute, fontFamily: font, fontSize: 12 }}>
      読み込んでいます…
    </div>
  );
}

export function RequireMember({ children }) {
  const { session, member, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // 仮パスワードで入った会員は、変更を終えるまで先へ進めない
  if (member?.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// storeAdminOnly = true のときは店舗管理者のみ(スタッフは不可)
export function RequireAdmin({ children, storeAdminOnly = false }) {
  const { session, admin, loading } = useSession();
  if (loading) return <Loading />;
  if (!session || !admin) return <Navigate to="/admin/login" replace />;
  // 登録はされたが、まだ承認されていない
  if (admin.status === "pending") return <PendingApproval name={admin.name} />;
  if (storeAdminOnly && admin.role !== "admin") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.textMute, fontFamily: font, fontSize: 13 }}>
        この機能は店舗管理者のみ利用できます。
      </div>
    );
  }
  return children;
}

// 登録済みだが未承認の管理者に出す画面
function PendingApproval({ name }) {
  return (
    <div
      style={{
        maxWidth: 400,
        margin: "0 auto",
        fontFamily: font,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <div style={{ background: T.navy, padding: "14px 16px" }}>
        <div style={{ color: T.onDark, fontWeight: 500, fontSize: 15 }}>承認待ち</div>
        <div style={{ color: "rgba(255,255,255,.82)", fontSize: 11 }}>{name} さん</div>
      </div>
      <div style={{ padding: 18 }}>
        <div
          style={{
            background: T.amberSoft,
            color: T.amberDark,
            borderRadius: 8,
            padding: "11px 13px",
            fontSize: 12,
            lineHeight: 1.8,
            marginBottom: 14,
          }}
        >
          管理者としての登録は完了していますが、まだ承認されていません。
          既存の店舗管理者が承認すると、管理画面をご利用いただけます。
        </div>
        <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.8 }}>
          店舗管理者の方は「トレーナー」の画面から承認できます。
        </div>
        <div
          onClick={async () => {
            await authApi.signOut();
            window.location.href = "/admin/login";
          }}
          role="button"
          tabIndex={0}
          style={{ textAlign: "center", fontSize: 11.5, color: T.accent, marginTop: 18, cursor: "pointer" }}
        >
          ログアウト
        </div>
      </div>
    </div>
  );
}
