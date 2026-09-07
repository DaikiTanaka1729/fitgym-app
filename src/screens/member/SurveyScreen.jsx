import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, CheckCircleIcon } from "../../components";
import { surveyApi } from "../../api";
import { QUESTIONS, SCALE_LABELS } from "../../survey";
import MemberLayout from "./MemberLayout";

// M-06 ご意見アンケート
export default function SurveyScreen() {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const scaleQuestions = QUESTIONS.filter((q) => q.type === "scale");
  const answered = scaleQuestions.filter((q) => answers[q.key]).length;

  async function submit() {
    setBanner(null);
    if (answered === 0) {
      setBanner("いずれかの項目にご回答ください");
      return;
    }
    setLoading(true);
    const { error } = await surveyApi.submit({ answers });
    setLoading(false);
    if (error) {
      setBanner(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <MemberLayout title="送信完了" sub="ご協力ありがとうございました">
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <CheckCircleIcon />
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>回答を送信しました</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 6, lineHeight: 1.7 }}>
            いただいたご意見は
            <br />
            サービスの改善に活用させていただきます。
          </div>
          <div style={{ marginTop: 18 }}>
            <Button full onClick={() => navigate("/home")}>
              ホームへ戻る
            </Button>
          </div>
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout title="ご意見アンケート" sub="よりよいサービスのために" onBack={() => navigate("/home")}>
      {banner && <Banner>{banner}</Banner>}

      <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.7, marginBottom: 16 }}>
        当てはまるものをお選びください。すべてに答えなくても送信できます。
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {QUESTIONS.map((q) =>
          q.type === "scale" ? (
            <div key={q.key}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>{q.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4 }}>
                {SCALE_LABELS.map((label, i) => {
                  const v = i + 1;
                  const on = answers[q.key] === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setAnswers({ ...answers, [q.key]: v })}
                      style={{
                        border: `1px solid ${on ? T.primary : T.fieldBorder}`,
                        background: on ? T.primarySoft : T.bg,
                        color: on ? T.primaryDark : T.textMute,
                        fontWeight: on ? 500 : 400,
                        borderRadius: radius.md,
                        padding: "8px 2px",
                        fontSize: 9.5,
                        fontFamily: font,
                        cursor: "pointer",
                        lineHeight: 1.4,
                      }}
                    >
                      <div style={{ fontSize: 14, marginBottom: 2 }}>{v}</div>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div key={q.key}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>{q.label}</div>
              <textarea
                value={answers[q.key] || ""}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
                rows={4}
                placeholder={q.placeholder}
                style={{
                  width: "100%",
                  background: T.field,
                  border: `1px solid ${T.fieldBorder}`,
                  borderRadius: radius.md,
                  padding: "10px 11px",
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: T.text,
                  fontFamily: font,
                  boxSizing: "border-box",
                  outline: "none",
                  resize: "vertical",
                }}
              />
            </div>
          )
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <Button full onClick={submit} loading={loading}>
          回答を送信する
        </Button>
      </div>
    </MemberLayout>
  );
}
