import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import Navigation from "./components/Navigation";
import Login from "./pages/Login";
import Library from "./pages/Library";
import Queue from "./pages/Queue";
import History from "./pages/History";
import Settings from "./pages/Settings";

export default function App() {
  const [page, setPage] = useState<string>("login");
  const [username, setUsername] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStats, setSyncStats] = useState<{ scraped_count: number; new_count: number }>({
    scraped_count: 0,
    new_count: 0,
  });

  useEffect(() => {
    // Startup check: attempt auto-login
    invoke("auto_login")
      .then((res: any) => {
        if (res && res.status === "success" && res.username) {
          setUsername(res.username);
          setPage("library");
        } else {
          setPage("login");
        }
      })
      .catch(() => {
        setPage("login");
      })
      .finally(() => {
        setIsInitializing(false);
      });
  }, []);

  const handleLoginSuccess = (user: string) => {
    setUsername(user);
    setPage("library");
  };

  const handleLogout = () => {
    setUsername("");
    setPage("login");
  };

  if (isInitializing) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundImage: "radial-gradient(circle at center, #1E124A 0%, #080512 100%)",
        color: "white"
      }}>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
          textAlign: "center"
        }}>
          <h1 style={{
            fontSize: "36px",
            fontWeight: "800",
            letterSpacing: "-0.5px",
            background: "linear-gradient(135deg, white 0%, #B388FF 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>ReelRipper</h1>
          <p style={{ color: "#9E9AA8", fontSize: "15px" }}>
            Connecting to Instagram...
          </p>
          <div style={{
            width: "40px",
            height: "40px",
            border: "3px solid rgba(255, 255, 255, 0.1)",
            borderTop: "3px solid #B388FF",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }} />
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (page === "login" || !username) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      <Navigation
        currentPage={page}
        setPage={setPage}
        username={username}
        onLogout={handleLogout}
        isSyncing={isSyncing}
        syncStats={syncStats}
      />
      <main className="main-content">
        {page === "library" && (
          <Library
            isSyncing={isSyncing}
            setIsSyncing={setIsSyncing}
            setSyncStats={setSyncStats}
          />
        )}
        {page === "queue" && <Queue />}
        {page === "history" && <History />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
