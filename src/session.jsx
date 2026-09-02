// ============================================================
// ログイン状態の共有
// ------------------------------------------------------------
// Supabase のセッションを購読し、アプリ全体で参照できるようにする。
// 管理者かどうかは admins テーブルを引いて判定する。
// user_metadata の role は登録時にクライアントから指定できるため使わない。
// ============================================================
import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "./api";
import { T, font } from "./theme/tokens";

const SessionContext = createContext({ session: null, admin: null, loading: true });

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [admin, setAdmin] = useState(null);
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
        setLoading(false);
        return;
      }
      // 管理者かどうかを admins テーブルで判定する。
      // 会員が同じ問い合わせをしても RLS により 0 件になる。
      const { data } = await supabase
        .from("admins")
        .select("id, name, role, store_id, must_change_password")
        .eq("auth_user_id", s.user.id)
        .maybeSingle();
      if (!alive) return;
      setAdmin(data || null);
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

  return (
    <SessionContext.Provider value={{ session, admin, loading }}>{children}</SessionContext.Provider>
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
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

// storeAdminOnly = true のときは店舗管理者のみ(スタッフは不可)
export function RequireAdmin({ children, storeAdminOnly = false }) {
  const { session, admin, loading } = useSession();
  if (loading) return <Loading />;
  if (!session || !admin) return <Navigate to="/admin/login" replace />;
  if (storeAdminOnly && admin.role !== "admin") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.textMute, fontFamily: font, fontSize: 13 }}>
        この機能は店舗管理者のみ利用できます。
      </div>
    );
  }
  return children;
}
