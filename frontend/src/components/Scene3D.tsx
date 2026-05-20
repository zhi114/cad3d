/**
 * Three.js 3D 场景组件。
 *
 * 使用 @react-three/fiber 构建渲染管线：
 *   normalize → topology analysis → Canvas → lights → model group → OrbitControls + Grid
 *
 * 坐标约定：DXF (x, y) → Three.js (x, 0, -y)，高度沿 Y 轴。DXF Y 朝 -Z。
 *
 * 墙体处理管线：
 *   闭合轮廓（closed: true） → ExtrudeGeometry 直接挤出
 *   开放中心线（closed: false）→ 拓扑图 → 合并共线 → 标签分类 → BoxGeometry
 *
 * 自动处理：
 *  - 模型居中到原点
 *  - 毫米 → 米单位转换
 *  - 摄像机距离和网格大小根据模型尺度自适应
 */

import { useMemo, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, useGLTF } from "@react-three/drei";
import type { ParsedDXFData } from "../types";
import {
  buildWallMeshParams,
  buildClosedWallMeshParams,
  buildDoorMeshParams,
  buildWindowMeshParams,
  buildAntennaMeshParams,
  buildLightMeshParams,
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
import { Toolbar } from "./Toolbar";

// ---------------------------------------------------------------------------
// 墙体子组件 — 集成拓扑分析管线
// ---------------------------------------------------------------------------

function WallMeshes({
  data,
  wallThickness,
  showAuxiliary,
}: {
  data: ParsedDXFData;
  wallThickness: number;
  showAuxiliary: boolean;
}) {
  // 闭合轮廓 → ExtrudeGeometry（不参与拓扑分析）
  const closedWalls = useMemo(
    () => buildClosedWallMeshParams(data.walls),
    [data.walls],
  );

  // 开放墙体 → 拓扑图 → 合并 → 标签分类 → 分离可靠墙/辅助线
  const { reliableWalls, auxiliaryEdges } = useMemo(() => {
    const graph = buildWallGraph(data.walls);
    const merged = mergeColinearEdges(graph);
    const modelSize = 50; // 默认对角线估计，模型已缩放
    const labeled = labelEdges(merged, graph, modelSize);

    const reliable = labeled.filter((e) => e.label === EdgeLabel.Reliable);
    const auxiliary = labeled.filter(
      (e) => e.label === EdgeLabel.Isolated || e.label === EdgeLabel.VeryLong,
    );

    // 可靠墙转为 WallData 格式以复用 buildWallMeshParams
    const reliableWalls = reliable.map((e) => ({
      points: e.points,
      height: e.height,
      layer: e.layer,
      closed: false,
    }));

    return {
      reliableWalls,
      auxiliaryEdges: auxiliary,
    };
  }, [data.walls]);

  // 可靠墙 mesh
  const openMeshes = useMemo(
    () => buildWallMeshParams(reliableWalls, wallThickness),
    [reliableWalls, wallThickness],
  );

  // 辅助线 mesh（仅在开关打开且厚度使用标记色）
  const auxMeshes = useMemo(() => {
    if (!showAuxiliary || auxiliaryEdges.length === 0) return [];
    const auxWalls = auxiliaryEdges.map((e) => ({
      points: e.points,
      height: e.height,
      layer: e.layer,
      closed: false,
    }));
    return buildWallMeshParams(auxWalls, wallThickness);
  }, [auxiliaryEdges, showAuxiliary, wallThickness]);

  if (closedWalls.length === 0 && openMeshes.length === 0 && auxMeshes.length === 0) {
    return null;
  }

  return (
    <group>
      {/* 闭合轮廓 — 完整挤实体 */}
      {closedWalls.map((m) => (
        <mesh key={m.key} position={m.position} geometry={m.geometry}>
          <meshStandardMaterial color="#d4c8b8" roughness={0.8} />
        </mesh>
      ))}
      {/* 可靠开放墙 — 分段 Box */}
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

// ---------------------------------------------------------------------------
// 门/窗/天线 — 保持不变
// ---------------------------------------------------------------------------

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
// 灯光设备 glTF 模型
// ---------------------------------------------------------------------------

/** 预加载 glTF 模型，避免每个实例重复加载 */
function LightModel() {
  const gltfPath = "/antenna/天线_result-0.gltf";
  const { scene } = useGLTF(gltfPath);
  // 克隆场景以避免共享引用问题
  return <primitive object={scene.clone()} />;
}

function LightMeshes({ data }: { data: ParsedDXFData }) {
  const meshes = useMemo(
    () => buildLightMeshParams(data.lights),
    [data.lights],
  );
  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((m) => (
        <group key={m.key} position={m.position}>
          <LightModel />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 聚合模型
// ---------------------------------------------------------------------------

function BuildingModel({
  data,
  wallThickness,
  showAuxiliary,
}: {
  data: ParsedDXFData;
  wallThickness: number;
  showAuxiliary: boolean;
}) {
  return (
    <group>
      <WallMeshes
        data={data}
        wallThickness={wallThickness}
        showAuxiliary={showAuxiliary}
      />
      <DoorMeshes data={data} />
      <WindowMeshes data={data} />
      <AntennaMeshes data={data} />
      <LightMeshes data={data} />
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

  const [wallThickness, setWallThickness] = useState(0.2);
  const [showAuxiliary, setShowAuxiliary] = useState(false);

  // 辅助线数量统计
  const auxiliaryCount = useMemo(() => {
    const graph = buildWallGraph(normalizedData.walls);
    const merged = mergeColinearEdges(graph);
    const labeled = labelEdges(merged, graph, 50);
    return labeled.filter(
      (e) => e.label === EdgeLabel.Isolated || e.label === EdgeLabel.VeryLong,
    ).length;
  }, [normalizedData.walls]);

  // 诊断日志：输出实体数量和尺度信息
  useMemo(() => {
    const { walls, doors, windows, antennas, lights } = normalizedData;
    const closedCount = walls.filter((w) => w.closed).length;
    const openCount = walls.filter((w) => !w.closed).length;
    console.log("[CAD3D] 模型诊断信息:", {
      墙体段数: walls.reduce(
        (sum: number, w) => sum + Math.max(0, w.points.length - 1),
        0,
      ),
      闭合轮廓数: closedCount,
      开放墙段数: openCount,
      门数量: doors.length,
      窗数量: windows.length,
      天线数量: antennas.length,
      灯光设备数: lights.length,
      原始包围盒: bounds.isEmpty
        ? "空"
        : `${bounds.extentX.toFixed(0)} × ${bounds.extentZ.toFixed(0)}`,
      单位缩放: unitScale === 1 ? "米（未缩放）" : `毫米→米（×${unitScale}）`,
    });
  }, [normalizedData, bounds, unitScale]);

  // 根据模型大小动态计算场景参数
  const modelSize = bounds.isEmpty ? 10 : bounds.maxExtent * unitScale;

  // 摄像机距离 = 模型对角线 × 1.5，最少 8 米
  const cameraDist = Math.max(modelSize * 1.5, 8);
  const cameraHeight = cameraDist * 0.6;

  // 远裁剪面 = 摄像机距离 × 10
  const farPlane = Math.max(cameraDist * 10, 2000);

  // 网格单元格大小根据模型尺度调整
  const gridCellSize = modelSize > 50 ? 5 : modelSize > 20 ? 2 : 1;
  const gridSize = Math.max(modelSize * 2, 40);

  const handleResetView = useCallback(() => {
    window.dispatchEvent(new CustomEvent("reset-camera"));
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
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

        {/* 建筑模型 */}
        <BuildingModel
          data={normalizedData}
          wallThickness={wallThickness}
          showAuxiliary={showAuxiliary}
        />

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

      {/* 工具栏 — Canvas 上层 overlay */}
      <Toolbar
        wallThickness={wallThickness}
        onWallThicknessChange={setWallThickness}
        showAuxiliary={showAuxiliary}
        onShowAuxiliaryChange={setShowAuxiliary}
        onResetView={handleResetView}
        auxiliaryCount={auxiliaryCount}
      />
    </div>
  );
}
