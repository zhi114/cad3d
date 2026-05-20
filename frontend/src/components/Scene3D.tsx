/**
 * Three.js 3D 场景组件。
 *
 * 使用 @react-three/fiber 构建渲染管线：
 *   normalize → Canvas → lights → model group → OrbitControls + Grid
 *
 * 坐标约定：DXF (x, y) → Three.js (x, 0, -y)，高度沿 Y 轴。DXF Y 朝 -Z。
 *
 * 自动处理：
 *  - 模型居中到原点
 *  - 毫米 → 米单位转换（包围盒 > 200 单位时触发）
 *  - 摄像机距离和网格大小根据模型尺度自适应
 */

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import type { ParsedDXFData } from "../types";
import {
  buildWallMeshParams,
  buildClosedWallMeshParams,
  buildDoorMeshParams,
  buildWindowMeshParams,
  buildAntennaMeshParams,
  normalizeDXFData,
  ANTENNA_RADIUS,
  ANTENNA_HEIGHT,
} from "../utils/meshBuilder";

// ---------------------------------------------------------------------------
// 子组件 — 各实体类型
// ---------------------------------------------------------------------------

function WallMeshes({ data }: { data: ParsedDXFData }) {
  const closedWalls = useMemo(
    () => buildClosedWallMeshParams(data.walls),
    [data.walls],
  );
  const openMeshes = useMemo(
    () => buildWallMeshParams(data.walls),
    [data.walls],
  );

  if (closedWalls.length === 0 && openMeshes.length === 0) return null;

  return (
    <group>
      {closedWalls.map((m) => (
        <mesh key={m.key} position={m.position} geometry={m.geometry}>
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
      {openMeshes.map((m) => (
        <mesh key={m.key} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function DoorMeshes({ data }: { data: ParsedDXFData }) {
  const meshes = useMemo(() => buildDoorMeshParams(data.doors), [data.doors]);
  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial color={m.color} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function WindowMeshes({ data }: { data: ParsedDXFData }) {
  const meshes = useMemo(
    () => buildWindowMeshParams(data.windows),
    [data.windows],
  );
  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} position={m.position} quaternion={m.quaternion}>
          <boxGeometry args={m.size} />
          <meshStandardMaterial
            color={m.color}
            roughness={0.3}
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

function AntennaMeshes({ data }: { data: ParsedDXFData }) {
  const meshes = useMemo(
    () => buildAntennaMeshParams(data.antennas),
    [data.antennas],
  );
  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} position={m.position}>
          <cylinderGeometry
            args={[ANTENNA_RADIUS, ANTENNA_RADIUS, ANTENNA_HEIGHT, 8]}
          />
          <meshStandardMaterial color="#e74c3c" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 聚合模型
// ---------------------------------------------------------------------------

function BuildingModel({ data }: { data: ParsedDXFData }) {
  return (
    <group>
      <WallMeshes data={data} />
      <DoorMeshes data={data} />
      <WindowMeshes data={data} />
      <AntennaMeshes data={data} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 场景导出
// ---------------------------------------------------------------------------

interface Scene3DProps {
  readonly data: ParsedDXFData;
}

export function Scene3D({ data }: Scene3DProps) {
  const {
    data: normalizedData,
    bounds,
    unitScale,
  } = useMemo(() => normalizeDXFData(data), [data]);

  // 诊断日志：输出实体数量和尺度信息，用于排查模型不可见问题
  useMemo(() => {
    const { walls, doors, windows, antennas } = normalizedData;
    console.log("[CAD3D] 模型诊断信息:", {
      墙体段数: walls.reduce(
        (sum: number, w) => sum + Math.max(0, w.points.length - 1),
        0,
      ),
      门数量: doors.length,
      窗数量: windows.length,
      天线数量: antennas.length,
      原始包围盒: bounds.isEmpty
        ? "空"
        : `${bounds.extentX.toFixed(0)} × ${bounds.extentZ.toFixed(0)}`,
      单位缩放: unitScale === 1 ? "米（未缩放）" : `毫米→米（×${unitScale}）`,
      归一化后中心: `(${bounds.centerX.toFixed(0)}, ${bounds.centerZ.toFixed(0)}) → (0, 0)`,
    });
  }, [normalizedData, bounds, unitScale]);

  // 根据模型大小动态计算场景参数
  const modelSize = bounds.isEmpty ? 10 : bounds.maxExtent * unitScale;

  // 摄像机距离 = 模型对角线 × 1.5，最少 8 米
  const cameraDist = Math.max(modelSize * 1.5, 8);
  const cameraHeight = cameraDist * 0.6;

  // 远裁剪面 = 摄像机距离 × 10，确保大型模型不被裁剪
  const farPlane = Math.max(cameraDist * 10, 2000);

  // 网格单元格大小根据模型尺度调整
  const gridCellSize = modelSize > 50 ? 5 : modelSize > 20 ? 2 : 1;
  const gridSize = Math.max(modelSize * 2, 40);

  return (
    <Canvas
      camera={{
        position: [cameraDist, cameraHeight, cameraDist],
        fov: 45,
        near: 0.1,
        far: farPlane,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      {/* 光照 */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[cameraDist, cameraDist * 2, 0]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={["#ffffff", "#b0b0b0", 0.3]} />

      {/* 建筑模型 — 已通过 normalizeDXFData 居中并转换单位 */}
      <BuildingModel data={normalizedData} />

      {/* 地面网格 */}
      <Grid
        args={[gridSize, gridSize]}
        cellSize={gridCellSize}
        cellThickness={0.5}
        cellColor="#6e6e6e"
        sectionSize={gridCellSize * 5}
        sectionThickness={1}
        sectionColor="#9d9d9d"
        fadeDistance={gridSize * 1.5}
        infiniteGrid
        position={[0, -0.01, 0]}
      />

      {/* 轨道控制器 */}
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        minDistance={modelSize * 0.1}
        maxDistance={modelSize * 10}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
