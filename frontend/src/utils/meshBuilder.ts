/**
 * Three.js 几何体构建工具。
 *
 * 将解析后的 DXF 数据转换为 Three.js 渲染所需的位置/旋转/尺寸参数。
 * 坐标映射：DXF (x, y) → Three.js (x, 0, -y)，高度沿 Y 轴。DXF Y 朝 -Z（俯视屏幕下方）。
 *
 * NaN 防护策略：每一层（坐标→向量→四元数→尺寸）都做 isFinite 校验，
 * 确保传入 Three.js 几何体的参数不包含 NaN/Inf。
 */

import * as THREE from "three";
import type {
  ParsedDXFData,
  WallData,
  DoorData,
  WindowData,
  AntennaData,
  Point2D,
} from "../types";

// ---------------------------------------------------------------------------
// 常量 — 默认尺寸（米）
// ---------------------------------------------------------------------------

const WALL_THICKNESS = 0.2;
const WINDOW_ELEVATION = 1.0;
const ANTENNA_RADIUS = 0.05;
const ANTENNA_HEIGHT = 0.3;

// ---------------------------------------------------------------------------
// 基础校验
// ---------------------------------------------------------------------------

export function isFiniteNumber(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

export function isFinitePoint(p: Point2D): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

/** 默认安全坐标，避免 NaN 位置 */
const SAFE_ZERO_3D: [number, number, number] = [0, 0, 0];

/** 单位四元数（无旋转），作为 segmentQuaternion 的 NaN 退化兜底 */
const IDENTITY_QUATERNION = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 包围盒计算
// ---------------------------------------------------------------------------

export interface ModelBounds {
  minX: number;
  maxX: number;
  minZ: number; // DXF Y → 3D Z
  maxZ: number;
  centerX: number;
  centerZ: number;
  extentX: number;
  extentZ: number;
  maxExtent: number;
  isEmpty: boolean;
}

/**
 * 计算 DXF 数据的二维包围盒（仅 XZ 平面）。
 * 遍历所有实体类型的坐标点，收集 min/max。
 *
 * DXF 单位通常为毫米，此处仅计算原始数值范围，
 * 单位转换由 normalizeDXFData 负责。
 */
export function computeModelBounds(data: ParsedDXFData): ModelBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const collectPoints = (pts: readonly Point2D[]) => {
    for (const p of pts) {
      if (isFinitePoint(p)) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minZ) minZ = p.y;
        if (p.y > maxZ) maxZ = p.y;
      }
    }
  };

  for (const wall of data.walls) {
    collectPoints(wall.points);
  }
  for (const door of data.doors) {
    collectPoints([door.position]);
  }
  for (const win of data.windows) {
    collectPoints([win.position]);
  }
  for (const ant of data.antennas) {
    collectPoints([ant.position]);
  }

  const isEmpty = !Number.isFinite(minX) || !Number.isFinite(maxX);

  if (isEmpty) {
    return {
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      centerX: 0,
      centerZ: 0,
      extentX: 0,
      extentZ: 0,
      maxExtent: 0,
      isEmpty: true,
    };
  }

  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    extentX,
    extentZ,
    maxExtent: Math.max(extentX, extentZ),
    isEmpty: false,
  };
}

// ---------------------------------------------------------------------------
// 坐标归一化
// ---------------------------------------------------------------------------

export interface NormalizedResult {
  data: ParsedDXFData;
  bounds: ModelBounds;
  /** XZ 平面的缩放因子（mm→m 则为 1/1000） */
  unitScale: number;
}

/**
 * 将 DXF 数据居中并转换单位。
 *
 * 策略：
 * - 将几何中心平移到原点
 * - 若包围盒 > 200 单位，视为毫米 → XZ 坐标缩放到米（÷1000）
 * - 高度（wall.height / door.height 等）不缩放——它们已在后端硬编码为米
 * - 门/窗宽度来自 DXF 包围盒（与坐标同单位），需要缩放
 */
export function normalizeDXFData(data: ParsedDXFData): NormalizedResult {
  const bounds = computeModelBounds(data);

  if (bounds.isEmpty || bounds.maxExtent < 0.01) {
    return { data, bounds, unitScale: 1 };
  }

  // 若模型在 XZ 平面超过 200 单位，大概率是毫米 → 转换为米
  const unitScale = bounds.maxExtent > 200 ? 1 / 1000 : 1;

  function scalePoint(p: Point2D): Point2D {
    return {
      x: (p.x - bounds.centerX) * unitScale,
      y: (p.y - bounds.centerZ) * unitScale,
    };
  }

  return {
    data: {
      walls: data.walls.map((w) => ({
        ...w,
        points: w.points.map(scalePoint),
        // height 不缩放——已在后端设为米
      })),
      doors: data.doors.map((d) => ({
        ...d,
        position: scalePoint(d.position),
        width: d.width * unitScale,
        // height 不缩放
      })),
      windows: data.windows.map((w) => ({
        ...w,
        position: scalePoint(w.position),
        width: w.width * unitScale,
        // height 不缩放
      })),
      antennas: data.antennas.map((a) => ({
        ...a,
        position: scalePoint(a.position),
      })),
    },
    bounds,
    unitScale,
  };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** DXF 二维坐标 → Three.js 三维坐标（Y 轴为高度轴） */
function to3D(p: Point2D, y = 0): [number, number, number] {
  if (!isFinitePoint(p) || !isFiniteNumber(y)) {
    return SAFE_ZERO_3D;
  }
  return [p.x, y, -p.y];
}

/**
 * 计算线段在 XZ 平面的方向四元数，将 BoxGeometry 的 X 轴对齐到线段方向。
 *
 * 退化情况（零向量 / NaN）返回单位四元数，不抛出异常。
 */
function segmentQuaternion(dx: number, dy: number): THREE.Quaternion {
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) {
    return IDENTITY_QUATERNION.clone();
  }

  const sqLen = dx * dx + dy * dy;
  if (sqLen < 1e-12) {
    // 线段退化，不需要旋转
    return IDENTITY_QUATERNION.clone();
  }

  const invLen = 1 / Math.sqrt(sqLen);
  const dir = new THREE.Vector3(dx * invLen, 0, -dy * invLen);
  const q = new THREE.Quaternion();
  q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  return q;
}

// ---------------------------------------------------------------------------
// 闭合轮廓墙体 → ExtrudeGeometry
// ---------------------------------------------------------------------------

export interface ClosedWallMeshParams {
  position: [number, number, number];
  geometry: THREE.ExtrudeGeometry;
  key: string;
}

/**
 * 为闭合轮廓墙体构建 ExtrudeGeometry。
 *
 * 管线：points[] → Shape (XZ 平面) → ExtrudeGeometry (沿 Y 轴挤出)
 *
 * 每个闭合轮廓输出一个完整的挤实体，无接缝、无重叠。
 * wall.points 已通过 normalizeDXFData 居中并缩放，可直接使用。
 */
export function buildClosedWallMeshParams(walls: WallData[]): ClosedWallMeshParams[] {
  const result: ClosedWallMeshParams[] = [];

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    if (!wall.closed) continue;
    if (wall.points.length < 3) continue;

    const shape = new THREE.Shape();
    const first = wall.points[0];
    if (!isFinitePoint(first)) continue;

    shape.moveTo(first.x, first.y);
    for (let i = 1; i < wall.points.length; i++) {
      const p = wall.points[i];
      if (!isFinitePoint(p)) continue;
      shape.lineTo(p.x, p.y);
    }
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      steps: 1,
      depth: wall.height,
      bevelEnabled: false,
    });
    // ExtrudeGeometry 默认沿 +Z 挤出，需旋转使高度沿 Y 轴
    geometry.rotateX(-Math.PI / 2);

    result.push({
      key: `closed-wall-${wi}`,
      position: [0, 0, 0],
      geometry,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 开放中心线墙体 → 分段 Box
// ---------------------------------------------------------------------------

export interface WallMeshParams {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  size: [number, number, number]; // [length, height, thickness]
  key: string;
}

export function buildWallMeshParams(walls: WallData[]): WallMeshParams[] {
  const result: WallMeshParams[] = [];

  for (let wi = 0; wi < walls.length; wi++) {
    const wall = walls[wi];
    if (wall.closed) continue; // 闭合轮廓由 buildClosedWallMeshParams 处理
    const pts = wall.points;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];

      // NaN/Inf 坐标直接跳过，防止污染后续计算
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const sqLen = dx * dx + dy * dy;

      // 退化线段：NaN 已被 isFinitePoint 拦截，此处只需过滤零长度
      if (sqLen < 1e-8) continue;

      const length = Math.sqrt(sqLen);

      const midX = (a.x + b.x) / 2;
      const midY = wall.height / 2;
      const midZ = (a.y + b.y) / 2;

      result.push({
        key: `wall-${wi}-${i}`,
        position: to3D({ x: midX, y: midZ }, midY),
        quaternion: segmentQuaternion(dx, dy),
        size: [length, wall.height, WALL_THICKNESS],
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 门 → Box
// ---------------------------------------------------------------------------

export interface OpeningMeshParams {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  size: [number, number, number]; // [width, height, depth]
  key: string;
  color: string;
}

export function buildDoorMeshParams(doors: DoorData[]): OpeningMeshParams[] {
  const depth = 0.1;

  return doors
    .filter(
      (door) =>
        isFinitePoint(door.position) &&
        isFiniteNumber(door.width) &&
        isFiniteNumber(door.height) &&
        isFiniteNumber(door.rotation),
    )
    .map((door, i) => {
      const dx = Math.cos(door.rotation);
      const dy = Math.sin(door.rotation);

      return {
        key: `door-${i}`,
        position: to3D(door.position, door.height / 2),
        quaternion: segmentQuaternion(dx, dy),
        size: [door.width, door.height, depth],
        color: "#8B4513",
      };
    });
}

// ---------------------------------------------------------------------------
// 窗 → Box
// ---------------------------------------------------------------------------

export function buildWindowMeshParams(
  windows: WindowData[],
): OpeningMeshParams[] {
  const depth = 0.1;

  return windows
    .filter(
      (win) =>
        isFinitePoint(win.position) &&
        isFiniteNumber(win.width) &&
        isFiniteNumber(win.height) &&
        isFiniteNumber(win.rotation),
    )
    .map((win, i) => {
      const dx = Math.cos(win.rotation);
      const dy = Math.sin(win.rotation);

      return {
        key: `window-${i}`,
        // 窗底部离地 WINDOW_ELEVATION 米，中心在 elevation + height/2
        position: to3D(win.position, WINDOW_ELEVATION + win.height / 2),
        quaternion: segmentQuaternion(dx, dy),
        size: [win.width, win.height, depth],
        color: "#87CEEB",
      };
    });
}

// ---------------------------------------------------------------------------
// 天线 → 圆柱
// ---------------------------------------------------------------------------

export interface AntennaMeshParams {
  position: [number, number, number];
  key: string;
}

export function buildAntennaMeshParams(
  antennas: AntennaData[],
): AntennaMeshParams[] {
  return antennas
    .filter((ant) => isFinitePoint(ant.position))
    .map((ant, i) => ({
      key: `antenna-${i}`,
      position: to3D(ant.position, ANTENNA_HEIGHT / 2),
    }));
}

export { ANTENNA_RADIUS, ANTENNA_HEIGHT };
