import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { T, font } from "./theme/tokens";
import { isSupabaseConfigured } from "./api";
import {
  SignUpScreen,
  LoginScreen,
  AdminLoginScreen,
  ResetPasswordScreen,
} from "./screens/auth";

// 9/20版のルーティング。
// 会員 = ライトテーマ(グリーン)/ 管理者 = ネイビー。
// 予約・管理者機能の画面は Step 4 以降で追加する。
export default function App() {
  return (
    <div
      style={{
        fontFamily: font,
        background: T.bgPage,
        minHeight: "100vh",
        padding: "28px 20px",
        color: T.text,
        boxSizing: "border-box",
      }}
    >
      {!isSupabaseConfigured && <SetupNotice />}
      <div style={{ maxWidth: 340, margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/signup" element={<SignUpScreen />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
          <Route path="/admin/login" element={<AdminLoginScreen />} />
          <Route path="/admin/reset-password" element={<ResetPasswordScreen adminMode />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// 環境変数未設定(Supabase 未接続)のあいだだけ出す開発用の注意書き。
function SetupNotice() {
  return (
    <div
      style={{
        maxWidth: 340,
        margin: "0 auto 14px",
        background: T.amberSoft,
        color: T.amberDark,
        borderRadius: 8,
        padding: "8px 11px",
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      Supabase 未接続です。.env.local に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
      を設定すると本番接続に切り替わります(現在は仮の認証で動作)。
    </div>
  );
}
