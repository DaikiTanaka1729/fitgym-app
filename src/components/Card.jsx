import React from "react";
import { T, radius, shadow } from "../theme/tokens";

// accent はヘッダー帯の色。会員=T.primary / 管理者=T.navy。
export default function Card({ title, subtitle, accent = T.primary, children }) {
  return (
    <div
      style={{
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: radius.xl,
        overflow: "hidden",
        boxShadow: shadow.card,
      }}
    >
      {title && (
        <div style={{ background: accent, padding: "13px 16px" }}>
          <div style={{ color: T.onDark, fontWeight: 500, fontSize: 14 }}>{title}</div>
          {subtitle && (
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: 11, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      )}
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}
