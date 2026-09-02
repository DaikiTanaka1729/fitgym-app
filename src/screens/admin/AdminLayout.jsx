import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { T, font, radius, shadow } from "../../theme/tokens";
import { authApi } from "../../api";
import { useSession } from "../../session";

const NAV = [
  { to: "/admin", label: "ダッシュボード", exact: true },
  { to: "/admin/members", label: "会員管理" },
  { to: "/admin/reservations", label: "予約状況" },
  { to: "/admin/shifts", label: "受付枠" },
  { to: "/admin/timetable", label: "タイムテーブル" },
  { to: "/admin/menus", label: "メニュー" },
  { to: "/admin/trainers", label: "トレーナー" },
];

// 管理者向け画面の共通の外枠。
// 店舗のタブレット / PC で使う想定のため、横幅を使ったレイアウトにする。
export default function AdminLayout({ title, sub, actions, children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { admin } = useSession();

  async function signOut() {
    await authApi.signOut();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ヘッダー */}
      <div
        style={{
          background: T.navy,
          borderRadius: radius.lg,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ color: T.onDark, fontWeight: 500, fontSize: 15 }}>FitGym 管理コンソール</div>
          <div style={{ color: "rgba(255,255,255,.75)", fontSize: 11 }}>
            {admin?.name}
            {admin?.role === "admin" ? "(店舗管理者)" : "(スタッフ)"}
          </div>
        </div>
        <div
          onClick={signOut}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && signOut()}
          style={{ color: "rgba(255,255,255,.75)", fontSize: 11.5, cursor: "pointer" }}
        >
          ログアウト
        </div>
      </div>

      {/* ナビゲーション */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {NAV.map((n) => {
          const on = n.exact ? pathname === n.to : pathname.startsWith(n.to);
          return (
            <button
              key={n.to}
              onClick={() => navigate(n.to)}
              style={{
                padding: "7px 14px",
                borderRadius: radius.md,
                fontSize: 12,
                fontWeight: on ? 500 : 400,
                fontFamily: font,
                cursor: "pointer",
                border: `1px solid ${on ? T.navy : T.border}`,
                background: on ? T.navySoft : T.bg,
                color: on ? T.navy : T.textMute,
              }}
            >
              {n.label}
            </button>
          );
        })}
      </div>

      {/* 本文 */}
      <div
        style={{
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: radius.xl,
          boxShadow: shadow.card,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${T.borderFaint}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{title}</div>
            {sub && <div style={{ fontSize: 11.5, color: T.textMute, marginTop: 2 }}>{sub}</div>}
          </div>
          {actions}
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
