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
    <div className="sidebar">
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
            padding: "14px",
            background: "var(--md-sys-color-surface-container)",
            border: "1px solid var(--md-sys-color-border-subtle)",
            borderRadius: "16px",
            marginBottom: "16px",
            fontSize: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", color: "var(--md-sys-color-text-primary)" }}>
              <span style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                backgroundColor: "var(--md-sys-color-primary)",
                borderRadius: "50%",
                boxShadow: "0 0 8px var(--md-sys-color-primary)"
              }}></span>
              Syncing Instagram...
            </div>
            <div style={{ color: "var(--md-sys-color-text-secondary)" }}>
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
