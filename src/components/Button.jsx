import React from "react";
import { T, font, radius } from "../theme/tokens";
import Spinner from "./Spinner";

// variant: primary(会員) / navy(管理者) / secondary / ghost / danger
// loading 中は自動で disabled + スピナー表示。
export default function Button({
  variant = "primary",
  children,
  full,
  onClick,
  icon,
  loading = false,
  disabled = false,
  type = "button",
}) {
  const styles = {
    primary: { background: T.primary, color: T.onDark, border: "none" },
    navy: { background: T.navy, color: T.onDark, border: "none" },
    secondary: { background: T.bg, color: T.primary, border: `1px solid ${T.primary}` },
    ghost: { background: T.bg, color: T.textMute, border: `1px solid ${T.border}` },
    danger: { background: T.danger, color: T.onDark, border: "none" },
  }[variant];

  const isBusy = loading || disabled;
  const spinnerColor = variant === "secondary" ? T.primary : variant === "ghost" ? T.textMute : T.onDark;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isBusy}
      style={{
        ...styles,
        width: full ? "100%" : "auto",
        height: 42,
        padding: "0 18px",
        borderRadius: radius.md,
        fontSize: 13,
        fontWeight: 500,
        fontFamily: font,
        cursor: isBusy ? "default" : "pointer",
        opacity: loading ? 0.7 : 1,
        display: full ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      {loading ? <Spinner color={spinnerColor} /> : icon}
      {children}
    </button>
  );
}
