import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { T, font } from "./theme/tokens";
import { isSupabaseConfigured } from "./api";
import { RequireAdmin, RequireMember } from "./session";
import {
  SignUpScreen,
  LoginScreen,
  AdminLoginScreen,
  AdminSignUpScreen,
  ResetPasswordScreen,
} from "./screens/auth";
import {
  ChangePasswordScreen,
  HomeScreen,
  ReserveScreen,
  ReserveDoneScreen,
  SurveyScreen,
} from "./screens/member";
import TrialBookingScreen from "./screens/public/TrialBookingScreen";
import {
  DashboardScreen,
  MemberDetailScreen,
  MembersScreen,
  MenusScreen,
  ReservationsScreen,
  SalesScreen,
  ShiftsScreen,
  SurveysScreen,
  TimetableScreen,
  TrainersScreen,
} from "./screens/admin";

// 9/20版のルーティング。
// 会員 = ライトテーマ(グリーン)・スマホ縦長 / 管理者 = ネイビー・タブレット/PC幅。
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
      <Routes>
        {/* 会員・認証:スマホ幅 */}
        <Route element={<Narrow />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/signup" element={<SignUpScreen />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/trial" element={<TrialBookingScreen />} />
          <Route path="/change-password" element={<RequireMember><ChangePasswordScreen /></RequireMember>} />
          <Route path="/home" element={<RequireMember><HomeScreen /></RequireMember>} />
          <Route path="/reserve" element={<RequireMember><ReserveScreen /></RequireMember>} />
          <Route path="/reserve/done" element={<RequireMember><ReserveDoneScreen /></RequireMember>} />
          <Route path="/survey" element={<RequireMember><SurveyScreen /></RequireMember>} />
          <Route path="/admin/login" element={<AdminLoginScreen />} />
          <Route path="/admin/signup" element={<AdminSignUpScreen />} />
          <Route path="/admin/reset-password" element={<ResetPasswordScreen adminMode />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>

        {/* 管理者:タブレット/PC幅 */}
        <Route element={<Wide />}>
          <Route path="/admin" element={<RequireAdmin><DashboardScreen /></RequireAdmin>} />
          <Route path="/admin/members" element={<RequireAdmin><MembersScreen /></RequireAdmin>} />
          <Route path="/admin/members/:memberId" element={<RequireAdmin><MemberDetailScreen /></RequireAdmin>} />
          <Route path="/admin/reservations" element={<RequireAdmin><ReservationsScreen /></RequireAdmin>} />
          <Route path="/admin/menus" element={<RequireAdmin><MenusScreen /></RequireAdmin>} />
          <Route path="/admin/sales" element={<RequireAdmin><SalesScreen /></RequireAdmin>} />
          <Route path="/admin/shifts" element={<RequireAdmin><ShiftsScreen /></RequireAdmin>} />
          <Route path="/admin/timetable" element={<RequireAdmin><TimetableScreen /></RequireAdmin>} />
          <Route path="/admin/trainers" element={<RequireAdmin><TrainersScreen /></RequireAdmin>} />
          <Route path="/admin/surveys" element={<RequireAdmin><SurveysScreen /></RequireAdmin>} />
        </Route>
      </Routes>
    </div>
  );
}

const Narrow = () => (
  <div style={{ maxWidth: 400, margin: "0 auto" }}>
    <Outlet />
  </div>
);

const Wide = () => (
  <div style={{ maxWidth: 1040, margin: "0 auto" }}>
    <Outlet />
  </div>
);

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
