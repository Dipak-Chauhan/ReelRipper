import { invoke } from "@tauri-apps/api/tauri";

interface NavigationProps {
  currentPage: string;
  setPage: (page: string) => void;
  username: string;
  onLogout: () => void;
  isSyncing: boolean;
  syncStats: { scraped_count: number; new_count: number };
}

export default function Navigation({
  currentPage,
  setPage,
  username,
  onLogout,
  isSyncing,
  syncStats,
}: NavigationProps) {
  const handleLogout = async () => {
    try {
      await invoke("logout", { username });
      onLogout();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="sidebar glass-panel">
      <div>
        <div className="logo-section">
          <div className="logo-icon">R</div>
          <div className="logo-text">ReelRipper</div>
        </div>
        
        <div className="nav-links">
          <div
            className={`nav-item ${currentPage === "library" ? "active" : ""}`}
            onClick={() => setPage("library")}
          >
            <span>📚</span> Library
          </div>
          <div
            className={`nav-item ${currentPage === "queue" ? "active" : ""}`}
            onClick={() => setPage("queue")}
          >
            <span>📥</span> Queue
          </div>
          <div
            className={`nav-item ${currentPage === "history" ? "active" : ""}`}
            onClick={() => setPage("history")}
          >
            <span>📜</span> History
          </div>
          <div
            className={`nav-item ${currentPage === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <span>⚙️</span> Settings
          </div>
        </div>
      </div>

      <div>
        {isSyncing && (
          <div style={{
            padding: "12px",
            background: "rgba(124, 77, 255, 0.1)",
            border: "1px solid rgba(124, 77, 255, 0.2)",
            borderRadius: "10px",
            marginBottom: "16px",
            fontSize: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600" }}>
              <span style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                backgroundColor: "#7C4DFF",
                borderRadius: "50%",
                animation: "pulse 1.5s infinite"
              }}></span>
              Syncing Instagram...
            </div>
            <div style={{ color: "#9E9AA8" }}>
              Scraped: {syncStats.scraped_count} ({syncStats.new_count} new)
            </div>
          </div>
        )}

        <div className="user-section">
          <div className="avatar">
            {username.substring(0, 2).toUpperCase()}
          </div>
          <div className="user-info">
            <div className="username">@{username}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Logout">
            <span>🚪</span>
          </button>
        </div>
      </div>
    </div>
  );
}
