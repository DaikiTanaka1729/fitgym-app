import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, radius } from "../../theme/tokens";
import { Button, TextField, Banner, MailIcon, CheckCircleIcon } from "../../components";
import AuthCard from "./AuthCard";
import { isEmail, validateNewPassword } from "./validation";
import { mockAuth } from "./mockAuth"; // TODO(Step3): authApi.sendResetLink / updatePassword へ差し替え

// M-08 / A-07 パスワード再設定(セルフ・3ステップ)
//   1) メールアドレス入力 → 2) 送信完了 → 3) 新パスワード設定
// 未登録アドレスでも「送信しました」と表示する(存在有無を推測させない)。
export default function ResetPasswordScreen({ adminMode = false }) {
  const navigate = useNavigate();
  const accent = adminMode ? T.navy : T.primary;
  const variant = adminMode ? "navy" : "primary";
  const backTo = adminMode ? "/admin/login" : "/login";

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwErr, setPwErr] = useState({});
  const [done, setDone] = useState(false);

  async function sendLink() {
    setErr(null);
    if (!isEmail(email)) {
      setErr("メールアドレスの形式が正しくありません");
      return;
    }
    setLoading(true);
    await mockAuth.sendResetLink({ email });
    setLoading(false);
    setStep(2);
  }

  async function changePw() {
    const e = validateNewPassword({ password: pw, confirm: pw2 });
    setPwErr(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    await mockAuth.updatePassword({ email, password: pw });
    setLoading(false);
    setDone(true);
  }

  const backLink = (
    <div
      onClick={() => navigate(backTo)}
      style={{ textAlign: "center", fontSize: 11, color: T.accent, marginTop: 12, cursor: "pointer" }}
    >
      ログインに戻る
    </div>
  );

  if (done)
    return (
      <AuthCard accent={accent} title="変更完了" sub="パスワードを更新しました">
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <CheckCircleIcon />
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 10 }}>パスワードを変更しました</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 6 }}>新しいパスワードでログインできます。</div>
          <div style={{ marginTop: 16 }}>
            <Button variant={variant} full onClick={() => navigate(backTo)}>
              ログインへ
            </Button>
          </div>
        </div>
      </AuthCard>
    );

  if (step === 1)
    return (
      <AuthCard accent={accent} title="パスワード再設定" sub="登録メールに再設定リンクを送ります">
        {err && <Banner>{err}</Banner>}
        <TextField label="登録メールアドレス" value={email} onChange={setEmail} placeholder="name@example.com" />
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: -6, marginBottom: 12 }}>
          このアドレス宛に再設定用リンクをお送りします
        </div>
        <Button variant={variant} full onClick={sendLink} loading={loading}>
          再設定リンクを送る
        </Button>
        {backLink}
      </AuthCard>
    );

  if (step === 2)
    return (
      <AuthCard accent={accent} title="メールを送信しました" sub="受信箱をご確認ください">
        <div style={{ textAlign: "center", padding: "6px 0 10px" }}>
          <MailIcon color={accent} />
        </div>
        <div style={{ fontSize: 12, color: T.text, textAlign: "center", lineHeight: 1.7, marginBottom: 14 }}>
          {email} 宛に再設定リンクを送信しました。メール内のボタンから手続きを続けてください。
        </div>
        <div
          style={{
            background: T.field,
            borderRadius: radius.md,
            padding: "10px 12px",
            fontSize: 11,
            color: T.textMute,
            lineHeight: 1.6,
            marginBottom: 12,
          }}
        >
          ・リンクの有効期限は60分です
          <br />
          ・届かない場合は迷惑メールもご確認ください
        </div>
        {/* 仮導線:本番はメール内リンクから /reset-password に戻り step3 を表示する */}
        <Button variant={variant} full onClick={() => setStep(3)}>
          (デモ)リンクを開く → 新パスワード設定
        </Button>
        {backLink}
      </AuthCard>
    );

  return (
    <AuthCard accent={accent} title="新しいパスワード" sub="リンクから開いた画面">
      <TextField label="新しいパスワード" type="password" value={pw} onChange={setPw} placeholder="8文字以上" error={pwErr.password} />
      <TextField label="新しいパスワード(確認)" type="password" value={pw2} onChange={setPw2} placeholder="もう一度入力" error={pwErr.confirm} />
      <div
        style={{
          background: T.primarySoft,
          borderRadius: radius.md,
          padding: "8px 10px",
          fontSize: 10,
          color: T.primaryDark,
          lineHeight: 1.6,
          marginBottom: 13,
        }}
      >
        {pw.length >= 8 ? "✓" : "・"} 8文字以上　{pw && pw === pw2 ? "✓" : "・"} 2つが一致
      </div>
      <Button variant={variant} full onClick={changePw} loading={loading}>
        パスワードを変更する
      </Button>
    </AuthCard>
  );
}
