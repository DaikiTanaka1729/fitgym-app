import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Banner, Button, CheckCircleIcon, TextField } from "../../components";
import { trialApi } from "../../api";
import AuthCard from "../auth/AuthCard";
import { isEmail } from "../auth/validation";

// M-10 体験予約フォーム
// 会員登録の前に申し込む導線。ログイン不要。
export default function TrialBookingScreen() {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", phone: "", date: "", time: "", note: "" });
  const [err, setErr] = useState({});
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (v) => setF({ ...f, [k]: v });

  async function submit() {
    setBanner(null);
    const e = {};
    if (!f.name.trim()) e.name = "お名前を入力してください";
    if (!f.email.trim()) e.email = "メールアドレスを入力してください";
    else if (!isEmail(f.email)) e.email = "メールアドレスの形式が正しくありません";
    setErr(e);
    if (Object.keys(e).length) return;

    // 希望日時は任意。日付だけの入力でも受け付ける。
    let preferredAt = null;
    if (f.date) preferredAt = `${f.date}T${f.time || "10:00"}:00+09:00`;

    setLoading(true);
    const { error } = await trialApi.create({
      name: f.name,
      email: f.email,
      phone: f.phone,
      preferredAt,
      note: f.note,
    });
    setLoading(false);
    if (error) {
      setBanner(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthCard title="送信完了" sub="お申し込みありがとうございます">
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <CheckCircleIcon />
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>お申し込みを受け付けました</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 8, lineHeight: 1.8 }}>
            店舗より、ご入力いただいたメールアドレス宛に
            <br />
            ご連絡いたします。しばらくお待ちください。
          </div>
          <div style={{ marginTop: 18 }}>
            <Button variant="secondary" full onClick={() => navigate("/login")}>
              アプリのログイン画面へ
            </Button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="無料体験のお申し込み" sub="ご希望をお知らせください">
      {banner && <Banner>{banner}</Banner>}

      <div style={{ fontSize: 11.5, color: T.textMute, lineHeight: 1.7, marginBottom: 14 }}>
        会員登録は不要です。お申し込み後、店舗よりご連絡いたします。
      </div>

      <TextField label="お名前" required value={f.name} onChange={set("name")} placeholder="山田 太郎" error={err.name} />
      <TextField
        label="メールアドレス"
        required
        value={f.email}
        onChange={set("email")}
        placeholder="name@example.com"
        error={err.email}
      />
      <TextField label="電話番号" value={f.phone} onChange={set("phone")} placeholder="090-1234-5678" />

      <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>ご希望の日時(任意)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 8, marginBottom: 14 }}>
        <input
          type="date"
          value={f.date}
          onChange={(e) => set("date")(e.target.value)}
          style={inputStyle}
        />
        <input
          type="time"
          value={f.time}
          onChange={(e) => set("time")(e.target.value)}
          step={1800}
          style={inputStyle}
        />
      </div>

      <div style={{ fontSize: 11, color: T.textMute, fontWeight: 500, marginBottom: 5 }}>ご質問・ご要望(任意)</div>
      <textarea
        value={f.note}
        onChange={(e) => set("note")(e.target.value)}
        rows={3}
        placeholder="運動の経験がほとんどありません、など"
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.7, marginBottom: 16 }}
      />

      <Button full onClick={submit} loading={loading}>
        この内容で申し込む
      </Button>

      <div
        onClick={() => navigate("/login")}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && navigate("/login")}
        style={{ textAlign: "center", fontSize: 11, color: T.accent, marginTop: 12, cursor: "pointer" }}
      >
        すでに会員の方はログイン
      </div>
    </AuthCard>
  );
}

const inputStyle = {
  width: "100%",
  background: T.field,
  border: `1px solid ${T.fieldBorder}`,
  borderRadius: radius.md,
  padding: "10px 11px",
  fontSize: 12,
  color: T.text,
  fontFamily: font,
  boxSizing: "border-box",
  outline: "none",
};
