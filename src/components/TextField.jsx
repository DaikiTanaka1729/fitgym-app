import React from "react";
import { T, font, radius } from "../theme/tokens";

// ラベル + 入力欄 + エラーメッセージ。
// right には「表示/隠す」等の補助アクションを差し込める。
export default function TextField({
  label,
  type = "text",
  value,
  placeholder,
  required,
  error,
  onChange,
  right,
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>
          {label}
          {required && <span style={{ color: T.danger }}> ※必須</span>}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={{
            width: "100%",
            background: error ? T.dangerSoft : T.field,
            border: `1px solid ${error ? T.danger : T.fieldBorder}`,
            borderRadius: radius.md,
            padding: "10px 11px",
            fontSize: 12,
            color: T.text,
            fontFamily: font,
            boxSizing: "border-box",
            outline: "none",
          }}
        />
        {right && (
          <span style={{ position: "absolute", right: 10, top: 9, fontSize: 11, color: T.accent, cursor: "pointer" }}>
            {right}
          </span>
        )}
      </div>
      {error && <div style={{ fontSize: 10, color: T.danger, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
