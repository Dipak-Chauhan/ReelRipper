import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

interface MediaItem {
  media_id: string;
  media_type: string;
  username: string;
  full_name: string | null;
  taken_at: string;
  caption: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  resources_json: string | null;
  scraped_at: string;
}

interface LibraryProps {
  isSyncing: boolean;
  setIsSyncing: (s: boolean) => void;
  setSyncStats: (stats: { scraped_count: number; new_count: number }) => void;
}

export default function Library({ isSyncing, setIsSyncing, setSyncStats }: LibraryProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadStatus, setDownloadStatus] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState("");

  const fetchItems = async () => {
    try {
      const data: any = await invoke("get_library_items");
      setItems(data);
    } catch (e) {
      console.error("Failed to load library items:", e);
    }
  };

  useEffect(() => {
    fetchItems();

    // Listen to download progress
    const unlistenProgress = listen("download-progress", (event: any) => {
      const { media_id, progress } = event.payload;
      setDownloadProgress((prev) => ({ ...prev, [media_id]: progress }));
    });

    // Listen to download status changes
    const unlistenStatus = listen("download-status", (event: any) => {
      const { media_id, status } = event.payload;
      setDownloadStatus((prev) => ({ ...prev, [media_id]: status }));
      if (status === "COMPLETED" || status === "FAILED") {
        // Remove progress overlay when finished
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[media_id];
          return next;
          return next;
        });
      }
    });

    // Listen to sync status
    const unlistenSync = listen("sync-status", (event: any) => {
      const { status, scraped_count, new_count, message } = event.payload;
      if (status === "STARTED") {
        setIsSyncing(true);
        setSyncStats({ scraped_count: 0, new_count: 0 });
      } else if (status === "PROGRESS") {
        setIsSyncing(true);
        setSyncStats({ scraped_count, new_count });
      } else if (status === "FINISHED") {
        setIsSyncing(false);
        showToast(`Sync complete! Added ${new_count} new items.`);
        fetchItems();
      } else if (status === "ERROR") {
        setIsSyncing(false);
        showToast(`Sync failed: ${message}`);
      }
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenStatus.then((f) => f());
      unlistenSync.then((f) => f());
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  const handleSync = async () => {
    if (isSyncing) return;
    try {
      await invoke("trigger_sync");
    } catch (e: any) {
      showToast(`Sync failed: ${e}`);
    }
  };

  const handleQueueDownload = async (mediaId: string) => {
    try {
      const res: any = await invoke("add_to_queue", { mediaId, priority: 0 });
      if (res.new_item) {
        showToast("Added to download queue");
      } else {
        showToast("Priority updated in queue");
      }
      setDownloadStatus((prev) => ({ ...prev, [mediaId]: "PENDING" }));
    } catch (e: any) {
      showToast(`Error queuing download: ${e}`);
    }
  };

  const filteredItems = items.filter((item) => {
    if (filter === "ALL") return true;
    if (filter === "REELS") return item.media_type === "REEL" || item.media_type === "IGTV";
    if (filter === "POSTS") return item.media_type === "POST";
    if (filter === "CAROUSELS") return item.media_type === "CAROUSEL";
    return true;
  });

  const handleQueueAll = async () => {
    if (filteredItems.length === 0) return;
    const mediaIds = filteredItems.map((item) => item.media_id);
    try {
      await invoke("add_all_to_queue", { mediaIds });
      showToast(`Queued all ${mediaIds.length} items`);
      setDownloadStatus((prev) => {
        const next = { ...prev };
        mediaIds.forEach((id) => {
          next[id] = "PENDING";
        });
        return next;
      });
    } catch (e: any) {
      showToast(`Error: ${e}`);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Saved Media Library</h2>
          <p style={{ color: "var(--md-sys-color-text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {items.length} items cached total
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          {filteredItems.length > 0 && (
            <button className="btn btn-secondary" onClick={handleQueueAll}>
              ⚡ Queue Filtered ({filteredItems.length})
            </button>
          )}
          <button
            className={`btn btn-primary ${isSyncing ? "disabled" : ""}`}
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? "🔄 Syncing..." : "🔄 Sync Saved Items"}
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div style={{ display: "flex", gap: "10px" }}>
        {["ALL", "REELS", "POSTS", "CAROUSELS"].map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: "8px 20px",
              borderRadius: "100px",
              fontSize: "13px",
              fontWeight: "600",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s ease-in-out",
              background: filter === type ? "var(--md-sys-color-primary-container)" : "var(--md-sys-color-surface-container)",
              color: filter === type ? "var(--md-sys-color-on-primary-container)" : "var(--md-sys-color-text-secondary)"
            }}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Grid of Cards */}
      {filteredItems.length === 0 ? (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          color: "var(--md-sys-color-text-secondary)"
        }}>
          <span style={{ fontSize: "48px", marginBottom: "16px" }}>📁</span>
          <h3>No media cached</h3>
          <p style={{ fontSize: "14px", marginTop: "4px" }}>
            Click "Sync Saved Items" to scrape your saved collections.
          </p>
        </div>
      ) : (
        <div className="media-grid">
          {filteredItems.map((item) => {
            const progress = downloadProgress[item.media_id as string];
            const status = downloadStatus[item.media_id as string];
            
            return (
              <div key={item.media_id as string} className="media-card">
                <div className="media-thumbnail-container">
                  <img
                    src={item.thumbnail_url as string || ""}
                    alt=""
                    className="media-thumbnail"
                    loading="lazy"
                  />
                  
                  {/* Badges */}
                  <div className="media-badge">
                    {item.media_type === "REEL" ? "🎬" : item.media_type === "CAROUSEL" ? "📷 Album" : "📷"}
                  </div>

                  {status && (
                    <div style={{
                      position: "absolute",
                      top: "12px",
                      left: "12px",
                      padding: "6px 12px",
                      borderRadius: "100px",
                      fontSize: "11px",
                      fontWeight: "700",
                      background: status === "COMPLETED" ? "rgba(0, 230, 118, 0.95)" : status === "FAILED" ? "rgba(255, 23, 68, 0.95)" : "var(--md-sys-color-primary-container)",
                      color: status === "COMPLETED" ? "#000" : "#fff"
                    }}>
                      {status}
                    </div>
                  )}

                  {/* Progress overlay */}
                  {progress !== undefined && (
                    <div className="media-download-overlay">
                      <div
                        className="media-download-progress"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Hover Actions */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(17, 18, 22, 0.6)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: 0,
                    transition: "opacity 0.25s cubic-bezier(0.2, 0, 0, 1)",
                    cursor: "pointer"
                  }}
                  className="hover-overlay"
                  onClick={() => handleQueueDownload(item.media_id as string)}
                  >
                    <button className="btn btn-primary" style={{ padding: "10px 20px" }}>
                      📥 Download
                    </button>
                  </div>
                </div>

                <div className="media-metadata">
                  <div className="media-user">@{item.username}</div>
                  <div className="media-caption">
                    {item.caption || "No caption"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "32px",
          right: "32px",
          padding: "16px 24px",
          borderRadius: "16px",
          background: "var(--md-sys-color-surface-container)",
          border: "1px solid var(--md-sys-color-border)",
          color: "var(--md-sys-color-text-primary)",
          fontSize: "14px",
          fontWeight: "600",
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
          zIndex: 9999,
          animation: "modalSlide 0.25s cubic-bezier(0.2, 0, 0, 1)"
        }}>
          💡 {toastMessage}
        </div>
      )}

      {/* Hover overlay CSS selector style */}
      <style>{`
        .media-thumbnail-container:hover .hover-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
