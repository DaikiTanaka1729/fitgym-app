import React from "react";
import { T } from "../theme/tokens";
import { LockIcon } from "./icons";

// tabs: [{ key, label, locked }]
// locked = 9/20版で封印中(記録・マイページ)。押しても遷移しない。
export default function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${T.borderFaint}` }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <div
            key={t.key}
            onClick={() => !t.locked && onChange(t.key)}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 0",
              fontSize: 12,
              color: t.locked ? T.textFaint : on ? T.primary : T.textFaint,
              fontWeight: on ? 500 : 400,
              borderBottom: on ? `2px solid ${T.primary}` : "2px solid transparent",
              cursor: t.locked ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            {t.label}
            {t.locked && <LockIcon size={11} color={T.textFaint} />}
          </div>
        );
      })}
    </div>
  );
}
