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
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStats, setSyncStats] = useState<{ scraped_count: number; new_count: number }>({
    scraped_count: 0,
    new_count: 0,
  });

  useEffect(() => {
    // Startup check: retrieve remembered username
    invoke("get_remembered_username")
      .then((user: any) => {
        if (user) {
          setUsername(user);
          setPage("library");
        } else {
          setPage("login");
        }
      })
      .catch(() => {
        setPage("login");
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
