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
        <h3 style={{ color: "var(--md-sys-color-text-secondary)" }}>Loading configurations...</h3>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Application Settings</h2>
          <p style={{ color: "var(--md-sys-color-text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Configure downloads and appearance preferences
          </p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: "14px 20px",
          background: "rgba(0, 230, 118, 0.08)",
          border: "1px solid rgba(0, 230, 118, 0.15)",
          borderRadius: "14px",
          color: "var(--md-sys-color-secondary)",
          fontSize: "14px",
          fontWeight: "600",
          maxWidth: "680px"
        }}>
          ✅ {message}
        </div>
      )}

      {error && (
        <div style={{
          padding: "14px 20px",
          background: "rgba(242, 184, 181, 0.08)",
          border: "1px solid rgba(242, 184, 181, 0.15)",
          borderRadius: "14px",
          color: "var(--md-sys-color-error)",
          fontSize: "14px",
          fontWeight: "600",
          maxWidth: "680px"
        }}>
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSave} style={{
        padding: "36px",
        borderRadius: "24px",
        backgroundColor: "var(--md-sys-color-surface-container)",
        border: "1px solid var(--md-sys-color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "28px",
        maxWidth: "680px"
      }}>
        {/* Download Location */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
            DOWNLOAD DESTINATION FOLDER
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              type="text"
              readOnly
              value={config.download_dir}
              style={{
                flex: 1,
                padding: "12px 18px",
                borderRadius: "12px",
                background: "var(--md-sys-color-background)",
                border: "1px solid var(--md-sys-color-border)",
                color: "var(--md-sys-color-text-primary)",
                fontSize: "14px",
                outline: "none"
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePickDirectory}
              style={{ padding: "0 24px" }}
            >
              Browse...
            </button>
          </div>
        </div>

        {/* Concurrency & Quality */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px"
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
              CONCURRENT THREADS LIMIT
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.concurrency_limit}
              onChange={(e) => setConfig((prev) => ({ ...prev, concurrency_limit: parseInt(e.target.value) || 3 }))}
              style={{
                padding: "12px 18px",
                borderRadius: "12px",
                background: "var(--md-sys-color-background)",
                border: "1px solid var(--md-sys-color-border)",
                color: "var(--md-sys-color-text-primary)",
                fontSize: "14px",
                outline: "none"
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
              DOWNLOAD QUALITY
            </label>
            <select
              value={config.download_quality}
              onChange={(e) => setConfig((prev) => ({ ...prev, download_quality: e.target.value }))}
              style={{
                padding: "12px 18px",
                borderRadius: "12px",
                background: "var(--md-sys-color-background)",
                border: "1px solid var(--md-sys-color-border)",
                color: "var(--md-sys-color-text-primary)",
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
          <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
            FILENAME FORMAT BUILDER
          </label>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { key: "include_date", label: "Include Date Created (YYYY-MM-DD)" },
              { key: "include_media_type", label: "Include Media Type Tag (REEL, POST, etc.)" },
              { key: "include_media_id", label: "Include Media Unique ID Code" }
            ].map((toggle) => (
              <div key={toggle.key} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  id={toggle.key}
                  checked={(config as any)[toggle.key]}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [toggle.key]: e.target.checked }))}
                  style={{
                    cursor: "pointer",
                    width: "16px",
                    height: "16px",
                    accentColor: "var(--md-sys-color-primary)"
                  }}
                />
                <label htmlFor={toggle.key} style={{ fontSize: "14px", color: "var(--md-sys-color-text-primary)", cursor: "pointer" }}>
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
          gap: "24px"
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
              THEME MODE
            </label>
            <select
              value={config.theme}
              onChange={(e) => setConfig((prev) => ({ ...prev, theme: e.target.value }))}
              style={{
                padding: "12px 18px",
                borderRadius: "12px",
                background: "var(--md-sys-color-background)",
                border: "1px solid var(--md-sys-color-border)",
                color: "var(--md-sys-color-text-primary)",
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
            <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--md-sys-color-primary)", letterSpacing: "0.5px" }}>
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
                  borderRadius: "100px",
                  background: "none",
                  cursor: "pointer"
                }}
              />
              <span style={{ fontSize: "14px", fontWeight: "600", fontFamily: "monospace", color: "var(--md-sys-color-text-primary)" }}>
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
            padding: "12px 32px",
            fontSize: "15px",
            marginTop: "16px"
          }}
        >
          {isSaving ? "Saving Settings..." : "Save Configuration"}
        </button>
      </form>
    </div>
  );
}
