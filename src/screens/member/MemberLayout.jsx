import React from "react";
import { useNavigate } from "react-router-dom";
import { T, radius, shadow } from "../../theme/tokens";
import { TabBar } from "../../components";

// 会員向け画面の共通の外枠。
// スマートフォンの縦長1画面に収める前提。下部タブで行き来する。
// 記録・マイページは 9/20版では封印(押しても遷移しない)。
export default function MemberLayout({ title, sub, active = "reserve", onBack, children }) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: radius.xxl,
        overflow: "hidden",
        boxShadow: shadow.raised,
        display: "flex",
        flexDirection: "column",
        minHeight: 560,
      }}
    >
      <div style={{ background: T.primary, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        {onBack && (
          <span
            onClick={onBack}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onBack()}
            style={{ color: T.onDark, fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ‹
          </span>
        )}
        <div>
          <div style={{ color: T.onDark, fontWeight: 500, fontSize: 15 }}>{title}</div>
          {sub && <div style={{ color: "rgba(255,255,255,.82)", fontSize: 11 }}>{sub}</div>}
        </div>
      </div>

      <div style={{ padding: 16, flex: 1 }}>{children}</div>

      <TabBar
        active={active}
        onChange={(k) => k === "reserve" && navigate("/home")}
        tabs={[
          { key: "reserve", label: "予約" },
          { key: "record", label: "記録", locked: true },
          { key: "mypage", label: "マイページ", locked: true },
        ]}
      />
    </div>
  );
}
