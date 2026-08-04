import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { C } from "./theme";
import { ADMIN_EMAILS } from "./helpers";
import { sb } from "./db";
import { CloverLogo, Spinner } from "./ui";
import { OnboardingScreen } from "./screens/Onboarding";
import { AdminScreen } from "./screens/Admin";
import { DashboardScreen } from "./screens/Dashboard";

// No login screen by design — bounce straight to Google OAuth (same as Radar).
function redirectToLogin() {
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin, queryParams: { hd: "rideclover.com" } },
  });
}

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!supabase) { setScreen("loading"); return; }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user?.email?.endsWith("@rideclover.com")) {
        redirectToLogin();
        return; // Keep showing spinner during redirect
      }

      const accessToken = session.access_token;
      const u = session.user;
      const p = await sb.getProfile(accessToken, u.id);
      setToken(accessToken);
      setUser(u);
      setProfile(p);
      setScreen(p ? "dashboard" : "onboarding");
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user?.email?.endsWith("@rideclover.com")) {
        setToken(null); setUser(null); setProfile(null);
        setScreen("loading");
        // On explicit sign-out, bounce back to Google instead of hanging on the spinner.
        if (_event === "SIGNED_OUT") redirectToLogin();
        return;
      }
      const accessToken = session.access_token;
      const u = session.user;
      const p = await sb.getProfile(accessToken, u.id);
      setToken(accessToken);
      setUser(u);
      setProfile(p);
      setScreen(p ? "dashboard" : "onboarding");
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setToken(null); setUser(null); setProfile(null);
    setScreen("loading");
  };

  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {screen === "loading" && (
        <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
          <CloverLogo height={32}/><Spinner color={C.blue} size={24}/>
        </div>
      )}
      {screen === "onboarding" && user && (
        <OnboardingScreen user={user} token={token} onComplete={async () => {
          const p = await sb.getProfile(token, user.id);
          setProfile(p); setScreen("dashboard");
        }}/>
      )}
      {screen === "dashboard" && user && (
        <DashboardScreen user={user} profile={profile} token={token} onSignOut={handleSignOut} isAdmin={isAdmin} onAdmin={() => setScreen("admin")}/>
      )}
      {screen === "admin" && user && isAdmin && (
        <AdminScreen token={token} onBack={() => setScreen("dashboard")}/>
      )}
    </>
  );
}
