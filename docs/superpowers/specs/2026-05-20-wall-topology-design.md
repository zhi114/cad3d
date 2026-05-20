# CAD3D 墙体拓扑分析设计

**日期**: 2026-05-20  
**状态**: 已确认，待实现

---

## 问题

- 不区分闭合轮廓与开放线段 → 封闭 LWPOLYLINE 被逐段拆成 Box
- 不能自动合并一组 LINE 为整体墙面 → 碎片化墙体
- 辅助线/多余线段被当成墙段 → 噪音几何体
- 接缝、重叠、厚度不符合实际墙面宽度 → L角/T角处理缺失

## 优先级

A（闭合轮廓识别）→ B（线段合并）→ D（墙角斜接）→ C（辅助线过滤）

---

## 架构方案

分两路处理：

1. **闭合轮廓** → `ExtrudeGeometry` 直接挤出实心体
2. **开放中心线** → 顶点拓扑图 → 合并共线边 → 斜接计算 → `ExtrudeGeometry` 挤出

辅助线通过拓扑分析标记孤立线段。

---

## 管线

```
DXF 文件
  → backend/dxf_parser.py: 新增 closed: bool 字段
  → JSON
  → frontend/src/utils/normalizeDXFData: 现有居中+缩放
  → frontend/src/utils/wallProcessor.ts **新文件**: 拓扑分析
     ├─ 分离闭合轮廓 vs 开放线段
     ├─ 顶点图构建 + 合并共线边
     ├─ 接头分析 (L/T/端点)
     ├─ 斜接计算
     └─ 辅助线标签
  → frontend/src/utils/meshBuilder.ts: 改造
     ├─ buildClosedWallMesh → ExtrudeGeometry
     ├─ buildMiteredWallMesh → ExtrudeGeometry (斜切Shape)
     ├─ buildDoorMesh (现有)
     ├─ buildWindowMesh (现有)
     └─ buildAntennaMesh (现有)
  → Scene3D.tsx + Toolbar.tsx: 厚度滑块、辅助线过滤开关
```

---

## 第一部分：后端闭合检测

`dxf_parser.py` — `WallSegment` 新增 `closed: bool`:

- 检测: `len(points) >= 3` 且首尾点欧氏距离 < 0.01 单位 → `closed: true`
- 序列化: `{"closed": w.closed}` 加入每个 wall 对象

后端不做处理区分，仅打标签。

---

## 第二部分：闭合轮廓挤出

`meshBuilder.ts` 新增 `buildClosedWallMeshParams`:

- 输入: `WallData` (closed: true)
- 将 `points` 转为 `THREE.Shape` (XZ 平面)
- `ExtrudeGeometry(shape, { steps: 1, depth: wall.height })`
- 输出: 单个 mesh params (非逐段 Box 数组)
- 退化: 点数 < 3 → 降级为开放中心线处理

---

## 第三部分：拓扑图与线段合并

`wallProcessor.ts` (新文件):

### 数据结构

```ts
interface WallGraph {
  vertices: Map<string, Point2D>;
  edges: Map<string, WallEdge>;
  adjacency: Map<string, Set<string>>;
}

interface WallEdge {
  id: string;
  startKey: string;
  endKey: string;
  points: Point2D[];
  height: number;
  layer: string;
}
```

### 处理管线

1. 收集所有 `closed: false` 的墙体段
2. 坐标哈希化 (舍入到 0.001)，匹配端点
3. 构建顶点邻接图
4. 合并共线连通边: 度=2 的顶点上，两条边方向夹角 < 1° → 合并
5. 输出 `MergedWallEdge[]`

---

## 第四部分：墙角斜接处理

### 接头类型

- **L 角** (度=2, 夹角 1°~179°): 两条墙延伸斜切配合
- **T 角** (度=3): 搭接墙截断到被搭接墙侧边
- **端点** (度=1): 直切，可选端帽

### L 角斜接算法

1. 取两条边方向向量 (从顶点向外)
2. 沿方向各偏移 ±halfThickness 得到内外侧线
3. 计算内侧线交点 → 斜接点
4. 若斜接距离 > 2×墙厚 (钝角) → 退化为直切

### 输出

```ts
interface MiteredWallSegment {
  start: Point2D;
  end: Point2D;
  startCutAngle: number;
  endCutAngle: number;
  height: number;
}
```

Mesh 构建: `ExtrudeGeometry` 挤出 `Shape` (梯形或直切端点)。

---

## 第五部分：辅助线过滤

### 标签策略

| 标签 | 条件 | 默认行为 |
|------|------|----------|
| 可靠墙 | 度 ≥ 1 | 渲染 |
| 孤立线 | 度 = 0 | 半透明 |
| 超长线 | 长度 > 对角线×0.8 且度=0 | 隐藏 |
| 短线碎片 | 长度 < 0.05m 且度=0 | 隐藏 |

### Toolbar UI

- "显示辅助线" 开关 (默认关闭)
- "墙体厚度" 滑块 (默认 0.2m, 范围 0.05–0.5m)
- "重置视角" 按钮

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/dxf_parser.py` | 修改: WallSegment.closed, 序列化 |
| `frontend/src/types/index.ts` | 修改: WallData.closed, 中间类型 |
| `frontend/src/utils/wallProcessor.ts` | **新建**: 拓扑分析核心 |
| `frontend/src/utils/meshBuilder.ts` | 修改: 新增 ExtrudeGeometry 路径 |
| `frontend/src/components/Scene3D.tsx` | 修改: 集成新管线 + Toolbar |
| `frontend/src/components/Toolbar.tsx` | **新建**: 工具栏组件 |

---

## 实现顺序

1. 后端 `closed` 字段 → 验证 → 提交
2. meshBuilder 闭合轮廓挤出 → 验证 → 提交
3. wallProcessor 拓扑图 + 合并 → 验证 → 提交
4. wallProcessor 斜接计算 → 验证 → 提交
5. 辅助线标签 + Toolbar UI → 验证 → 提交

每步独立可验证。
