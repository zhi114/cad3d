/**
 * DXF 文件上传组件。
 *
 * 支持拖拽上传和点击选择，仅接受 .dxf 格式。
 */

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";

interface FileUploadProps {
  readonly onFileSelect: (file: File) => void;
  readonly disabled?: boolean;
}

const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  maxWidth: 480,
  minHeight: 240,
  margin: "0 auto",
  padding: "40px 24px",
  border: "2px dashed #bbb",
  borderRadius: 12,
  backgroundColor: "#fafafa",
  cursor: "pointer",
  transition: "border-color 0.2s, background-color 0.2s",
  textAlign: "center",
};

const dragOverStyle: React.CSSProperties = {
  borderColor: "#4a90d9",
  backgroundColor: "#e8f0fe",
};

const iconStyle: React.CSSProperties = {
  fontSize: 48,
  marginBottom: 16,
  opacity: 0.6,
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 8,
  color: "#333",
};

const hintStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#888",
};

export function FileUpload({ onFileSelect, disabled }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (file.name.toLowerCase().endsWith(".dxf")) {
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const onClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // 重置以便重复选择同一文件
      e.target.value = "";
    },
    [handleFile],
  );

  return (
    <div
      style={{
        ...dropZoneStyle,
        ...(isDragOver ? dragOverStyle : {}),
        ...(disabled ? { opacity: 0.5, pointerEvents: "none" } : {}),
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <div style={iconStyle}>
        {isDragOver ? "📂" : "📁"}
      </div>
      <div style={titleStyle}>
        {isDragOver ? "释放以上传文件" : "上传 DXF 文件"}
      </div>
      <div style={hintStyle}>
        拖拽 .dxf 文件到此处，或点击选择文件
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        style={{ display: "none" }}
        onChange={onInputChange}
      />
    </div>
  );
}
