import React, { useEffect, useState } from "react";
import { T, radius } from "../../theme/tokens";
import { Badge, Banner, Button, Segmented, Spinner } from "../../components";
import { downloadCsv, surveyApi, toCsv, trialApi } from "../../api";
import { QUESTIONS, SCALE_LABELS, SCALE_QUESTIONS } from "../../survey";
import AdminLayout from "./AdminLayout";

const TRIAL_STATUS = {
  new: { label: "未対応", tone: "amber" },
  contacted: { label: "連絡済", tone: "accent" },
  done: { label: "完了", tone: "primary" },
  cancelled: { label: "キャンセル", tone: "gray" },
};

const jdt = (v) =>
  v
    ? new Date(v).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// A-06 アンケート集計 + 体験予約の受付一覧
export default function SurveysScreen() {
  const [tab, setTab] = useState("survey");
  const [rows, setRows] = useState(null);
  const [trials, setTrials] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    const [s, t] = await Promise.all([surveyApi.list(), trialApi.list()]);
    if (s.error) setBanner(s.error);
    setRows(s.data || []);
    setTrials(t.data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(id, status) {
    setBusy(id);
    setBanner(null);
    const { error } = await trialApi.setStatus({ id, status });
    setBusy(null);
    if (error) {
      setBanner(error);
      return;
    }
    load();
  }

  // 設問ごとの平均と分布
  const stats = SCALE_QUESTIONS.map((q) => {
    const vals = (rows || []).map((r) => r.answers?.[q.key]).filter((v) => typeof v === "number");
    const dist = [0, 0, 0, 0, 0];
    vals.forEach((v) => {
      if (v >= 1 && v <= 5) dist[v - 1] += 1;
    });
    return {
      ...q,
      count: vals.length,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      dist,
    };
  });

  const comments = (rows || []).filter((r) => (r.answers?.comment || "").trim());

  function exportSurveyCsv() {
    if (!rows?.length) return;
    downloadCsv(
      `fitgym_survey_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}.csv`,
      toCsv(rows, [
        { label: "回答日時", value: (r) => jdt(r.created_at) },
        { label: "会員名", value: (r) => r.member_name || "" },
        ...QUESTIONS.map((q) => ({ label: q.label, value: (r) => r.answers?.[q.key] ?? "" })),
      ])
    );
  }

  function exportTrialCsv() {
    if (!trials?.length) return;
    downloadCsv(
      `fitgym_trial_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}.csv`,
      toCsv(trials, [
        { label: "申込日時", value: (r) => jdt(r.created_at) },
        { label: "お名前", value: (r) => r.name },
        { label: "メールアドレス", value: (r) => r.email },
        { label: "電話番号", value: (r) => r.phone || "" },
        { label: "希望日時", value: (r) => jdt(r.preferred_at) },
        { label: "ご要望", value: (r) => r.note || "" },
        { label: "状態", value: (r) => TRIAL_STATUS[r.status]?.label || r.status },
      ])
    );
  }

  const loading = rows === null || trials === null;

  return (
    <AdminLayout
      title="アンケート・体験予約"
      sub={tab === "survey" ? `回答 ${rows?.length ?? 0} 件` : `申し込み ${trials?.length ?? 0} 件`}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 230 }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "survey", label: "アンケート" },
                { value: "trial", label: "体験予約" },
              ]}
            />
          </div>
          <Button
            variant="navy"
            onClick={tab === "survey" ? exportSurveyCsv : exportTrialCsv}
            disabled={tab === "survey" ? !rows?.length : !trials?.length}
          >
            CSVで書き出す
          </Button>
        </div>
      }
    >
      {banner && <Banner>{banner}</Banner>}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
          <Spinner color={T.textFaint} size={20} />
        </div>
      )}

      {/* ---------- アンケート ---------- */}
      {!loading && tab === "survey" && (
        <>
          {rows.length === 0 ? (
            <Empty>回答はまだありません。</Empty>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12, marginBottom: 22 }}>
                {stats.map((s) => (
                  <div key={s.key} style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "13px 15px" }}>
                    <div style={{ fontSize: 11.5, color: T.textMute }}>{s.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 24, fontWeight: 500, color: T.primaryDark, fontVariantNumeric: "tabular-nums" }}>
                        {s.avg ? s.avg.toFixed(1) : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: T.textFaint }}>/ 5.0 ({s.count}件)</span>
                    </div>
                    {/* 分布 */}
                    <div style={{ display: "flex", gap: 3, marginTop: 10, alignItems: "flex-end", height: 34 }}>
                      {s.dist.map((n, i) => {
                        const max = Math.max(...s.dist, 1);
                        return (
                          <div key={i} style={{ flex: 1, textAlign: "center" }} title={`${SCALE_LABELS[i]}: ${n}件`}>
                            <div
                              style={{
                                height: Math.max(2, Math.round((n / max) * 26)),
                                background: n > 0 ? T.primary : T.borderFaint,
                                borderRadius: 2,
                              }}
                            />
                            <div style={{ fontSize: 9, color: T.textFaint, marginTop: 3 }}>{i + 1}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 500, color: T.textMute, marginBottom: 10 }}>
                自由記述({comments.length}件)
              </div>
              {comments.length === 0 ? (
                <Empty>自由記述の回答はありません。</Empty>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {comments.map((r) => (
                    <div key={r.id} style={{ border: `1px solid ${T.border}`, borderRadius: radius.lg, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, color: T.textFaint }}>
                        <span>{r.member_name || "(退会または不明)"}</span>
                        <span>{jdt(r.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                        {r.answers.comment}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ---------- 体験予約 ---------- */}
      {!loading && tab === "trial" && (
        <>
          {trials.length === 0 ? (
            <Empty>体験予約の申し込みはまだありません。</Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["申込日時", "お名前", "連絡先", "希望日時", "ご要望", "状態", "操作"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trials.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 ? T.bgSubtle : T.bg }}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{jdt(r.created_at)}</td>
                      <td style={tdStyle}>{r.name}</td>
                      <td style={tdStyle}>
                        <div>{r.email}</div>
                        {r.phone && <div style={{ fontSize: 11, color: T.textFaint }}>{r.phone}</div>}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{jdt(r.preferred_at)}</td>
                      <td style={{ ...tdStyle, maxWidth: 220 }}>{r.note || "—"}</td>
                      <td style={tdStyle}>
                        <Badge tone={TRIAL_STATUS[r.status]?.tone || "gray"}>
                          {TRIAL_STATUS[r.status]?.label || r.status}
                        </Badge>
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={r.status}
                          disabled={busy === r.id}
                          onChange={(e) => setStatus(r.id, e.target.value)}
                          style={{
                            background: T.field,
                            border: `1px solid ${T.fieldBorder}`,
                            borderRadius: radius.md,
                            padding: "6px 8px",
                            fontSize: 11.5,
                            color: T.text,
                            outline: "none",
                          }}
                        >
                          {Object.entries(TRIAL_STATUS).map(([v, s]) => (
                            <option key={v} value={v}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMute, lineHeight: 1.7 }}>
            申し込みフォームは <code>/trial</code> です。公式サイトやSNSからこのURLにリンクしてください。
          </div>
        </>
      )}
    </AdminLayout>
  );
}

const thStyle = {
  background: T.navy,
  color: T.onDark,
  fontSize: 11,
  fontWeight: 500,
  padding: "9px 12px",
  textAlign: "left",
  whiteSpace: "nowrap",
};
const tdStyle = { padding: "9px 12px", borderTop: `1px solid ${T.borderFaint}`, verticalAlign: "top" };

function Empty({ children }) {
  return (
    <div
      style={{
        border: `1px dashed ${T.fieldBorder}`,
        borderRadius: radius.lg,
        padding: "28px 16px",
        textAlign: "center",
        background: T.bgSubtle,
        color: T.textFaint,
        fontSize: 12.5,
      }}
    >
      {children}
    </div>
  );
}
