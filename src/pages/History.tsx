import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/shell";

interface HistoryItem {
  id: number;
  media_id: string;
  filename: string;
  filepath: string;
  file_size: number | null;
  status: string;
  error_message: string | null;
  downloaded_at: string;
  username: string;
  media_type: string;
  thumbnail_url: string | null;
}

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const fetchHistory = async () => {
    try {
      const data: any = await invoke("get_downloads_history");
      setHistory(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleClearHistory = async () => {
    try {
      await invoke("clear_download_history");
      fetchHistory();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteRecord = async (id: number) => {
    try {
      await invoke("delete_download_record", { id });
      fetchHistory();
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFile = async (path: string) => {
    if (!path) return;
    try {
      await open(path);
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "0.0 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Download History</h2>
          <p style={{ color: "var(--md-sys-color-text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {history.length} completed logs
          </p>
        </div>

        {history.length > 0 && (
          <button className="btn btn-secondary" onClick={handleClearHistory} style={{ color: "var(--md-sys-color-error)", borderColor: "rgba(242, 184, 181, 0.2)" }}>
            🗑️ Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          color: "var(--md-sys-color-text-secondary)"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px" }}>📜</span>
          <h3>No downloads logged</h3>
          <p style={{ fontSize: "14px", marginTop: "4px" }}>
            Completed queue downloads will appear here.
          </p>
        </div>
      ) : (
        <div style={{
          borderRadius: "24px",
          border: "1px solid var(--md-sys-color-border-subtle)",
          backgroundColor: "var(--md-sys-color-surface)",
          overflow: "hidden"
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: "70vh",
            overflowY: "auto"
          }}>
            {history.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  padding: "16px 20px",
                  borderBottom: index < history.length - 1 ? "1px solid var(--md-sys-color-border-subtle)" : "none"
                }}
              >
                <img
                  src={item.thumbnail_url || ""}
                  alt=""
                  style={{
                    width: "40px",
                    height: "60px",
                    borderRadius: "8px",
                    objectFit: "cover",
                    backgroundColor: "#000"
                  }}
                />

                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: "600", fontSize: "14px", color: "var(--md-sys-color-text-primary)" }}>@{item.username}</span>
                    <span style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "9px",
                      fontWeight: "700",
                      background: "var(--md-sys-color-surface-container)",
                      color: "var(--md-sys-color-text-secondary)"
                    }}>
                      {item.media_type}
                    </span>
                  </div>
                  
                  <div style={{
                    fontSize: "12px",
                    color: "var(--md-sys-color-text-secondary)",
                    marginTop: "4px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "380px"
                  }} title={item.filepath}>
                    File: {item.filename || "Failed download"}
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--md-sys-color-text-secondary)", opacity: 0.7, marginTop: "2px" }}>
                    Finished {new Date(item.downloaded_at).toLocaleString()} • {formatSize(item.file_size)}
                  </div>

                  {item.error_message && (
                    <div style={{
                      fontSize: "11px",
                      color: "var(--md-sys-color-error)",
                      marginTop: "6px",
                      padding: "4px 8px",
                      background: "rgba(242, 184, 181, 0.05)",
                      borderRadius: "4px",
                      display: "inline-block"
                    }}>
                      Error: {item.error_message}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    padding: "6px 12px",
                    borderRadius: "100px",
                    fontSize: "11px",
                    fontWeight: "700",
                    background: item.status === "COMPLETED" ? "rgba(0, 230, 118, 0.1)" : "rgba(255, 23, 68, 0.1)",
                    color: item.status === "COMPLETED" ? "var(--md-sys-color-secondary)" : "var(--md-sys-color-error)"
                  }}>
                    {item.status}
                  </span>

                  {item.status === "COMPLETED" && item.filepath && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleOpenFile(item.filepath)}
                      style={{ padding: "8px 16px", fontSize: "12px" }}
                    >
                      ▶️ Play
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteRecord(item.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--md-sys-color-text-secondary)",
                      cursor: "pointer",
                      padding: "6px",
                      borderRadius: "100px",
                      transition: "all 0.15s"
                    }}
                    className="trash-btn"
                    title="Delete record"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .trash-btn:hover {
          color: var(--md-sys-color-error) !important;
          background-color: rgba(242, 184, 181, 0.15);
        }
      `}</style>
    </div>
  );
}
