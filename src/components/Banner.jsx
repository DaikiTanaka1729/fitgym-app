import React from "react";
import { T, radius } from "../theme/tokens";

// フォーム上部に出す一括メッセージ(API エラー / 成功)。
export default function Banner({ tone = "error", children }) {
  const c =
    tone === "error"
      ? { bg: T.dangerSoft, bd: T.dangerBorder, fg: T.dangerDark }
      : { bg: T.primarySoft, bd: T.primaryBorder, fg: T.primaryDark };
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.bd}`,
        color: c.fg,
        borderRadius: radius.md,
        padding: "9px 11px",
        fontSize: 11.5,
        marginBottom: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
