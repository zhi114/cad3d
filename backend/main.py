"""
CAD3D 后端服务 — DXF 文件上传与解析 API。

管线：
  上传 DXF → 保存文件 → ezdxf 解析 → 返回结构化几何数据
"""

from __future__ import annotations

import os
import uuid

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from dxf_parser import parse_dxf_file

# ---------------------------------------------------------------------------
# 应用初始化
# ---------------------------------------------------------------------------

app = FastAPI(title="CAD3D API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 允许的最大文件大小 (50MB)
MAX_UPLOAD_SIZE = 50 * 1024 * 1024


# ---------------------------------------------------------------------------
# API 端点
# ---------------------------------------------------------------------------


@app.post("/api/upload")
async def upload_and_parse(file: UploadFile = File(...)):
    """
    上传 DXF 文件并返回解析后的几何数据。

    返回格式:
      {
        "file_id": "uuid",
        "data": {
          "walls": [{"points": [[x,y],...], "height": 3.0, "layer": "WALL"}],
          "doors": [{"position": [x,y], "width": 0.9, "height": 2.1, "rotation": 0.0, "layer": "DOOR"}],
          "windows": [{"position": [x,y], "width": 1.2, "height": 1.0, "rotation": 0.0, "layer": "WINDOW"}],
          "antennas": [{"position": [x,y], "layer": "ANTENNA"}]
        }
      }
    """
    if not file.filename or not file.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="仅支持 .dxf 格式的文件")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过 50MB 限制")

    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}.dxf")

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        data = parse_dxf_file(file_path)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"DXF 文件解析失败: {str(exc)}",
        ) from exc

    return {"file_id": file_id, "data": data}


@app.get("/api/health")
async def health_check():
    """健康检查端点。"""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
