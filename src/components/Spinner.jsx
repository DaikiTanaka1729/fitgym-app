import React from "react";
import { T } from "../theme/tokens";

export default function Spinner({ size = 15, color = T.onDark }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "fg-spin 0.7s linear infinite" }}>
      <style>{`@keyframes fg-spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="3" fill="none" opacity="0.3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
