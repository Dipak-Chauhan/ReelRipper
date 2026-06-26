import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/shell";

interface QueueItem {
  id: number;
  media_id: string;
  priority: number;
  status: string;
  retry_count: number;
  added_at: string;
  username: string;
  media_type: string;
  taken_at: string;
  thumbnail_url: string | null;
  video_url: string | null;
  resources_json: string | null;
  filepath: string | null;
}

export default function Queue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  
  const fetchQueue = async () => {
    try {
      const data: any = await invoke("get_queue_items");
      setQueue(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchConfig = async () => {
    try {
      const cfg: any = await invoke("get_config");
      setIsPaused(cfg.is_paused || false);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchQueue();
    fetchConfig();

    // Listen to progress updates
    const unlistenProgress = listen("download-progress", (event: any) => {
      const { media_id, progress } = event.payload;
      setProgressMap((prev) => ({ ...prev, [media_id]: progress }));
    });

    // Listen to status updates
    const unlistenStatus = listen("download-status", (event: any) => {
      const { media_id, status } = event.payload;
      setQueue((prev) =>
        prev.map((item) => (item.media_id === media_id ? { ...item, status } : item))
      );
      if (status === "COMPLETED" || status === "FAILED" || status === "SKIPPED") {
        fetchQueue(); // Reload to refresh sorting/history status
      }
    });

    // Listen to global queue status changes
    const unlistenStats = listen("queue-stats-updated", (event: any) => {
      const { is_paused } = event.payload;
      setIsPaused(is_paused);
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenStatus.then((f) => f());
      unlistenStats.then((f) => f());
    };
  }, []);

  const handlePauseToggle = async () => {
    try {
      if (isPaused) {
        await invoke("resume_queue");
        setIsPaused(false);
      } else {
        await invoke("pause_queue");
        setIsPaused(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemove = async (mediaId: string) => {
    try {
      await invoke("remove_from_queue", { mediaId });
      fetchQueue();
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFile = async (path: string | null | undefined) => {
    if (!path) return;
    try {
      await open(path);
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await invoke("clear_completed_queue");
      fetchQueue();
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAll = async () => {
    try {
      await invoke("clear_entire_queue");
      fetchQueue();
    } catch (e) {
      console.error(e);
    }
  };

  const pendingCount = queue.filter((i) => i.status === "PENDING").length;
  const downloadingCount = queue.filter((i) => i.status === "DOWNLOADING").length;
  const completedCount = queue.filter((i) => i.status === "COMPLETED").length;
  const failedCount = queue.filter((i) => i.status === "FAILED").length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Download Queue</h2>
          <p style={{ color: "var(--md-sys-color-text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {queue.length} items total in queue
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            className={`btn ${isPaused ? "btn-primary" : "btn-secondary"}`}
            onClick={handlePauseToggle}
          >
            {isPaused ? "▶️ Resume Queue" : "⏸️ Pause Queue"}
          </button>
          <button className="btn btn-secondary" onClick={handleClearCompleted}>
            🧹 Clear Finished
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleClearAll}
            style={{ color: "var(--md-sys-color-error)", borderColor: "rgba(242, 184, 181, 0.2)" }}
          >
            🗑️ Clear All
          </button>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "16px",
        marginBottom: "8px"
      }}>
        {[
          { label: "Pending", count: pendingCount, color: "var(--md-sys-color-text-secondary)" },
          { label: "Downloading", count: downloadingCount, color: "var(--md-sys-color-primary)" },
          { label: "Completed", count: completedCount, color: "var(--md-sys-color-secondary)" },
          { label: "Failed", count: failedCount, color: "var(--md-sys-color-error)" }
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: "16px 20px",
              borderRadius: "16px",
              backgroundColor: "var(--md-sys-color-surface-container)",
              border: "1px solid var(--md-sys-color-border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}
          >
            <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--md-sys-color-text-secondary)" }}>
              {stat.label.toUpperCase()}
            </span>
            <span style={{ fontSize: "24px", fontWeight: "700", color: stat.color }}>
              {stat.count}
            </span>
          </div>
        ))}
      </div>

      {/* Queue items list */}
      {queue.length === 0 ? (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          color: "var(--md-sys-color-text-secondary)"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px" }}>📥</span>
          <h3>Queue is empty</h3>
          <p style={{ fontSize: "14px", marginTop: "4px" }}>
            Add media items from the Library to start downloading.
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
            maxHeight: "60vh",
            overflowY: "auto"
          }}>
            {queue.map((item, index) => {
              const progress = progressMap[item.media_id];
              return (
                <div
                  key={item.media_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "16px 20px",
                    borderBottom: index < queue.length - 1 ? "1px solid var(--md-sys-color-border-subtle)" : "none",
                    background: item.status === "DOWNLOADING" ? "rgba(208, 188, 255, 0.05)" : "none"
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
                    
                    {item.status === "DOWNLOADING" && progress !== undefined ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                        <div style={{
                          height: "4px",
                          width: "100%",
                          background: "var(--md-sys-color-surface-container)",
                          borderRadius: "2px",
                          overflow: "hidden"
                        }}>
                          <div style={{
                            height: "100%",
                            width: `${progress}%`,
                            background: "var(--md-sys-color-primary)",
                            transition: "width 0.1s"
                          }} />
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--md-sys-color-text-secondary)" }}>
                          Downloading: {progress.toFixed(1)}%
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "var(--md-sys-color-text-secondary)", marginTop: "4px" }}>
                        Added {new Date(item.added_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{
                      padding: "6px 12px",
                      borderRadius: "100px",
                      fontSize: "11px",
                      fontWeight: "700",
                      background: item.status === "COMPLETED" ? "rgba(0, 230, 118, 0.1)" : item.status === "FAILED" ? "rgba(255, 23, 68, 0.1)" : item.status === "DOWNLOADING" ? "var(--md-sys-color-primary-container)" : "var(--md-sys-color-surface-container)",
                      color: item.status === "COMPLETED" ? "var(--md-sys-color-secondary)" : item.status === "FAILED" ? "var(--md-sys-color-error)" : item.status === "DOWNLOADING" ? "var(--md-sys-color-primary)" : "var(--md-sys-color-text-secondary)"
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
                      onClick={() => handleRemove(item.media_id)}
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
                      title="Remove from queue"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
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
