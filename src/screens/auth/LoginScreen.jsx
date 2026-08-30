import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, font, radius } from "../../theme/tokens";
import { Button, TextField, Banner } from "../../components";
import AuthCard from "./AuthCard";
import { validateLogin } from "./validation";
import { mockAuth } from "./mockAuth"; // TODO(Step3): authApi.signInMember へ差し替え

// M-02 会員ログイン
export default function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [ok, setOk] = useState(null);

  async function submit() {
    setBanner(null);
    setOk(null);
    const e = validateLogin({ email, password });
    setErr(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const res = await mockAuth.signInMember({ email, password });
    setLoading(false);
    if (res.error) setBanner(res.error);
    else setOk(`ログイン成功:${res.user.name} さん(ホームへ遷移)`);
  }

  return (
    <AuthCard title="FitGym" sub="ログイン">
      {banner && <Banner>{banner}</Banner>}
      {ok && <Banner tone="success">{ok}</Banner>}
      <TextField label="メールアドレス" value={email} onChange={setEmail} placeholder="name@example.com" error={err.email} />
      <TextField
        label="パスワード"
        type={show ? "text" : "password"}
        value={password}
        onChange={setPassword}
        placeholder="パスワード"
        error={err.password}
        right={<span onClick={() => setShow(!show)}>{show ? "隠す" : "表示"}</span>}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, margin: "2px 0 14px" }}>
        <span style={{ color: T.textMute }}>ログイン状態を保持</span>
        <span onClick={() => navigate("/reset-password")} style={{ color: T.accent, cursor: "pointer" }}>
          パスワードをお忘れの方
        </span>
      </div>
      <Button full onClick={submit} loading={loading}>
        ログイン
      </Button>
      <div style={{ borderTop: `1px solid ${T.borderFaint}`, margin: "14px 0" }} />
      <button
        onClick={() => navigate("/signup")}
        style={{
          width: "100%",
          height: 42,
          background: T.bg,
          color: T.primary,
          border: `1px solid ${T.primary}`,
          borderRadius: radius.md,
          fontSize: 13,
          fontWeight: 500,
          fontFamily: font,
          cursor: "pointer",
        }}
      >
        はじめての方は会員登録
      </button>
      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 10, textAlign: "center" }}>
        テスト: tanaka@example.com / password123
      </div>
    </AuthCard>
  );
}
