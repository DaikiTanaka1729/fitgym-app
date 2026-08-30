// ============================================================
// デザイントークン(基本設計書 第4章)
// ------------------------------------------------------------
// 配色はすべてここに集約する。画面・コンポーネントに直値のカラーコードを
// 書かないこと(CLAUDE.md コーディング規約)。
//   会員向け = ライトテーマ(白背景・グリーン)
//   管理者向け = ネイビー
// ============================================================

export const T = {
  primary: "#1A9E6E",
  primaryDark: "#16624A",
  primarySoft: "#EAF6F0",
  primaryBorder: "#B7E0CE",

  navy: "#1E2761",
  navySoft: "#EDF1FA",

  accent: "#534AB7",
  accentSoft: "#EEEDFE",
  accentDark: "#3C3489",

  danger: "#D03B3B",
  dangerSoft: "#FCF0F0",
  dangerBorder: "#F2C6C6",
  dangerDark: "#B23B3B",

  amberSoft: "#FAEEDA",
  amberDark: "#854F0B",
  graySoft: "#F1EFE8",
  grayDark: "#5F5E5A",

  bg: "#FFFFFF",
  bgPage: "#F7F8FB",
  bgSubtle: "#FAFBFC",
  field: "#F5F7FA",
  fieldBorder: "#DDE2EA",
  border: "#E3E6EB",
  borderFaint: "#EEF0F3",

  text: "#2C2C2A",
  textMute: "#6B7280",
  textFaint: "#AAB0B8",
  onDark: "#FFFFFF",
};

export const font =
  '"Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, -apple-system, sans-serif';

export const radius = { sm: 4, md: 8, lg: 12, xl: 14, xxl: 18 };

export const shadow = {
  card: "0 2px 8px rgba(20,30,50,.06)",
  raised: "0 3px 12px rgba(20,30,50,.07)",
};
