import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface AppConfig {
  download_dir: string;
  download_quality: string;
  concurrency_limit: number;
  include_date: boolean;
  include_media_type: boolean;
  include_media_id: boolean;
  theme: string;
  accent_color: string;
  window_width: number;
  window_height: number;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig>({
    download_dir: "",
    download_quality: "best",
    concurrency_limit: 3,
    include_date: true,
    include_media_type: true,
    include_media_id: true,
    theme: "dark",
    accent_color: "#7C4DFF",
    window_width: 1000,
    window_height: 700,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadConfig = async () => {
    try {
      const cfg: any = await invoke("get_config");
      setConfig(cfg);
    } catch (e) {
      console.error(e);
      setError("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handlePickDirectory = async () => {
    try {
      const folder: any = await invoke("select_directory");
      if (folder) {
        setConfig((prev) => ({ ...prev, download_dir: folder }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage("");
    setError("");

    try {
      await invoke("save_settings", { settings: config });
      setMessage("Settings saved successfully!");
      setTimeout(() => setMessage(""), 3000);
    } catch (e: any) {
      setError(e || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <h3>Loading configurations...</h3>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Application Settings</h2>
          <p style={{ color: "#9E9AA8", fontSize: "14px", marginTop: "4px" }}>
            Configure downloads and appearance preferences
          </p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: "12px 16px",
          background: "rgba(0, 230, 118, 0.1)",
          border: "1px solid rgba(0, 230, 118, 0.2)",
          borderRadius: "10px",
          color: "var(--color-secondary)",
          fontSize: "14px",
          fontWeight: "600"
        }}>
          ✅ {message}
        </div>
      )}

      {error && (
        <div style={{
          padding: "12px 16px",
          background: "rgba(255, 23, 68, 0.1)",
          border: "1px solid rgba(255, 23, 68, 0.2)",
          borderRadius: "10px",
          color: "var(--color-error)",
          fontSize: "14px",
          fontWeight: "600"
        }}>
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSave} className="glass-panel" style={{
        padding: "32px",
        borderRadius: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        maxWidth: "680px"
      }}>
        {/* Download Location */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
            DOWNLOAD DESTINATION FOLDER
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              readOnly
              value={config.download_dir}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "14px",
                outline: "none"
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePickDirectory}
            >
              Browse...
            </button>
          </div>
        </div>

        {/* Concurrency & Quality */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px"
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
              CONCURRENT THREADS LIMIT
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.concurrency_limit}
              onChange={(e) => setConfig((prev) => ({ ...prev, concurrency_limit: parseInt(e.target.value) || 3 }))}
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "14px",
                outline: "none"
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
              DOWNLOAD QUALITY
            </label>
            <select
              value={config.download_quality}
              onChange={(e) => setConfig((prev) => ({ ...prev, download_quality: e.target.value }))}
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "#120E22",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "14px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="best">Best Quality</option>
              <option value="1080p">1080p Video</option>
              <option value="720p">720p Video</option>
              <option value="audio">Audio Only</option>
            </select>
          </div>
        </div>

        {/* Filename Toggles */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
            FILENAME FORMAT BUILDER
          </label>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { key: "include_date", label: "Include Date Created (YYYY-MM-DD)" },
              { key: "include_media_type", label: "Include Media Type Tag (REEL, POST, etc.)" },
              { key: "include_media_id", label: "Include Media Unique ID Code" }
            ].map((toggle) => (
              <div key={toggle.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  id={toggle.key}
                  checked={(config as any)[toggle.key]}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [toggle.key]: e.target.checked }))}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor={toggle.key} style={{ fontSize: "13px", color: "var(--color-text-primary)", cursor: "pointer" }}>
                  {toggle.label}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Theme Settings */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px"
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
              THEME MODE
            </label>
            <select
              value={config.theme}
              onChange={(e) => setConfig((prev) => ({ ...prev, theme: e.target.value }))}
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "#120E22",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "14px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="dark">Dark Theme</option>
              <option value="light">Light Theme</option>
              <option value="system">System Theme</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: "600", color: "#B388FF" }}>
              THEME ACCENT COLOR
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <input
                type="color"
                value={config.accent_color}
                onChange={(e) => setConfig((prev) => ({ ...prev, accent_color: e.target.value }))}
                style={{
                  width: "44px",
                  height: "44px",
                  border: "none",
                  borderRadius: "8px",
                  background: "none",
                  cursor: "pointer"
                }}
              />
              <span style={{ fontSize: "14px", fontWeight: "600", fontFamily: "monospace" }}>
                {config.accent_color.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSaving}
          style={{
            alignSelf: "flex-end",
            padding: "12px 28px",
            fontSize: "15px",
            marginTop: "12px"
          }}
        >
          {isSaving ? "Saving Settings..." : "Save Configuration"}
        </button>
      </form>
    </div>
  );
}
