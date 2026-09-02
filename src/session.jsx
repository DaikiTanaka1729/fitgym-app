// ============================================================
// ログイン状態の共有
// ------------------------------------------------------------
// Supabase のセッションを購読し、アプリ全体で参照できるようにする。
// 会員向け画面はログイン必須なので、RequireMember で囲う。
// ============================================================
import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "./api";
import { T, font } from "./theme/tokens";

const SessionContext = createContext({ session: null, loading: true });

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);

// 表示名。会員登録時のメタデータに入れた氏名を使う。
export function useDisplayName() {
  const { session } = useSession();
  return session?.user?.user_metadata?.name || session?.user?.email || "";
}

export function RequireMember({ children }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.textMute, fontFamily: font, fontSize: 12 }}>
        読み込んでいます…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}
