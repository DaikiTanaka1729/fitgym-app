// ============================================================
// ご意見アンケートの設問
// ------------------------------------------------------------
// 会員側の入力画面(M-06)と管理者側の集計(A-06)で共有する。
// 回答は survey_responses.answers に JSON で入るため、
// key を変えると過去の回答と集計が合わなくなる。追加は自由だが、
// 既存 key の意味は変えないこと。
// ============================================================

export const SCALE_LABELS = ["とても不満", "不満", "ふつう", "満足", "とても満足"];

export const QUESTIONS = [
  { key: "satisfaction", type: "scale", label: "サービス全体の満足度" },
  { key: "booking", type: "scale", label: "予約のしやすさ" },
  { key: "facility", type: "scale", label: "設備・清潔さ" },
  { key: "trainer", type: "scale", label: "トレーナーの対応" },
  {
    key: "comment",
    type: "text",
    label: "ご意見・ご要望(任意)",
    placeholder: "改善してほしい点、良かった点など",
  },
];

export const SCALE_QUESTIONS = QUESTIONS.filter((q) => q.type === "scale");
