import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../../theme/tokens";
import { Button, TextField, Banner } from "../../components";
import AuthCard from "./AuthCard";
import { mockAuth } from "./mockAuth"; // TODO(Step3): authApi.signInAdmin へ差し替え

// A-01 管理者ログイン(会員側とは認証を分離。配色はネイビー)
export default function AdminLoginScreen() {
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
    const e = {};
    if (!email.trim()) e.email = "IDまたはメールアドレスを入力してください";
    if (!password) e.password = "パスワードを入力してください";
    setErr(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const res = await mockAuth.signInAdmin({ email, password });
    setLoading(false);
    if (res.error) setBanner(res.error);
    else setOk(`ログイン成功:${res.user.role}(管理ダッシュボードへ)`);
  }

  return (
    <AuthCard accent={T.navy} title="FitGym 管理コンソール" sub="管理者ログイン">
      {banner && <Banner>{banner}</Banner>}
      {ok && <Banner tone="success">{ok}</Banner>}
      <TextField label="管理者ID / メールアドレス" value={email} onChange={setEmail} placeholder="admin@fitgym.jp" error={err.email} />
      <TextField
        label="パスワード"
        type={show ? "text" : "password"}
        value={password}
        onChange={setPassword}
        placeholder="パスワード"
        error={err.password}
        right={<span onClick={() => setShow(!show)}>{show ? "隠す" : "表示"}</span>}
      />
      <div style={{ marginTop: 4 }}>
        <Button variant="navy" full onClick={submit} loading={loading}>
          ログイン
        </Button>
      </div>
      <div
        onClick={() => navigate("/admin/reset-password")}
        style={{ textAlign: "center", fontSize: 11, color: T.accent, marginTop: 12, cursor: "pointer" }}
      >
        パスワードをお忘れの方
      </div>
      <div style={{ fontSize: 11, color: T.textMute, marginTop: 10, lineHeight: 1.6 }}>
        権限ロール:店舗管理者 / スタッフ(記録入力)。会員側とは認証を分離しています。
      </div>
      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 8, textAlign: "center" }}>
        テスト: admin@fitgym.jp / admin12345
      </div>
    </AuthCard>
  );
}
