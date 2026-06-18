import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

interface LoginProps {
  onLoginSuccess: (username: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Verification Modal State
  const [showVerification, setShowVerification] = useState(false);
  const [verificationType, setVerificationType] = useState(""); // 2FA or CHALLENGE
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    // Listen for verification requests from the backend
    const unlisten = listen("verification-required", (event: any) => {
      const { type } = event.payload;
      setVerificationType(type);
      setShowVerification(true);
      setIsLoading(false);
    });

    // Load last remembered username
    invoke("get_remembered_username")
      .then((user: any) => {
        if (user) {
          setUsername(user);
        }
      })
      .catch(console.error);

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) {
      setError("Username is required");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const res: any = await invoke("login", {
        username,
        password: password || null,
        rememberMe,
      });

      if (res.status === "success") {
        onLoginSuccess(username);
      } else {
        setError(res.message || "Login failed");
      }
    } catch (err: any) {
      setError(err || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) return;

    setIsVerifying(true);
    setError("");

    try {
      await invoke("submit_otp", { code: verificationCode });
      setShowVerification(false);
      setVerificationCode("");
      setIsLoading(true); // Show spinner again as original login completes
    } catch (err: any) {
      setError(err || "OTP submission failed");
      setShowVerification(false);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      backgroundImage: "radial-gradient(circle at center, #1E124A 0%, #080512 100%)"
    }}>
      <div className="glass-panel" style={{
        width: "380px",
        padding: "40px",
        borderRadius: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.4)"
      }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{
            fontSize: "32px",
            fontWeight: "800",
            letterSpacing: "-0.5px",
            background: "linear-gradient(135deg, white 0%, #B388FF 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>ReelRipper</h1>
          <p style={{ color: "#9E9AA8", fontSize: "14px", marginTop: "4px" }}>
            Instagram Media Downloader
          </p>
        </div>

        {error && (
          <div style={{
            padding: "12px 16px",
            background: "rgba(255, 23, 68, 0.1)",
            border: "1px solid rgba(255, 23, 68, 0.2)",
            borderRadius: "10px",
            color: "#FF1744",
            fontSize: "13px",
            fontWeight: "500",
            lineHeight: "1.4"
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "#B388FF" }}>
              INSTAGRAM USERNAME
            </label>
            <input
              type="text"
              placeholder="e.g. instagram_user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "15px",
                outline: "none",
                transition: "all 0.2s"
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "600", color: "#B388FF" }}>
              PASSWORD (LEAVE BLANK IF REMEMBERED)
            </label>
            <input
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--color-border)",
                color: "white",
                fontSize: "15px",
                outline: "none",
                transition: "all 0.2s"
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              id="remember"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={isLoading}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="remember" style={{ fontSize: "13px", color: "#9E9AA8", cursor: "pointer" }}>
              Remember credentials & session
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading}
            style={{
              justifyContent: "center",
              padding: "14px",
              marginTop: "8px",
              fontSize: "15px"
            }}
          >
            {isLoading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>

      {/* Verification OTP Modal Overlay */}
      {showVerification && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel" style={{ width: "360px" }}>
            <div style={{ textAlign: "center" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "700" }}>Security Verification</h3>
              <p style={{ color: "#9E9AA8", fontSize: "13px", marginTop: "4px" }}>
                Instagram requested a verification code
              </p>
            </div>

            <div className="verification-badge">
              {verificationType === "2FA" 
                ? "Please enter the 2FA code from your authenticator app or SMS."
                : "Please enter the OTP verification code sent to your email/SMS."}
            </div>

            <form onSubmit={handleVerifySubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input
                type="text"
                maxLength={8}
                placeholder="Enter 6-digit code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                disabled={isVerifying}
                autoFocus
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid var(--color-border)",
                  color: "white",
                  fontSize: "18px",
                  textAlign: "center",
                  letterSpacing: "4px",
                  fontWeight: "700",
                  outline: "none"
                }}
              />

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowVerification(false);
                    setError("Verification cancelled.");
                  }}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isVerifying}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {isVerifying ? "Verifying..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
