import React from "react";
import { T, radius } from "../theme/tokens";

// options: [{ value, label }]
export default function Segmented({ options, value, onChange, accent = T.navy }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <div
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              border: `1px solid ${on ? accent : T.fieldBorder}`,
              background: on ? T.navySoft : T.bg,
              color: on ? accent : T.textMute,
              fontWeight: on ? 500 : 400,
              borderRadius: radius.md,
              padding: "9px 6px",
              textAlign: "center",
              fontSize: 11,
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {o.label}
          </div>
        );
      })}
    </div>
  );
}
