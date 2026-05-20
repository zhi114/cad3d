# 墙体拓扑分析实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现闭合轮廓检测、中心线拓扑合并、墙角斜接、辅助线过滤

**Architecture:** 后端只做闭合检测标签，前端 wallProcessor.ts 做拓扑分析和斜接计算，meshBuilder.ts 针对闭合轮廓和斜接墙段分别用 ExtrudeGeometry 挤出

**Tech Stack:** Python 3 + ezdxf (后端), TypeScript + React + Three.js/@react-three/fiber (前端)

---

### Task 1: 后端 — WallSegment 增加 closed 字段

**Files:**
- Modify: `backend/dxf_parser.py:41-47` (WallSegment dataclass)
- Modify: `backend/dxf_parser.py:265-274` (_handle_wall_entity)
- Modify: `backend/dxf_parser.py:406-410` (序列化)

- [ ] **Step 1: WallSegment 添加 closed 字段**

```python
# backend/dxf_parser.py, 在 DEFAULT_WINDOW_ELEVATION 之后添加常量
CLOSED_THRESHOLD = 0.01  # 闭合轮廓首尾点容差（CAD 单位）
```

```python
# backend/dxf_parser.py, WallSegment dataclass 改为:
@dataclass
class WallSegment:
    """墙体几何数据。"""

    points: list[list[float]]  # [[x, y], ...] 二维顶点列表
    height: float = 3.0  # 默认墙体高度（米）
    layer: str = "WALL"
    closed: bool = False  # 是否为闭合多边形轮廓
```

- [ ] **Step 2: 添加闭合检测辅助函数**

```python
# backend/dxf_parser.py, 在 _compute_rotation_from_line 之后添加:

def _is_closed_polyline(points: list[list[float]], threshold: float = CLOSED_THRESHOLD) -> bool:
    """检测点链是否闭合：点数 ≥ 3 且首尾距离 ≤ 容差。"""
    if len(points) < 3:
        return False
    dx = points[0][0] - points[-1][0]
    dy = points[0][1] - points[-1][1]
    return (dx * dx + dy * dy) <= threshold * threshold
```

- [ ] **Step 3: _handle_wall_entity 传入 closed 检测结果**

```python
# backend/dxf_parser.py:268-274, 改为:
    walls.append(
        WallSegment(
            points=points,
            height=DEFAULT_WALL_HEIGHT,
            layer=_get_layer(entity),
            closed=_is_closed_polyline(points),
        )
    )
```

- [ ] **Step 4: 序列化添加 closed 字段**

```python
# backend/dxf_parser.py:407-410, 改为:
        "walls": [
            {"points": [{"x": p[0], "y": p[1]} for p in w.points], "height": w.height, "layer": w.layer, "closed": w.closed}
            for w in result.walls
        ],
```

- [ ] **Step 5: 验证后端语法正确**

```bash
cd /Users/liuzhi/Documents/workspace/cad3d/backend && python3 -c "import dxf_parser; print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git -C /Users/liuzhi/Documents/workspace/cad3d add backend/dxf_parser.py
git -C /Users/liuzhi/Documents/workspace/cad3d commit -m "feat: add closed field to WallSegment for contour detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 前端 — 类型定义 + 闭合轮廓 ExtrudeGeometry 挤出

**Files:**
- Modify: `frontend/src/types/index.ts:7-12` (WallData)
- Modify: `frontend/src/utils/meshBuilder.ts` (新增 buildClosedWallMeshParams)
- Modify: `frontend/src/components/Scene3D.tsx:33-47` (WallMeshes)

- [ ] **Step 1: WallData 类型增加 closed 字段**

```typescript
// frontend/src/types/index.ts, WallData 改为:
export interface WallData {
  readonly points: Point2D[];
  readonly height: number;
  readonly layer: string;
  readonly closed: boolean;
}
```

- [ ] **Step 2: meshBuilder.ts 添加 ExtrudeGeometry 相关 import**

```typescript
// frontend/src/utils/meshBuilder.ts, 在现有 import 之后添加:
import { ExtrudeGeometry, Shape } from "three";
```

- [ ] **Step 3: meshBuilder.ts 添加 buildClosedWallMeshParams 函数**

在 `buildWallMeshParams` 函数之前添加:

```typescript
export interface ClosedWallMeshParams {
  position: [number, number, number];
  geometry: THREE.ExtrudeGeometry;
  key: string;
}

/**
 * 为闭合轮廓墙体构建 ExtrudeGeometry。
 *
 * 管线: points[] → Shape (XZ平面) → ExtrudeGeometry (沿Y轴挤出)
 *
 * 每个闭合轮廓输出一个完整的挤实体，无接缝、无重叠。
 */
export function buildClosedWallMeshParams(walls: WallData[]): ClosedWallMeshParams[] {
  const result: ClosedWallMeshParams[] = [];

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    if (!wall.closed) continue;
    if (wall.points.length < 3) continue;

    // 构建 XZ 平面 Shape（忽略 Y，ExtrudeGeometry 会沿 Y 挤出）
    const shape = new Shape();
    const first = wall.points[0];
    if (!isFinitePoint(first)) continue;

    shape.moveTo(first.x, first.y);
    for (let i = 1; i < wall.points.length; i++) {
      const p = wall.points[i];
      if (!isFinitePoint(p)) continue;
      shape.lineTo(p.x, p.y);
    }
    shape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 1,
      depth: wall.height,
      bevelEnabled: false,
    };

    const geometry = new ExtrudeGeometry(shape, extrudeSettings);
    // ExtrudeGeometry 默认沿 Z 轴挤出，需要旋转使其沿 Y 轴
    geometry.rotateX(-Math.PI / 2);
    // 平移使底部对齐 Y=0 (ExtrudeGeometry 默认从 Z=0 开始，rotateX 后从 Y=0 开始)
    geometry.translate(0, 0, 0);

    result.push({
      key: `closed-wall-${wi}`,
      position: [0, 0, 0], // geometry 已包含绝对坐标，无需位移
      geometry,
    });
  }

  return result;
}
```

Wait — ExtrudeGeometry 使用绝对坐标挤出，position 设为 (0,0,0) 即可。因为 wall.points 已经在 normalizeDXFData 中居中并缩放了。

- [ ] **Step 4: 修改 buildWallMeshParams 跳过闭合轮廓**

```typescript
// buildWallMeshParams 函数开头添加过滤:
export function buildWallMeshParams(walls: WallData[]): WallMeshParams[] {
  const result: WallMeshParams[] = [];

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    // 闭合轮廓由 buildClosedWallMeshParams 处理
    if (wall.closed) continue;

    const pts = wall.points;
    // ... 其余不变
```

- [ ] **Step 5: Scene3D.tsx WallMeshes 组件改造**

```typescript
// Scene3D.tsx, 在现有 import 中添加:
import {
  buildWallMeshParams,
  buildClosedWallMeshParams,
  // ... 其余 import
} from "../utils/meshBuilder";

// WallMeshes 组件改为:
function WallMeshes({ data }: { data: ParsedDXFData }) {
  const closedWalls = useMemo(
    () => buildClosedWallMeshParams(data.walls),
    [data.walls],
  );
  const openWalls = useMemo(
    () => buildWallMeshParams(data.walls),
    [data.walls],
  );

  return (
    <group>
      {closedWalls.map((m) => (
        <mesh key={m.key} position={m.position} geometry={m.geometry}>
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
      {openWalls.map((m) => (
        <mesh key={m.key} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 6: TypeCheck 验证**

```bash
cd /Users/liuzhi/Documents/workspace/cad3d/frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git -C /Users/liuzhi/Documents/workspace/cad3d add frontend/src/types/index.ts frontend/src/utils/meshBuilder.ts frontend/src/components/Scene3D.tsx
git -C /Users/liuzhi/Documents/workspace/cad3d commit -m "feat: add closed contour extrusion via ExtrudeGeometry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: wallProcessor.ts — 拓扑图构建与共线合并

**Files:**
- Create: `frontend/src/utils/wallProcessor.ts`

- [ ] **Step 1: 创建 wallProcessor.ts — 数据结构**

```typescript
/**
 * 墙体拓扑分析器。
 *
 * 管线：
 *   开放墙体段 → 端点哈希 → 顶点邻接图 → 合并共线边 → 接头分析 → 斜接计算
 *
 * 坐标假设：输入的 WallData.points 已经过 normalizeDXFData 居中并缩放。
 */

import type { Point2D, WallData } from "../types";
import { isFinitePoint } from "./meshBuilder";  // 复用现有校验

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 端点匹配容差（米），两点距离 ≤ 此值视为同一点 */
const VERTEX_MERGE_TOLERANCE = 0.001;

/** 共线判定阈值（度），夹角 < 此值视为共线 */
const COLINEAR_ANGLE_DEG = 1.0;
const COLINEAR_COS_THRESHOLD = Math.cos(COLINEAR_ANGLE_DEG * Math.PI / 180);

/** 坐标哈希精度（小数位数），用于顶点去重 */
const HASH_PRECISION = 3;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface WallEdge {
  id: string;
  startKey: string;
  endKey: string;
  points: Point2D[];
  height: number;
  layer: string;
}

export interface WallGraph {
  vertices: Map<string, Point2D>;
  edges: Map<string, WallEdge>;
  /** vertex key → connected edge IDs */
  adjacency: Map<string, Set<string>>;
}
```

- [ ] **Step 2: 坐标哈希与顶点匹配**

```typescript
/** 将坐标舍入到指定精度，生成顶点 key */
function hashCoord(value: number): number {
  const factor = Math.pow(10, HASH_PRECISION);
  return Math.round(value * factor) / factor;
}

function vertexKey(p: Point2D): string {
  return `${hashCoord(p.x)},${hashCoord(p.y)}`;
}

/** 查找图中与给定点匹配的顶点 key，若无则返回 null */
function findMatchingVertex(
  p: Point2D,
  vertices: Map<string, Point2D>,
): string | null {
  // 先尝试精确 key 匹配
  const exact = vertexKey(p);
  if (vertices.has(exact)) return exact;

  // 扫描附近顶点（处理舍入边界情况）
  for (const [key, v] of vertices) {
    const dx = v.x - p.x;
    const dy = v.y - p.y;
    if (dx * dx + dy * dy <= VERTEX_MERGE_TOLERANCE * VERTEX_MERGE_TOLERANCE) {
      return key;
    }
  }
  return null;
}
```

- [ ] **Step 3: 构建拓扑图**

```typescript
/**
 * 从开放墙体段构建顶点邻接图。
 *
 * 每个开放线段 (points[i] → points[i+1]) 成为图中一条边，
 * 端点坐标哈希化后匹配已有顶点。
 */
export function buildWallGraph(walls: WallData[]): WallGraph {
  const vertices = new Map<string, Point2D>();
  const edges = new Map<string, WallEdge>();
  const adjacency = new Map<string, Set<string>>();
  let edgeIdCounter = 0;

  function ensureVertex(p: Point2D): string {
    const existing = findMatchingVertex(p, vertices);
    if (existing) return existing;
    const key = vertexKey(p);
    vertices.set(key, { x: p.x, y: p.y });
    adjacency.set(key, new Set());
    return key;
  }

  function addEdgeToAdjacency(edgeKey: string, vKey: string) {
    if (!adjacency.has(vKey)) adjacency.set(vKey, new Set());
    adjacency.get(vKey)!.add(edgeKey);
  }

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    if (wall.closed) continue;  // 闭合轮廓不参与拓扑图

    const pts = wall.points;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const sqLen = dx * dx + dy * dy;
      if (sqLen < 1e-8) continue;

      const startKey = ensureVertex(a);
      const endKey = ensureVertex(b);
      const edgeKey = `e${edgeIdCounter++}`;

      const edge: WallEdge = {
        id: edgeKey,
        startKey,
        endKey,
        points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        height: wall.height,
        layer: wall.layer,
      };

      edges.set(edgeKey, edge);
      addEdgeToAdjacency(edgeKey, startKey);
      addEdgeToAdjacency(edgeKey, endKey);
    }
  }

  return { vertices, edges, adjacency };
}
```

- [ ] **Step 4: 合并共线连通边**

```typescript
export interface MergedWallEdge {
  id: string;
  points: Point2D[];
  height: number;
  layer: string;
  /** 合并后点列首顶点 key */
  startKey: string;
  /** 合并后点列尾顶点 key */
  endKey: string;
  /** 与哪些原始 edge ID 关联 */
  sourceEdgeIds: string[];
}

/**
 * 在拓扑图中合并共线且度=2 的连通边。
 *
 * 对每个度=2 的顶点：
 * - 取出相连的两条边
 * - 计算两边的方向向量
 * - 若夹角 < 1° → 合并为一条边
 *
 * 返回合并后的边列表（可能仍包含未合并的单段边）。
 */
export function mergeColinearEdges(graph: WallGraph): MergedWallEdge[] {
  const { vertices, edges, adjacency } = graph;
  const merged = new Map<string, MergedWallEdge>();
  const edgeMerged = new Set<string>();  // 已被合并的 edge ID

  // 处理度=2 的顶点
  for (const [vKey, connectedEdges] of adjacency) {
    if (connectedEdges.size !== 2) continue;

    const [e1Id, e2Id] = [...connectedEdges];
    if (edgeMerged.has(e1Id) || edgeMerged.has(e2Id)) continue;

    const e1 = edges.get(e1Id)!;
    const e2 = edges.get(e2Id)!;

    // 计算在顶点处的方向向量（从顶点向外）
    const d1 = directionFromVertex(e1, vKey);
    const d2 = directionFromVertex(e2, vKey);
    if (d1 === null || d2 === null) continue;

    // 方向接近反向 → 共线（在同一直线上）
    const dot = d1.x * d2.x + d1.y * d2.y;
    const cosAngle = -dot;  // 反向 → 实际是共线
    if (cosAngle < COLINEAR_COS_THRESHOLD) continue;

    // 合并：构建新的有序点列
    const mergedPoints = buildMergedPoints(e1, e2, vKey);
    if (mergedPoints === null) continue;

    const mergedEdge: MergedWallEdge = {
      id: `merged-${e1Id}-${e2Id}`,
      points: mergedPoints,
      height: e1.height,
      layer: e1.layer,
      startKey: vertexKey(mergedPoints[0]),
      endKey: vertexKey(mergedPoints[mergedPoints.length - 1]),
      sourceEdgeIds: [e1Id, e2Id],
    };

    merged.set(mergedEdge.id, mergedEdge);
    edgeMerged.add(e1Id);
    edgeMerged.add(e2Id);
  }

  // 将未合并的边转换为 MergedWallEdge
  for (const [edgeId, edge] of edges) {
    if (edgeMerged.has(edgeId)) continue;
    merged.set(edgeId, {
      id: edgeId,
      points: edge.points,
      height: edge.height,
      layer: edge.layer,
      startKey: edge.startKey,
      endKey: edge.endKey,
      sourceEdgeIds: [edgeId],
    });
  }

  return [...merged.values()];
}

/** 计算边从指定顶点向外的方向向量 */
function directionFromVertex(
  edge: WallEdge,
  vertexKey: string,
): Point2D | null {
  const a = edge.points[0];
  const b = edge.points[edge.points.length - 1];
  if (edge.startKey === vertexKey) {
    return { x: b.x - a.x, y: b.y - a.y };
  } else if (edge.endKey === vertexKey) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  return null;
}

/** 将两条边在共享顶点处合并为有序点列 */
function buildMergedPoints(
  e1: WallEdge,
  e2: WallEdge,
  sharedKey: string,
): Point2D[] | null {
  const e1StartsAtShared = e1.startKey === sharedKey;
  const e2StartsAtShared = e2.startKey === sharedKey;

  // e1 从远点到共享点，e2 从共享点到远点 → 自然连接
  if (!e1StartsAtShared && e2StartsAtShared) {
    return [...e1.points, ...e2.points.slice(1)];
  }
  // e2 从远点到共享点，e1 从共享点到远点
  if (e1StartsAtShared && !e2StartsAtShared) {
    return [...e2.points, ...e1.points.slice(1)];
  }
  // 两者都从共享点出发 → 反转其中一个
  if (e1StartsAtShared && e2StartsAtShared) {
    return [...e1.points.slice().reverse(), ...e2.points.slice(1)];
  }
  // 两者都指向共享点 → 反转其中一个
  if (!e1StartsAtShared && !e2StartsAtShared) {
    return [...e1.points, ...e2.points.slice().reverse().slice(1)];
  }
  return null;
}
```

- [ ] **Step 5: TypeCheck 验证**

```bash
cd /Users/liuzhi/Documents/workspace/cad3d/frontend && npx tsc --noEmit
```
Expected: no errors — 注意 `isFinitePoint` 需要从 meshBuilder.ts 导出

需要确保 `meshBuilder.ts` 中 `isFinitePoint` 已导出:
```typescript
// meshBuilder.ts 中 isFinitePoint 改为:
export function isFinitePoint(p: Point2D): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/liuzhi/Documents/workspace/cad3d add frontend/src/utils/meshBuilder.ts frontend/src/utils/wallProcessor.ts
git -C /Users/liuzhi/Documents/workspace/cad3d commit -m "feat: add wall topology graph builder with colinear edge merging

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: wallProcessor.ts — 接头分析与墙角斜接

**Files:**
- Modify: `frontend/src/utils/wallProcessor.ts` (追加函数)

- [ ] **Step 1: 接头类型定义**

```typescript
// wallProcessor.ts 追加:

export type JunctionType = "endpoint" | "l-corner" | "t-junction";

export interface Junction {
  vertexKey: string;
  position: Point2D;
  type: JunctionType;
  connectedEdges: string[];  // edge IDs
}

export interface MiteredWallSegment {
  id: string;
  points: Point2D[];          // 原始中心线点列（已合并）
  startTrim: number;           // 起点截断距离（米），0 = 不截
  endTrim: number;             // 终点截断距离（米）
  height: number;
  layer: string;
  halfThickness: number;       // 墙体半厚
}
```

- [ ] **Step 2: 接头检测**

```typescript
/**
 * 分析合并后边的接头类型。
 *
 * 对每条边的每个端点查找图邻接关系：
 * - 度=1 → endpoint
 * - 度=2 (2条边在此相交) → l-corner
 * - 度≥3 → t-junction
 */
export function detectJunctions(
  merged: MergedWallEdge[],
  graph: WallGraph,
): Map<string, Junction> {
  const junctions = new Map<string, Junction>();
  const { vertices, adjacency } = graph;

  for (const edge of merged) {
    for (const vKey of [edge.startKey, edge.endKey]) {
      if (junctions.has(vKey)) continue;

      const connected = adjacency.get(vKey);
      const degree = connected ? connected.size : 0;

      let type: JunctionType;
      if (degree <= 1) {
        type = "endpoint";
      } else if (degree === 2) {
        type = "l-corner";
      } else {
        type = "t-junction";
      }

      junctions.set(vKey, {
        vertexKey: vKey,
        position: vertices.get(vKey) || { x: 0, y: 0 },
        type,
        connectedEdges: connected ? [...connected] : [],
      });
    }
  }

  return junctions;
}
```

- [ ] **Step 3: L 角斜接计算**

```typescript
/**
 * 为所有 L 角计算斜接截断距离。
 *
 * 算法:
 *   d1, d2 = 两条边在顶点处的方向向量（从顶点向外）
 *   innerMiter = halfThickness × (1 + cos(θ)) / sin(θ)
 *   其中 θ = d1 与 d2 的夹角
 *
 *   若 innerMiter > 2 × halfThickness（钝角）→ 退化为直切(trim = halfThickness)
 */
export function computeMiterTrims(
  merged: MergedWallEdge[],
  junctions: Map<string, Junction>,
  halfThickness: number,
): Map<string, { start: number; end: number }> {
  const trims = new Map<string, { start: number; end: number }>();

  for (const edge of merged) {
    // 找出此边两端顶点的接头信息
    const startJunction = junctions.get(edge.startKey);
    const endJunction = junctions.get(edge.endKey);

    let startTrim = 0;
    let endTrim = 0;

    // 端点：直切，trim = halfThickness
    if (startJunction?.type === "endpoint") {
      startTrim = halfThickness;
    } else if (startJunction?.type === "l-corner") {
      startTrim = computeLCornerTrim(edge, edge.startKey, merged, halfThickness);
    } else if (startJunction?.type === "t-junction") {
      startTrim = halfThickness;  // 搭接边截断
    }

    if (endJunction?.type === "endpoint") {
      endTrim = halfThickness;
    } else if (endJunction?.type === "l-corner") {
      endTrim = computeLCornerTrim(edge, edge.endKey, merged, halfThickness);
    } else if (endJunction?.type === "t-junction") {
      endTrim = halfThickness;
    }

    trims.set(edge.id, { start: startTrim, end: endTrim });
  }

  return trims;
}

function computeLCornerTrim(
  edge: MergedWallEdge,
  atVertexKey: string,
  allEdges: MergedWallEdge[],
  halfThickness: number,
): number {
  // 找到共享此顶点的另一条边
  const otherEdge = allEdges.find(
    (e) =>
      e.id !== edge.id &&
      (e.startKey === atVertexKey || e.endKey === atVertexKey),
  );
  if (!otherEdge) return halfThickness;

  const d1 = edgeDirectionAtVertex(edge, atVertexKey);
  const d2 = edgeDirectionAtVertex(otherEdge, atVertexKey);
  if (!d1 || !d2) return halfThickness;

  const dot = d1.x * d2.x + d1.y * d2.y;
  const sinAngle = d1.x * d2.y - d1.y * d2.x;  // 2D 叉积

  if (Math.abs(sinAngle) < 1e-6) {
    // 平行 → 不需要斜接
    return 0;
  }

  // innerMiter = halfThickness * (1 + cosθ) / |sinθ|
  const miterDist = halfThickness * (1 + dot) / Math.abs(sinAngle);

  // 限制最大斜接距离，避免钝角过度延伸
  return Math.min(miterDist, halfThickness * 3);
}

function edgeDirectionAtVertex(
  edge: MergedWallEdge,
  vertexKey: string,
): Point2D | null {
  const pts = edge.points;
  if (pts.length < 2) return null;

  // 判断该顶点是边的起点还是终点
  const firstKey = vertexKey(pts[0]);
  const lastKey = vertexKey(pts[pts.length - 1]);

  if (firstKey === vertexKey) {
    // 从第一个点到第二个点的方向
    return { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  }
  if (lastKey === vertexKey) {
    // 从最后一个点到倒数第二点的方向
    const len = pts.length;
    return { x: pts[len - 2].x - pts[len - 1].x, y: pts[len - 2].y - pts[len - 1].y };
  }
  return null;
}
```

- [ ] **Step 4: TypeCheck 验证**

```bash
cd /Users/liuzhi/Documents/workspace/cad3d/frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuzhi/Documents/workspace/cad3d add frontend/src/utils/wallProcessor.ts
git -C /Users/liuzhi/Documents/workspace/cad3d commit -m "feat: add junction detection and L-corner miter computation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 辅助线过滤 + Toolbar UI + 集成

**Files:**
- Modify: `frontend/src/utils/wallProcessor.ts` (追加辅助线标签)
- Modify: `frontend/src/utils/meshBuilder.ts` (追加 buildMiteredWallMeshParams)
- Create: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/components/Scene3D.tsx` (集成新管线 + Toolbar)

- [ ] **Step 1: wallProcessor.ts — 辅助线标签**

```typescript
// wallProcessor.ts 追加:

export enum EdgeLabel {
  /** 可靠墙：至少一端与其他边相连 */
  Reliable = "reliable",
  /** 孤立线：两端无连接 */
  Isolated = "isolated",
  /** 超长孤立线 */
  VeryLong = "veryLong",
  /** 短碎片 */
  ShortDebris = "shortDebris",
}

export interface LabeledEdge extends MergedWallEdge {
  label: EdgeLabel;
  degree: number;  // 两端连接数的最大值
}

export function labelEdges(
  merged: MergedWallEdge[],
  graph: WallGraph,
  modelDiagonal: number,
): LabeledEdge[] {
  const { adjacency } = graph;
  const shortThreshold = 0.05;  // 0.05m
  const longThreshold = modelDiagonal * 0.8;

  return merged.map((edge) => {
    const degreeStart = adjacency.get(edge.startKey)?.size ?? 0;
    const degreeEnd = adjacency.get(edge.endKey)?.size ?? 0;
    const maxDegree = Math.max(degreeStart, degreeEnd);
    const length = computeEdgeLength(edge.points);

    let label: EdgeLabel;
    if (maxDegree >= 1) {
      label = EdgeLabel.Reliable;
    } else if (length < shortThreshold) {
      label = EdgeLabel.ShortDebris;
    } else if (length > longThreshold) {
      label = EdgeLabel.VeryLong;
    } else {
      label = EdgeLabel.Isolated;
    }

    return { ...edge, label, degree: maxDegree };
  });
}

function computeEdgeLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}
```

- [ ] **Step 2: meshBuilder.ts — 斜接墙体挤出**

```typescript
// meshBuilder.ts 追加:

/**
 * 为斜接处理后的墙段构建 ExtrudeGeometry。
 *
 * 根据 startTrim/endTrim 截断中心线，
 * 用 Shape 表示梯形端面，沿 Y 轴挤出。
 */
export function buildMiteredWallMeshParams(
  segments: MiteredWallSegment[],
): WallMeshParams[] {
  const result: WallMeshParams[] = [];

  for (const seg of segments) {
    const pts = seg.points;
    if (pts.length < 2) continue;

    // 先计算原始总长度，再截断
    const trimmed = trimPoints(pts, seg.startTrim, seg.endTrim);
    if (trimmed.length < 2) continue;

    // 逐段构建 Box（简化：截断后的中心线仍用 BoxGeometry）
    // 斜切端面通过调整起止位置模拟
    for (let i = 0; i < trimmed.length - 1; i++) {
      const a = trimmed[i];
      const b = trimmed[i + 1];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const sqLen = dx * dx + dy * dy;
      if (sqLen < 1e-8) continue;

      const length = Math.sqrt(sqLen);
      const midX = (a.x + b.x) / 2;
      const midY = seg.height / 2;
      const midZ = (a.y + b.y) / 2;

      result.push({
        key: `mitered-${seg.id}-${i}`,
        position: to3D({ x: midX, y: midZ }, midY),
        quaternion: segmentQuaternion(dx, dy),
        size: [length, seg.height, seg.halfThickness * 2],
      });
    }
  }

  return result;
}

/** 截断点列：从起点移除 startTrim 距离，从终点移除 endTrim 距离 */
function trimPoints(
  pts: Point2D[],
  startTrim: number,
  endTrim: number,
): Point2D[] {
  if (startTrim <= 0 && endTrim <= 0) return pts;

  // 计算逐段累计长度
  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalLength += len;
  }

  if (startTrim + endTrim >= totalLength) return [];

  // 从起点截断
  let result = [...pts];
  if (startTrim > 0) {
    result = trimFromStart(result, segLengths, startTrim);
  }
  if (endTrim > 0) {
    const revLen: number[] = [];
    for (let i = result.length - 2; i >= 0; i--) {
      const dx = result[i + 1].x - result[i].x;
      const dy = result[i + 1].y - result[i].y;
      revLen.push(Math.sqrt(dx * dx + dy * dy));
    }
    result = trimFromStart([...result].reverse(), revLen, endTrim).reverse();
  }

  return result;
}

function trimFromStart(
  pts: Point2D[],
  lengths: number[],
  trim: number,
): Point2D[] {
  let remaining = trim;
  let cutIdx = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      cutIdx = i;
      break;
    }
    remaining -= lengths[i];
    cutIdx = i + 1;
  }

  if (cutIdx >= pts.length - 1) return [pts[pts.length - 1]];

  // 在 cutIdx → cutIdx+1 之间插值新起点
  const a = pts[cutIdx];
  const b = pts[cutIdx + 1];
  const segLen = lengths[cutIdx];
  const t = segLen > 0 ? remaining / segLen : 0;

  const newStart: Point2D = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };

  return [newStart, ...pts.slice(cutIdx + 1)];
}
```

需要从 wallProcessor.ts 导入 `MiteredWallSegment` 类型。

- [ ] **Step 3: Toolbar.tsx — 新文件**

```typescript
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
```

- [ ] **Step 4: Scene3D.tsx — 集成完整管线**

```typescript
// Scene3D.tsx, import 改为:
import { useMemo, useState, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import {
  buildWallMeshParams,
  buildClosedWallMeshParams,
  buildMiteredWallMeshParams,
  buildDoorMeshParams,
  buildWindowMeshParams,
  buildAntennaMeshParams,
  normalizeDXFData,
  ANTENNA_RADIUS,
  ANTENNA_HEIGHT,
} from "../utils/meshBuilder";
import {
  buildWallGraph,
  mergeColinearEdges,
  labelEdges,
  EdgeLabel,
} from "../utils/wallProcessor";
import type { LabeledEdge } from "../utils/wallProcessor";
import { Toolbar } from "./Toolbar";

// WallMeshes 组件重写为集成版本:
function WallMeshes({
  data,
  halfThickness,
  showAuxiliary,
}: {
  data: ParsedDXFData;
  halfThickness: number;
  showAuxiliary: boolean;
}) {
  // 闭合轮廓 → ExtrudeGeometry
  const closedWalls = useMemo(
    () => buildClosedWallMeshParams(data.walls),
    [data.walls],
  );

  // 开放墙体 → 拓扑分析 → 合并 → 斜接
  const { openMeshes, auxiliaryEdges } = useMemo(() => {
    const graph = buildWallGraph(data.walls);
    const merged = mergeColinearEdges(graph);
    const labeled = labelEdges(merged, graph, 50); // 默认对角线 50m

    // 分离可靠墙和辅助线
    const reliable = labeled.filter((e) => e.label === EdgeLabel.Reliable);
    const auxiliary = labeled.filter((e) => e.label !== EdgeLabel.Reliable);

    const openMeshes = buildWallMeshParams(
      reliable.map((e) => ({
        points: e.points,
        height: e.height,
        layer: e.layer,
        closed: false,
      })),
    );

    return { openMeshes, auxiliaryEdges: auxiliary };
  }, [data.walls]);

  // 辅助线 mesh（仅在开关打开时渲染）
  const auxMeshes = useMemo(() => {
    if (!showAuxiliary || auxiliaryEdges.length === 0) return [];
    return buildWallMeshParams(
      auxiliaryEdges.map((e) => ({
        points: e.points,
        height: e.height,
        layer: e.layer,
        closed: false,
      })),
    );
  }, [auxiliaryEdges, showAuxiliary]);

  return (
    <group>
      {/* 闭合轮廓 */}
      {closedWalls.map((m) => (
        <mesh key={m.key} position={m.position} geometry={m.geometry}>
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
      {/* 可靠开放墙 */}
      {openMeshes.map((m) => (
        <mesh key={m.key} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
      {/* 辅助线 — 橙色半透明 */}
      {auxMeshes.map((m) => (
        <mesh key={`aux-${m.key}`} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial
            color="#e67e22"
            roughness={0.6}
            transparent
            opacity={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}
```

更新 `BuildingModel` 接收 props：

```typescript
function BuildingModel({
  data,
  halfThickness,
  showAuxiliary,
}: {
  data: ParsedDXFData;
  halfThickness: number;
  showAuxiliary: boolean;
}) {
  return (
    <group>
      <WallMeshes
        data={data}
        halfThickness={halfThickness}
        showAuxiliary={showAuxiliary}
      />
      <DoorMeshes data={data} />
      <WindowMeshes data={data} />
      <AntennaMeshes data={data} />
    </group>
  );
}
```

Scene3D 主组件添加状态和 Toolbar：

```typescript
export function Scene3D({ data }: Scene3DProps) {
  const {
    data: normalizedData,
    bounds,
    unitScale,
  } = useMemo(() => normalizeDXFData(data), [data]);

  const [wallThickness, setWallThickness] = useState(0.2);
  const [showAuxiliary, setShowAuxiliary] = useState(false);

  // ... 诊断日志 useMemo (不变) ...

  // ... 模型大小计算 (不变) ...

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas ...>
        {/* 光照不变 */}
        <BuildingModel
          data={normalizedData}
          halfThickness={wallThickness / 2}
          showAuxiliary={showAuxiliary}
        />
        {/* Grid, OrbitControls 不变 */}
      </Canvas>
      <Toolbar
        wallThickness={wallThickness}
        onWallThicknessChange={setWallThickness}
        showAuxiliary={showAuxiliary}
        onShowAuxiliaryChange={setShowAuxiliary}
        onResetView={() => {
          // 通过 window 访问 camera controls 重置
          window.dispatchEvent(new CustomEvent("reset-camera"));
        }}
        auxiliaryCount={0}
      />
    </div>
  );
}
```

Canvas 外层需要包 div 以支持 overlay toolbar。

- [ ] **Step 5: TypeCheck**

```bash
cd /Users/liuzhi/Documents/workspace/cad3d/frontend && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git -C /Users/liuzhi/Documents/workspace/cad3d add frontend/src/utils/wallProcessor.ts frontend/src/utils/meshBuilder.ts frontend/src/components/Scene3D.tsx frontend/src/components/Toolbar.tsx
git -C /Users/liuzhi/Documents/workspace/cad3d commit -m "feat: add auxiliary line filtering, toolbar UI, and full pipeline integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git -C /Users/liuzhi/Documents/workspace/cad3d push
```
