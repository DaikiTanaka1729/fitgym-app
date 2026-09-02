import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { T, font } from "./theme/tokens";
import { isSupabaseConfigured } from "./api";
import { RequireMember } from "./session";
import {
  SignUpScreen,
  LoginScreen,
  AdminLoginScreen,
  ResetPasswordScreen,
} from "./screens/auth";
import { HomeScreen, ReserveScreen, ReserveDoneScreen } from "./screens/member";

// 9/20版のルーティング。
// 会員 = ライトテーマ(グリーン)/ 管理者 = ネイビー。
// 管理者機能の画面は Step 5 で追加する。
export default function App() {
  return (
    <div
      style={{
        fontFamily: font,
        background: T.bgPage,
        minHeight: "100vh",
        padding: "20px 16px 32px",
        color: T.text,
        boxSizing: "border-box",
      }}
    >
      {!isSupabaseConfigured && <SetupNotice />}
      <div style={{ maxWidth: 400, margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />

          {/* 認証 */}
          <Route path="/signup" element={<SignUpScreen />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />

          {/* 会員(ログイン必須) */}
          <Route path="/home" element={<RequireMember><HomeScreen /></RequireMember>} />
          <Route path="/reserve" element={<RequireMember><ReserveScreen /></RequireMember>} />
          <Route path="/reserve/done" element={<RequireMember><ReserveDoneScreen /></RequireMember>} />

          {/* 管理者 */}
          <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
          <Route path="/admin/login" element={<AdminLoginScreen />} />
          <Route path="/admin/reset-password" element={<ResetPasswordScreen adminMode />} />

          <Route path="*" element={<Navigate to="/home" replace />} />
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
        maxWidth: 400,
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
      を設定してください。
    </div>
  );
}
