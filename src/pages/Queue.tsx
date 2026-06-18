import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

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
          <p style={{ color: "#9E9AA8", fontSize: "14px", marginTop: "4px" }}>
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
            style={{ color: "var(--color-error)", borderColor: "rgba(255, 23, 68, 0.2)" }}
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
          { label: "Pending", count: pendingCount, color: "#9E9AA8" },
          { label: "Downloading", count: downloadingCount, color: "var(--color-primary)" },
          { label: "Completed", count: completedCount, color: "var(--color-secondary)" },
          { label: "Failed", count: failedCount, color: "var(--color-error)" }
        ].map((stat) => (
          <div
            key={stat.label}
            className="glass-panel"
            style={{
              padding: "16px 20px",
              borderRadius: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#9E9AA8" }}>
              {stat.label.toUpperCase()}
            </span>
            <span style={{ fontSize: "24px", fontWeight: "800", color: stat.color }}>
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
          color: "#9E9AA8"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px" }}>📥</span>
          <h3>Queue is empty</h3>
          <p style={{ fontSize: "14px", marginTop: "4px" }}>
            Add media items from the Library to start downloading.
          </p>
        </div>
      ) : (
        <div className="glass-panel" style={{
          borderRadius: "16px",
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
                    borderBottom: index < queue.length - 1 ? "1px solid var(--color-border)" : "none",
                    background: item.status === "DOWNLOADING" ? "rgba(124, 77, 255, 0.04)" : "none"
                  }}
                >
                  <img
                    src={item.thumbnail_url || ""}
                    alt=""
                    style={{
                      width: "40px",
                      height: "60px",
                      borderRadius: "6px",
                      objectFit: "cover",
                      backgroundColor: "#000"
                    }}
                  />

                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: "600", fontSize: "14px" }}>@{item.username}</span>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "9px",
                        fontWeight: "700",
                        background: "rgba(255,255,255,0.05)",
                        color: "var(--color-text-muted)"
                      }}>
                        {item.media_type}
                      </span>
                    </div>
                    
                    {item.status === "DOWNLOADING" && progress !== undefined ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                        <div style={{
                          height: "4px",
                          width: "100%",
                          background: "rgba(255,255,255,0.05)",
                          borderRadius: "2px",
                          overflow: "hidden"
                        }}>
                          <div style={{
                            height: "100%",
                            width: `${progress}%`,
                            background: "var(--color-primary)",
                            transition: "width 0.1s"
                          }} />
                        </div>
                        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          Downloading: {progress.toFixed(1)}%
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                        Added {new Date(item.added_at).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: "700",
                      background: item.status === "COMPLETED" ? "rgba(0, 230, 118, 0.1)" : item.status === "FAILED" ? "rgba(255, 23, 68, 0.1)" : item.status === "DOWNLOADING" ? "rgba(124, 77, 255, 0.1)" : "rgba(255,255,255,0.05)",
                      color: item.status === "COMPLETED" ? "var(--color-secondary)" : item.status === "FAILED" ? "var(--color-error)" : item.status === "DOWNLOADING" ? "var(--color-primary)" : "var(--color-text-muted)"
                    }}>
                      {item.status}
                    </span>

                    <button
                      onClick={() => handleRemove(item.media_id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#9E9AA8",
                        cursor: "pointer",
                        padding: "6px",
                        borderRadius: "6px",
                        transition: "all 0.2s"
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
          color: var(--color-error) !important;
          background: rgba(255, 23, 68, 0.1);
        }
      `}</style>
    </div>
  );
}
