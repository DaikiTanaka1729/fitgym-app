import React from "react";
import { T, radius } from "../theme/tokens";
import useNarrow from "./useNarrow";

// columns: [{ key, label, w?, render?(value, row) }]
// 管理者向け一覧。ヘッダー=ネイビー、行=ゼブラ。
//
// 狭い画面では表をやめて、1行を1枚のカードにする。
// 列幅を割合で決めているため、スマートフォンの幅では
// 文字が1字ずつ折り返し、右端の操作列が画面の外に出て押せなくなる。
// 横スクロールにする手もあるが、操作するたびに端まで送ることになるので
// 項目名と値を縦に並べる形にした。
export default function DataTable({ columns, rows }) {
  const narrow = useNarrow();

  if (narrow) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r, i) => (
          <div
            key={r.id ?? i}
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: radius.lg,
              overflow: "hidden",
              background: T.bg,
            }}
          >
            {columns.map((c, n) => {
              const content = c.render ? c.render(r[c.key], r) : r[c.key];
              return (
                <div
                  key={c.key}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 14,
                    padding: "9px 13px",
                    borderTop: n ? `1px solid ${T.borderFaint}` : "none",
                    background: n === 0 ? T.navySoft : "transparent",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: T.textMute,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      flex: "0 0 auto",
                    }}
                  >
                    {c.label}
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: T.text,
                      textAlign: "right",
                      minWidth: 0,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      justifyContent: "flex-end",
                      alignItems: "center",
                    }}
                  >
                    {content}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

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
