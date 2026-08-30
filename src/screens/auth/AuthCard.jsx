import React from "react";
import { T, radius, shadow } from "../../theme/tokens";

// 認証画面の外枠(スマホ幅のカード)。
// accent: 会員 = T.primary / 管理者 = T.navy
export default function AuthCard({ accent = T.primary, title, sub, children }) {
  return (
    <div
      style={{
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: radius.xxl,
        overflow: "hidden",
        boxShadow: shadow.raised,
      }}
    >
      <div style={{ background: accent, padding: "14px 16px" }}>
        <div style={{ color: T.onDark, fontWeight: 500, fontSize: 15 }}>{title}</div>
        <div style={{ color: "rgba(255,255,255,.82)", fontSize: 11 }}>{sub}</div>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}
