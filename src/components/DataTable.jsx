import React from "react";
import { T, radius } from "../theme/tokens";

// columns: [{ key, label, w?, render?(value, row) }]
// 管理者向け一覧。ヘッダー=ネイビー、行=ゼブラ。
export default function DataTable({ columns, rows }) {
  const grid = columns.map((c) => c.w || "1fr").join(" ");
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: grid, background: T.navy }}>
        {columns.map((c) => (
          <div key={c.key} style={{ color: T.onDark, fontSize: 11, fontWeight: 500, padding: "9px 12px" }}>
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id ?? i}
          style={{
            display: "grid",
            gridTemplateColumns: grid,
            background: i % 2 ? T.bgSubtle : T.bg,
            borderTop: i ? `1px solid ${T.borderFaint}` : "none",
          }}
        >
          {columns.map((c) => (
            <div key={c.key} style={{ fontSize: 12, padding: "10px 12px", color: T.text }}>
              {c.render ? c.render(r[c.key], r) : r[c.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
