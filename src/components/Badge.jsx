import React from "react";
import { T, radius } from "../theme/tokens";

// tone: primary(時間課金) / accent(通い放題) / amber(回数券) / navy / gray(停止中) / danger(要対応)
export default function Badge({ children, tone = "primary" }) {
  const map = {
    primary: { bg: T.primarySoft, fg: T.primaryDark },
    navy: { bg: T.navySoft, fg: T.navy },
    accent: { bg: T.accentSoft, fg: T.accentDark },
    amber: { bg: T.amberSoft, fg: T.amberDark },
    gray: { bg: T.graySoft, fg: T.grayDark },
    danger: { bg: T.dangerSoft, fg: T.dangerDark },
  }[tone] || { bg: T.graySoft, fg: T.grayDark };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: radius.sm,
        background: map.bg,
        color: map.fg,
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}
