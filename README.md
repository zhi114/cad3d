# CAD3D — DXF 文件 3D 可视化系统

根据用户上传的 DXF 二维平面图，自动过滤墙体/门/窗/天线图层，生成对应的 3D 模型并在浏览器中展示。

## 项目架构

```
cad3d/
├── backend/                  # Python 后端
│   ├── main.py               # FastAPI 应用入口
│   ├── dxf_parser.py         # DXF 解析器（ezdxf）
│   ├── requirements.txt      # Python 依赖
│   └── uploads/              # 上传文件存储目录（自动创建）
├── frontend/                 # React 前端
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx          # 入口
│       ├── App.tsx           # 根组件（状态机：idle/loading/ready/error）
│       ├── components/
│       │   ├── FileUpload.tsx # 拖拽上传组件
│       │   └── Scene3D.tsx   # Three.js 3D 场景
│       ├── services/
│       │   └── api.ts        # API 请求封装
│       ├── types/
│       │   └── index.ts      # TypeScript 类型定义
│       └── utils/
│           └── meshBuilder.ts # 几何体构建工具
└── README.md
```

## 数据流

```
用户浏览器                   后端服务器
    │                          │
    ├── 上传 .dxf 文件 ────────►│
    │                          ├── 保存到 uploads/
    │                          ├── ezdxf 解析 DXF
    │                          ├── 按图层名过滤（WALL/DOOR/WINDOW/ANTENNA）
    │                          ├── 提取几何数据
    │         返回 JSON ───────┤
    │                          │
    ├── meshBuilder 构建几何体  │
    ├── Three.js 渲染 3D 场景  │
```

## 解析规则

- 仅处理图层名称包含以下关键字的图层（大小写不敏感）：
  - **WALL** → 墙体（默认高度 3m，厚度 0.2m）
  - **DOOR** → 门（默认宽 0.9m，高 2.1m，深度 0.1m）
  - **WINDOW** → 窗（默认宽 1.2m，高 1.0m，离地 1.0m，深度 0.1m）
  - **ANTENNA** → 天线（标记为红色圆柱）
- 支持实体类型：LINE、LWPOLYLINE、POLYLINE、ARC、CIRCLE、INSERT、POINT
- 圆弧和圆会被采样为折线段

## 3D 坐标映射

| DXF 轴 | Three.js 轴 | 说明 |
|--------|-------------|------|
| X      | X           | 水平方向 |
| Y      | Z           | 深度方向 |
| —      | Y           | 高度方向（墙体挤出方向） |

## 快速启动

### 环境要求

- **Python** >= 3.10
- **Node.js** >= 18
- **npm** >= 9

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate   # Windows

# 安装依赖
pip install -r requirements.txt

# 启动服务（默认 http://127.0.0.1:8000）
python main.py
```

### 2. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:3000）
npm run dev
```

### 3. 使用

1. 浏览器打开 `http://localhost:3000`
2. 拖拽或点击选择 `.dxf` 文件上传
3. 等待解析完成后，自动展示 3D 模型
4. 鼠标拖拽旋转视角，滚轮缩放，右键平移

## 环境变量

本项目无需额外环境变量。如需修改端口或后端地址：

- 后端端口：修改 `backend/main.py` 中 `uvicorn.run(app, host="0.0.0.0", port=8000)` 的 `port` 参数
- 前端开发服务器端口：修改 `frontend/vite.config.ts` 中 `server.port`
- API 代理目标：修改 `frontend/vite.config.ts` 中 `server.proxy` 的 `target`

## 生产构建

```bash
# 构建前端静态文件
cd frontend
npm run build

# 产物在 frontend/dist/ 目录
# 可部署到任意静态文件服务器，并反向代理 /api 到后端
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 3D 渲染 | Three.js + @react-three/fiber + @react-three/drei |
| HTTP 请求 | Axios |
| 后端框架 | FastAPI |
| DXF 解析 | ezdxf |
| 服务运行 | Uvicorn |
