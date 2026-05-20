/**
 * 墙体拓扑分析器。
 *
 * 管线：
 *   开放墙体段 → 端点哈希 → 顶点邻接图 → 合并共线边 → 接头分析 → 斜接计算
 *
 * 坐标假设：输入的 WallData.points 已经过 normalizeDXFData 居中并缩放。
 * 闭合轮廓（closed: true）不参与拓扑分析，直接由 buildClosedWallMeshParams 处理。
 */

import type { Point2D, WallData } from "../types";
import { isFinitePoint } from "./meshBuilder";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 端点匹配容差（米），两点距离 ≤ 此值视为同一点 */
const VERTEX_MERGE_TOLERANCE = 0.001;

/** 共线判定阈值（度），两条边夹角 < 此值视为共线可合并 */
const COLINEAR_ANGLE_DEG = 1.0;
const COLINEAR_COS_THRESHOLD = Math.cos(COLINEAR_ANGLE_DEG * Math.PI / 180);

/** 坐标哈希精度（小数位数），用于顶点去重 key */
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

export interface MergedWallEdge {
  id: string;
  points: Point2D[];
  height: number;
  layer: string;
  startKey: string;
  endKey: string;
  /** 与哪些原始 edge ID 关联 */
  sourceEdgeIds: string[];
}

// ---------------------------------------------------------------------------
// 坐标哈希
// ---------------------------------------------------------------------------

/** 将坐标舍入到指定精度，生成顶点 key */
function hashCoord(value: number): number {
  const factor = Math.pow(10, HASH_PRECISION);
  return Math.round(value * factor) / factor;
}

export function vertexKey(p: Point2D): string {
  return `${hashCoord(p.x)},${hashCoord(p.y)}`;
}

/** 在已有顶点集合中查找与给定点匹配的 key，若无则返回 null */
function findMatchingVertex(
  p: Point2D,
  vertices: Map<string, Point2D>,
): string | null {
  const exact = vertexKey(p);
  if (vertices.has(exact)) return exact;

  const tol2 = VERTEX_MERGE_TOLERANCE * VERTEX_MERGE_TOLERANCE;
  for (const [key, v] of vertices) {
    const dx = v.x - p.x;
    const dy = v.y - p.y;
    if (dx * dx + dy * dy <= tol2) {
      return key;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 拓扑图构建
// ---------------------------------------------------------------------------

/**
 * 从开放墙体段构建顶点邻接图。
 *
 * 每个开放线段（points[i] → points[i+1]）成为图中一条边，
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
    let adj = adjacency.get(vKey);
    if (!adj) {
      adj = new Set();
      adjacency.set(vKey, adj);
    }
    adj.add(edgeKey);
  }

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    if (wall.closed) continue;

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

// ---------------------------------------------------------------------------
// 共线边合并
// ---------------------------------------------------------------------------

/**
 * 在拓扑图中合并共线且度=2 的连通边。
 *
 * 对每个度=2 的顶点：
 * - 取出相连的两条边
 * - 计算两边的方向向量
 * - 若方向夹角 < 1° → 合并为一条连续的折线段
 *
 * 返回合并后的边列表（包含未合并的单段边）。
 */
export function mergeColinearEdges(graph: WallGraph): MergedWallEdge[] {
  const { edges, adjacency } = graph;
  const merged = new Map<string, MergedWallEdge>();
  const edgeMerged = new Set<string>();

  for (const [vKey, connected] of adjacency) {
    if (connected.size !== 2) continue;

    const [e1Id, e2Id] = [...connected];
    if (edgeMerged.has(e1Id) || edgeMerged.has(e2Id)) continue;

    const e1 = edges.get(e1Id)!;
    const e2 = edges.get(e2Id)!;

    const d1 = directionFromVertex(e1, vKey);
    const d2 = directionFromVertex(e2, vKey);
    if (d1 === null || d2 === null) continue;

    // 方向接近反向视为共线（在同一直线上，从 v 向两侧延伸）
    const dot = d1.x * d2.x + d1.y * d2.y;
    const cosAngle = -dot;
    if (cosAngle < COLINEAR_COS_THRESHOLD) continue;

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

  // 未合并的边原样转为 MergedWallEdge
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

// ---------------------------------------------------------------------------
// 方向计算与点列合并
// ---------------------------------------------------------------------------

/** 计算边从指定顶点向外的方向向量 */
function directionFromVertex(
  edge: WallEdge,
  atVertexKey: string,
): Point2D | null {
  const a = edge.points[0];
  const b = edge.points[edge.points.length - 1];
  if (edge.startKey === atVertexKey) {
    return { x: b.x - a.x, y: b.y - a.y };
  }
  if (edge.endKey === atVertexKey) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  return null;
}

/** 将两条边在共享顶点处拼接为有序点列 */
function buildMergedPoints(
  e1: WallEdge,
  e2: WallEdge,
  sharedKey: string,
): Point2D[] | null {
  const e1StartsAtShared = e1.startKey === sharedKey;
  const e2StartsAtShared = e2.startKey === sharedKey;

  // e1 尾部连到 shared，e2 从 shared 出发 → 自然拼接
  if (!e1StartsAtShared && e2StartsAtShared) {
    return [...e1.points, ...e2.points.slice(1)];
  }
  // e2 尾部连到 shared，e1 从 shared 出发 → 反向拼接
  if (e1StartsAtShared && !e2StartsAtShared) {
    return [...e2.points, ...e1.points.slice(1)];
  }
  // 两者都从 shared 出发 → 反转 e1
  if (e1StartsAtShared && e2StartsAtShared) {
    return [...e1.points.slice().reverse(), ...e2.points.slice(1)];
  }
  // 两者都指向 shared → 反转 e2
  if (!e1StartsAtShared && !e2StartsAtShared) {
    return [...e1.points, ...e2.points.slice().reverse().slice(1)];
  }
  return null;
}

// ---------------------------------------------------------------------------
// 接头分析
// ---------------------------------------------------------------------------

export type JunctionType = "endpoint" | "l-corner" | "t-junction";

export interface Junction {
  vertexKey: string;
  position: Point2D;
  type: JunctionType;
  connectedEdges: string[];
}

/**
 * 分析合并后每条边端点的接头类型。
 *
 * 查找每边的 start/end 顶点在图中的邻接信息：
 * - 度 ≤ 1 → endpoint
 * - 度 = 2 → l-corner
 * - 度 ≥ 3 → t-junction
 */
export function detectJunctions(
  merged: MergedWallEdge[],
  graph: WallGraph,
): Map<string, Junction> {
  const junctions = new Map<string, Junction>();
  const { vertices, adjacency } = graph;

  // 收集合并边涉及的所有原始 edge IDs
  const allEdgeIds = new Set<string>();
  for (const edge of merged) {
    for (const id of edge.sourceEdgeIds) {
      allEdgeIds.add(id);
    }
  }

  const processed = new Set<string>();

  for (const edge of merged) {
    for (const vKey of [edge.startKey, edge.endKey]) {
      if (processed.has(vKey)) continue;
      processed.add(vKey);

      const vertex = vertices.get(vKey);
      if (!vertex) continue;

      const connected = adjacency.get(vKey);
      const relevantEdges = new Set<string>();
      if (connected) {
        for (const eId of connected) {
          if (allEdgeIds.has(eId)) {
            relevantEdges.add(eId);
          }
        }
      }
      const degree = relevantEdges.size;

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
        position: { x: vertex.x, y: vertex.y },
        type,
        connectedEdges: [...relevantEdges],
      });
    }
  }

  return junctions;
}

// ---------------------------------------------------------------------------
// 斜接计算
// ---------------------------------------------------------------------------

export interface MiteredWallSegment {
  id: string;
  points: Point2D[];
  startTrim: number;
  endTrim: number;
  height: number;
  layer: string;
  halfThickness: number;
}

/**
 * 为所有接头计算斜接截断距离。
 *
 * L 角算法：
 *   d1, d2 = 两条边在顶点处的方向向量（从顶点向外）
 *   cosθ = d1·d2, sinθ = |d1×d2|
 *   miterDist = halfThickness × (1 + cosθ) / sinθ
 *
 *   若 miterDist > halfThickness × 3 → 退化为直切。
 *
 * 端点和 T 角：直切，trim = halfThickness。
 *
 * 返回值: Map<edge.id, {startTrim, endTrim}>
 */
export function computeMiterTrims(
  merged: MergedWallEdge[],
  junctions: Map<string, Junction>,
  halfThickness: number,
): Map<string, { start: number; end: number }> {
  const trims = new Map<string, { start: number; end: number }>();

  for (const edge of merged) {
    const startJunction = junctions.get(edge.startKey);
    const endJunction = junctions.get(edge.endKey);

    let startTrim = 0;
    let endTrim = 0;

    if (startJunction?.type === "endpoint") {
      startTrim = halfThickness;
    } else if (startJunction?.type === "l-corner") {
      startTrim = computeLCornerTrim(
        edge, edge.startKey, merged, halfThickness,
      );
    } else if (startJunction?.type === "t-junction") {
      startTrim = halfThickness;
    }

    if (endJunction?.type === "endpoint") {
      endTrim = halfThickness;
    } else if (endJunction?.type === "l-corner") {
      endTrim = computeLCornerTrim(
        edge, edge.endKey, merged, halfThickness,
      );
    } else if (endJunction?.type === "t-junction") {
      endTrim = halfThickness;
    }

    trims.set(edge.id, { start: startTrim, end: endTrim });
  }

  return trims;
}

/** 计算单条边在 L 角顶点的斜接距离 */
function computeLCornerTrim(
  edge: MergedWallEdge,
  atVertexKey: string,
  allEdges: MergedWallEdge[],
  halfThickness: number,
): number {
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
  const sinAngle = d1.x * d2.y - d1.y * d2.x;

  if (Math.abs(sinAngle) < 1e-6) {
    return 0;
  }

  const miterDist = halfThickness * (1 + dot) / Math.abs(sinAngle);
  return Math.min(Math.max(miterDist, 0), halfThickness * 3);
}

/** 计算合并边在指定顶点处从顶点向外的方向向量 */
function edgeDirectionAtVertex(
  edge: MergedWallEdge,
  atKey: string,
): Point2D | null {
  const pts = edge.points;
  if (pts.length < 2) return null;

  const firstKey = vertexKey(pts[0]);
  const lastKey = vertexKey(pts[pts.length - 1]);

  if (firstKey === atKey) {
    return { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  }
  if (lastKey === atKey) {
    const len = pts.length;
    return { x: pts[len - 2].x - pts[len - 1].x, y: pts[len - 2].y - pts[len - 1].y };
  }

  // 合并后的多段线顶点可能在中间位置
  for (let i = 1; i < pts.length - 1; i++) {
    const key = vertexKey(pts[i]);
    if (key === atKey) {
      return { x: pts[i - 1].x - pts[i].x, y: pts[i - 1].y - pts[i].y };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 辅助线标签
// ---------------------------------------------------------------------------

export enum EdgeLabel {
  Reliable = "reliable",
  Isolated = "isolated",
  VeryLong = "veryLong",
  ShortDebris = "shortDebris",
}

export interface LabeledEdge extends MergedWallEdge {
  label: EdgeLabel;
  degree: number;
}

/**
 * 根据连通度和长度对合并边打标签。
 *
 * - 可靠墙 (Reliable): 至少一端与其他边相连（度 ≥ 1）
 * - 孤立线 (Isolated): 两端均无连接
 * - 超长线 (VeryLong): 孤立且长度 > 模型对角线 × 0.8
 * - 短线碎片 (ShortDebris): 孤立且长度 < 0.05m
 */
export function labelEdges(
  merged: MergedWallEdge[],
  graph: WallGraph,
  modelDiagonal: number,
): LabeledEdge[] {
  const { adjacency } = graph;
  const shortThreshold = 0.05;
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
