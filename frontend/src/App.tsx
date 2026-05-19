/**
 * 应用根组件。
 *
 * 状态机：idle → loading → ready | error
 * - idle: 显示上传界面
 * - loading: 上传中，显示加载动画
 * - ready: 显示 3D 场景
 * - error: 显示错误信息，可重试
 */

import { useCallback, useState } from "react";
import type { AppState } from "./types";
import { uploadDXF } from "./services/api";
import { FileUpload } from "./components/FileUpload";
import { Scene3D } from "./components/Scene3D";

const rootStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 24px",
  backgroundColor: "#1a1a2e",
  color: "#fff",
  flexShrink: 0,
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "0.5px",
};

const headerActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 16px",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 6,
  backgroundColor: "transparent",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  transition: "background-color 0.2s",
};

const centerPanelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#f5f5f5",
};

const loadingStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#666",
  fontSize: 16,
};

const errorStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#c0392b",
  maxWidth: 400,
};

export default function App() {
  const [state, setState] = useState<AppState>({ phase: "idle" });

  const handleFileSelect = useCallback(async (file: File) => {
    setState({ phase: "loading" });
    try {
      const data = await uploadDXF(file);
      setState({ phase: "ready", data });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "文件上传或解析失败，请重试";
      setState({ phase: "error", message });
    }
  }, []);

  const handleReset = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  return (
    <div style={rootStyle}>
      {/* 顶部导航栏 */}
      <header style={headerStyle}>
        <span style={headerTitleStyle}>CAD3D — DXF 3D 可视化</span>
        <div style={headerActionsStyle}>
          {state.phase === "ready" && (
            <button
              style={buttonStyle}
              onClick={handleReset}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  "rgba(255,255,255,0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              重新上传
            </button>
          )}
        </div>
      </header>

      {/* 主内容区域 */}
      <div style={{ flex: 1, position: "relative" }}>
        {state.phase === "idle" && (
          <div style={centerPanelStyle}>
            <FileUpload onFileSelect={handleFileSelect} />
          </div>
        )}

        {state.phase === "loading" && (
          <div style={centerPanelStyle}>
            <div style={loadingStyle}>
              <p>正在解析 DXF 文件...</p>
              <div
                style={{
                  marginTop: 16,
                  width: 40,
                  height: 40,
                  border: "4px solid #ddd",
                  borderTopColor: "#4a90d9",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "16px auto 0",
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          </div>
        )}

        {state.phase === "ready" && (
          <Scene3D key={Date.now()} data={state.data} />
        )}

        {state.phase === "error" && (
          <div style={centerPanelStyle}>
            <div style={errorStyle}>
              <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                解析失败
              </p>
              <p style={{ fontSize: 14, opacity: 0.8 }}>{state.message}</p>
              <button
                style={{
                  ...buttonStyle,
                  marginTop: 20,
                  backgroundColor: "#c0392b",
                  border: "none",
                  color: "#fff",
                  padding: "8px 24px",
                }}
                onClick={handleReset}
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
