import React from "react";
import { T, radius } from "../theme/tokens";
import { LockIcon } from "./icons";

// 9/20版で封印する画面(記録・マイページ)の代替表示。
export default function LockedState({ note }) {
  return (
    <div
      style={{
        border: `1px dashed ${T.fieldBorder}`,
        borderRadius: radius.lg,
        padding: "30px 16px",
        textAlign: "center",
        background: T.bgSubtle,
      }}
    >
      <LockIcon size={34} color={T.textFaint} />
      <div style={{ color: T.textMute, fontWeight: 500, fontSize: 15, marginTop: 10 }}>Coming Soon</div>
      <div style={{ color: T.textFaint, fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>
        {note || "近日公開"}
      </div>
    </div>
  );
}
