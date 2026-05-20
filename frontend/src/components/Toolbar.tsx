import type { FC } from "react";

interface ToolbarProps {
  wallThickness: number;
  onWallThicknessChange: (value: number) => void;
  showAuxiliary: boolean;
  onShowAuxiliaryChange: (show: boolean) => void;
  onResetView: () => void;
  auxiliaryCount: number;
}

export const Toolbar: FC<ToolbarProps> = ({
  wallThickness,
  onWallThicknessChange,
  showAuxiliary,
  onShowAuxiliaryChange,
  onResetView,
  auxiliaryCount,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 16,
        alignItems: "center",
        background: "rgba(30, 30, 30, 0.9)",
        padding: "8px 16px",
        borderRadius: 8,
        color: "#ccc",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        zIndex: 10,
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        墙厚
        <input
          type="range"
          min={0.05}
          max={0.5}
          step={0.01}
          value={wallThickness}
          onChange={(e) => onWallThicknessChange(Number(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ minWidth: 36 }}>{wallThickness.toFixed(2)}m</span>
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          opacity: auxiliaryCount > 0 ? 1 : 0.4,
        }}
      >
        <input
          type="checkbox"
          checked={showAuxiliary}
          onChange={(e) => onShowAuxiliaryChange(e.target.checked)}
          disabled={auxiliaryCount === 0}
        />
        <span>
          辅助线
          {auxiliaryCount > 0 && (
            <span style={{ marginLeft: 4, color: "#e67e22" }}>
              ({auxiliaryCount})
            </span>
          )}
        </span>
      </label>

      <button
        onClick={onResetView}
        style={{
          background: "#444",
          color: "#ddd",
          border: "none",
          borderRadius: 4,
          padding: "4px 10px",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        重置视角
      </button>
    </div>
  );
};
