import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../../theme/tokens";
import { Button, TextField, Banner, CheckCircleIcon } from "../../components";
import AuthCard from "./AuthCard";
import { validateSignup } from "./validation";
import { authApi } from "../../api";

// M-01 会員登録
export default function SignUpScreen() {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", birth: "" });
  const [err, setErr] = useState({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [done, setDone] = useState(false);
  // メール確認が有効な場合、登録直後はセッションが張られない。
  // その場合は「ログインへ」ではなく確認メールの案内を出す。
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  async function submit() {
    setBanner(null);
    const e = validateSignup(f);
    setErr(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const { data, error } = await authApi.signUpMember({
      name: f.name,
      email: f.email,
      password: f.password,
      birthDate: f.birth,
    });
    setLoading(false);
    if (error) {
      setBanner(error);
      return;
    }
    setNeedsConfirm(!data?.session);
    setDone(true);
  }

  if (done)
    return (
      <AuthCard title="FitGym" sub="登録完了">
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <CheckCircleIcon />
          <div style={{ fontSize: 15, fontWeight: 500, marginTop: 10 }}>ようこそ、{f.name} さん</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 6, lineHeight: 1.6 }}>
            {needsConfirm ? (
              <>
                {f.email} 宛に確認メールを送りました。
                <br />
                メール内のリンクを開くとご利用を開始できます。
              </>
            ) : (
              <>
                会員登録が完了しました。
                <br />
                ログインしてご利用を開始できます。
              </>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <Button full onClick={() => navigate("/login")}>
              ログインへ進む
            </Button>
          </div>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard title="FitGym" sub="新規会員登録">
      {banner && <Banner>{banner}</Banner>}
      <TextField label="氏名" required value={f.name} onChange={set("name")} placeholder="山田 太郎" error={err.name} />
      <TextField label="メールアドレス" required value={f.email} onChange={set("email")} placeholder="name@example.com" error={err.email} />
      <TextField label="パスワード" required type="password" value={f.password} onChange={set("password")} placeholder="8文字以上" error={err.password} />
      <TextField label="生年月日" value={f.birth} onChange={set("birth")} placeholder="1990/01/01" error={err.birth} />
      <Button full onClick={submit} loading={loading}>
        会員登録する
      </Button>
      <div
        onClick={() => navigate("/login")}
        style={{ textAlign: "center", fontSize: 11, color: T.accent, marginTop: 12, cursor: "pointer" }}
      >
        すでに登録済みの方はログイン
      </div>
    </AuthCard>
  );
}
