import React from "react";
import { T, radius } from "../theme/tokens";
import { CheckIcon } from "./icons";

export default function Toast({ tone = "success", children }) {
  const map = {
    success: { bg: T.primarySoft, fg: T.primaryDark, icon: <CheckIcon /> },
    error: { bg: T.dangerSoft, fg: T.dangerDark, icon: null },
  }[tone];
  return (
    <div
      style={{
        background: map.bg,
        color: map.fg,
        borderRadius: radius.md,
        padding: "10px 12px",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontWeight: 500,
      }}
    >
      {map.icon}
      {children}
    </div>
  );
}
