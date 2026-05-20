"""
DXF 文件解析器。

管线：
  读取 DXF → 按图层关键字分类实体 → 提取几何数据 → 返回结构化结果

支持的图层关键字（大小写不敏感）：
  WALL   → 墙体
  DOOR   → 门
  WINDOW → 窗
  ANTENNA → 天线

仅保留包含以上关键字的图层，其余图层忽略。
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import ezdxf
from ezdxf.entities import (
    DXFEntity,
    Insert,
    Line,
    LWPolyline,
    Polyline,
    Arc,
    Circle,
    Point,
)


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass
class WallSegment:
    """墙体几何数据。"""

    points: list[list[float]]  # [[x, y], ...] 二维顶点列表
    height: float = 3.0  # 默认墙体高度（米）
    layer: str = "WALL"
    closed: bool = False  # 是否为闭合多边形轮廓


@dataclass
class OpeningData:
    """门/窗几何数据。"""

    position: list[float]  # [x, y] 中心位置
    width: float
    height: float
    rotation: float = 0.0  # 弧度
    layer: str = ""


@dataclass
class AntennaData:
    """天线几何数据。"""

    position: list[float]  # [x, y]
    layer: str = "ANTENNA"


@dataclass
class LightData:
    """灯光设备几何数据。"""

    position: list[float]  # [x, y]
    width: float = 0.0  # DXF 块包围盒宽度
    height: float = 0.0  # DXF 块包围盒高度
    layer: str = "A-LIGHT"


@dataclass
class ParsedResult:
    """解析结果聚合。"""

    walls: list[WallSegment] = field(default_factory=list)
    doors: list[OpeningData] = field(default_factory=list)
    windows: list[OpeningData] = field(default_factory=list)
    antennas: list[AntennaData] = field(default_factory=list)
    lights: list[LightData] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 图层分类
# ---------------------------------------------------------------------------

LAYER_KEYWORD_MAP: dict[str, str] = {
    "WALL": "wall",
    "DOOR": "door",
    "WINDOW": "window",
    "ANTENNA": "antenna",
    "A-LIGHT": "light",
}

# 默认尺寸（米）
DEFAULT_WALL_HEIGHT = 3.0
DEFAULT_DOOR_WIDTH = 0.9
DEFAULT_DOOR_HEIGHT = 2.1
DEFAULT_WINDOW_WIDTH = 1.2
DEFAULT_WINDOW_HEIGHT = 1.0
DEFAULT_WINDOW_ELEVATION = 1.0

# 闭合轮廓检测容差（CAD 单位）
CLOSED_THRESHOLD = 0.01


def _get_layer(entity: DXFEntity) -> str:
    """安全获取实体的图层名称。某些实体（如 DXFGroup）没有 layer 属性。"""
    return getattr(entity.dxf, "layer", "")


def classify_layer(layer_name: str) -> Optional[str]:
    """根据图层名称判断实体类型。包含关键字即匹配，大小写不敏感。"""
    upper = layer_name.upper()
    for keyword, entity_type in LAYER_KEYWORD_MAP.items():
        if keyword in upper:
            return entity_type
    return None


# ---------------------------------------------------------------------------
# 几何提取
# ---------------------------------------------------------------------------


def _is_finite_coord(x: float, y: float) -> bool:
    """校验坐标值是否为有限数，拦截 NaN 和 Inf。"""
    return math.isfinite(x) and math.isfinite(y)


def _safe_round(value: float, ndigits: int = 6) -> float:
    """安全舍入，非有限值返回 0.0。"""
    if not math.isfinite(value):
        return 0.0
    return round(value, ndigits)


def _extract_points_from_lwpolyline(entity: LWPolyline) -> list[list[float]]:
    """从 LWPOLYLINE 提取二维顶点坐标。忽略凸度（bulge），直接连线。"""
    points: list[list[float]] = []
    with entity.points() as pts:
        for pt in pts:
            x, y = pt[0], pt[1]
            if _is_finite_coord(x, y):
                points.append([_safe_round(x), _safe_round(y)])
    return points


def _extract_points_from_polyline(entity: Polyline) -> list[list[float]]:
    """从 POLYLINE（2D/3D）提取二维顶点坐标。"""
    points: list[list[float]] = []
    for vertex in entity.vertices:
        pos = vertex.dxf.location
        x, y = pos[0], pos[1]
        if _is_finite_coord(x, y):
            points.append([_safe_round(x), _safe_round(y)])
    return points


def _extract_points_from_line(entity: Line) -> list[list[float]]:
    """从 LINE 提取起止点。"""
    s = entity.dxf.start
    e = entity.dxf.end
    result: list[list[float]] = []
    for pt in (s, e):
        x, y = pt[0], pt[1]
        if _is_finite_coord(x, y):
            result.append([_safe_round(x), _safe_round(y)])
        else:
            result.append([0.0, 0.0])
    return result


def _sample_arc(entity: Arc, segments: int = 16) -> list[list[float]]:
    """将 ARC 采样为折线段。"""
    cx, cy, _ = entity.dxf.center
    r = entity.dxf.radius
    sa = math.radians(entity.dxf.start_angle)
    ea = math.radians(entity.dxf.end_angle)

    # 校验圆弧参数
    if not _is_finite_coord(cx, cy) or not math.isfinite(r) or r <= 0:
        return []
    if not math.isfinite(sa) or not math.isfinite(ea):
        return []

    # 确保角度递增
    if ea < sa:
        ea += 2 * math.pi

    points: list[list[float]] = []
    for i in range(segments + 1):
        a = sa + (ea - sa) * i / segments
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        if _is_finite_coord(x, y):
            points.append([_safe_round(x), _safe_round(y)])
    return points


def _sample_circle(entity: Circle, segments: int = 32) -> list[list[float]]:
    """将 CIRCLE 采样为封闭多边形。"""
    cx, cy, _ = entity.dxf.center
    r = entity.dxf.radius

    if not _is_finite_coord(cx, cy) or not math.isfinite(r) or r <= 0:
        return []

    points: list[list[float]] = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        if _is_finite_coord(x, y):
            points.append([_safe_round(x), _safe_round(y)])
    return points


def _compute_centroid(positions: list[list[float]]) -> list[float]:
    """计算点集的几何中心。过滤 NaN 后再计算。"""
    finite = [p for p in positions if _is_finite_coord(p[0], p[1])]
    if not finite:
        return [0.0, 0.0]
    n = len(finite)
    sx = sum(p[0] for p in finite)
    sy = sum(p[1] for p in finite)
    return [_safe_round(sx / n), _safe_round(sy / n)]


def _compute_bounding_box(positions: list[list[float]]) -> tuple[float, float]:
    """计算点集的包围盒宽度和高度。返回 (width, height)。过滤 NaN 后再计算。"""
    finite = [p for p in positions if _is_finite_coord(p[0], p[1])]
    if not finite:
        return (0.0, 0.0)
    xs = [p[0] for p in finite]
    ys = [p[1] for p in finite]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    return (_safe_round(w, 6) if math.isfinite(w) else 0.0,
            _safe_round(h, 6) if math.isfinite(h) else 0.0)


def _compute_rotation_from_line(start: list[float], end: list[float]) -> float:
    """计算线段的方向角（弧度）。"""
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    angle = math.atan2(dy, dx)
    return angle if math.isfinite(angle) else 0.0


def _is_closed_polyline(points: list[list[float]], threshold: float = CLOSED_THRESHOLD) -> bool:
    """检测点链是否闭合：点数 ≥ 3 且首尾距离 ≤ 容差。"""
    if len(points) < 3:
        return False
    dx = points[0][0] - points[-1][0]
    dy = points[0][1] - points[-1][1]
    return bool((dx * dx + dy * dy) <= threshold * threshold)


# ---------------------------------------------------------------------------
# 实体处理器
# ---------------------------------------------------------------------------


def _handle_wall_entity(entity: DXFEntity, walls: list[WallSegment]) -> None:
    """处理墙体图层的实体：提取几何点序列。"""
    points: list[list[float]] = []

    if isinstance(entity, LWPolyline):
        points = _extract_points_from_lwpolyline(entity)
    elif isinstance(entity, Polyline):
        points = _extract_points_from_polyline(entity)
    elif isinstance(entity, Line):
        points = _extract_points_from_line(entity)
    elif isinstance(entity, Arc):
        points = _sample_arc(entity)
    elif isinstance(entity, Circle):
        points = _sample_circle(entity)
    else:
        return  # 不支持的实体类型，跳过

    if len(points) < 2:
        return

    walls.append(
        WallSegment(
            points=points,
            height=DEFAULT_WALL_HEIGHT,
            layer=_get_layer(entity),
            closed=_is_closed_polyline(points),
        )
    )


def _handle_opening_entity(
    entity: DXFEntity,
    openings: list[OpeningData],
    entity_type_name: str,
) -> None:
    """处理门/窗图层的实体：提取位置和尺寸。"""
    positions: list[list[float]] = []
    rotation = 0.0

    if isinstance(entity, Insert):
        # INSERT（块引用）— 使用插入点作为位置，缩放因子估算尺寸
        ip = entity.dxf.insert
        positions.append([ip[0], ip[1]])
        rotation = getattr(entity.dxf, "rotation", 0.0) or 0.0
    elif isinstance(entity, LWPolyline):
        pts = _extract_points_from_lwpolyline(entity)
        positions.extend(pts)
    elif isinstance(entity, Polyline):
        pts = _extract_points_from_polyline(entity)
        positions.extend(pts)
    elif isinstance(entity, Line):
        pts = _extract_points_from_line(entity)
        positions.extend(pts)
        rotation = _compute_rotation_from_line(pts[0], pts[1])
    elif isinstance(entity, Arc):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Circle):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Point):
        pos = entity.dxf.location
        positions.append([pos[0], pos[1]])
    else:
        return

    if not positions:
        return

    centroid = _compute_centroid(positions)
    bb_width, bb_height = _compute_bounding_box(positions)

    # 使用包围盒的较大边作为宽度，较小边作为厚度
    width = max(bb_width, bb_height)
    if width < 0.01:
        width = DEFAULT_DOOR_WIDTH if entity_type_name == "door" else DEFAULT_WINDOW_WIDTH

    height = DEFAULT_DOOR_HEIGHT if entity_type_name == "door" else DEFAULT_WINDOW_HEIGHT

    openings.append(
        OpeningData(
            position=centroid,
            width=width,
            height=height,
            rotation=rotation,
            layer=_get_layer(entity),
        )
    )


def _handle_antenna_entity(
    entity: DXFEntity,
    antennas: list[AntennaData],
) -> None:
    """处理天线图层的实体：提取位置点。"""
    positions: list[list[float]] = []

    if isinstance(entity, Insert):
        ip = entity.dxf.insert
        positions.append([ip[0], ip[1]])
    elif isinstance(entity, LWPolyline):
        positions.extend(_extract_points_from_lwpolyline(entity))
    elif isinstance(entity, Polyline):
        positions.extend(_extract_points_from_polyline(entity))
    elif isinstance(entity, Line):
        positions.extend(_extract_points_from_line(entity))
    elif isinstance(entity, Circle):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Arc):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Point):
        p = entity.dxf.location
        positions.append([p[0], p[1]])
    else:
        return

    for pos in positions:
        antennas.append(
            AntennaData(
                position=pos,
                layer=_get_layer(entity),
            )
        )


def _handle_light_entity(
    entity: DXFEntity,
    lights: list[LightData],
    doc,
) -> None:
    """处理灯光图层的实体：提取位置点。INSERT 实体解析块质心。"""
    positions: list[list[float]] = []
    block_width = 0.0

    if isinstance(entity, Insert):
        centroid = _resolve_insert_centroid(doc, entity)
        positions.append(centroid)
        # 记录块包围盒尺寸（取较大边作为参考宽度）
        bw, bh = _compute_insert_size(doc, entity)
        block_width = max(bw, bh)
    elif isinstance(entity, LWPolyline):
        positions.extend(_extract_points_from_lwpolyline(entity))
    elif isinstance(entity, Polyline):
        positions.extend(_extract_points_from_polyline(entity))
    elif isinstance(entity, Line):
        positions.extend(_extract_points_from_line(entity))
    elif isinstance(entity, Circle):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Arc):
        positions.append([entity.dxf.center[0], entity.dxf.center[1]])
    elif isinstance(entity, Point):
        p = entity.dxf.location
        positions.append([p[0], p[1]])
    else:
        return

    for pos in positions:
        lights.append(
            LightData(
                position=pos,
                width=block_width,
                height=block_width,  # 各向同性缩放，宽高相同
                layer=_get_layer(entity),
            )
        )


# ---------------------------------------------------------------------------
# 块引用辅助
# ---------------------------------------------------------------------------


def _resolve_insert_centroid(doc, entity: DXFEntity) -> list[float]:
    """
    计算 INSERT（块引用）实体的几何中心位置。

    仅使用插入点会丢失块内部几何体的偏移。
    此函数解析块定义，计算块内几何体的质心，返回插入点 + 块内偏移。

    若块无法解析或为空，降级返回插入点。
    """
    block_name = entity.dxf.name
    block = doc.blocks.get(block_name)

    if block is None:
        ip = entity.dxf.insert
        return [ip[0], ip[1]]

    positions: list[list[float]] = []
    for sub_entity in block:
        etype = sub_entity.dxftype()
        if etype == "LINE":
            positions.extend(_extract_points_from_line(sub_entity))
        elif etype == "LWPOLYLINE":
            positions.extend(_extract_points_from_lwpolyline(sub_entity))
        elif etype == "POLYLINE":
            positions.extend(_extract_points_from_polyline(sub_entity))
        elif etype == "CIRCLE":
            positions.append([sub_entity.dxf.center[0], sub_entity.dxf.center[1]])
        elif etype == "ARC":
            positions.append([sub_entity.dxf.center[0], sub_entity.dxf.center[1]])
        elif etype == "POINT":
            positions.append([sub_entity.dxf.location[0], sub_entity.dxf.location[1]])
        elif etype == "INSERT":
            # 嵌套块引用，递归解析
            nested = _resolve_insert_centroid(doc, sub_entity)
            positions.append(nested)

    ip = entity.dxf.insert
    if not positions:
        return [ip[0], ip[1]]

    centroid = _compute_centroid(positions)
    return [ip[0] + centroid[0], ip[1] + centroid[1]]


def _compute_insert_size(doc, entity: DXFEntity) -> tuple[float, float]:
    """
    计算 INSERT（块引用）实体的几何包围盒尺寸。
    返回 (width, height)，单位为 DXF 单位。
    """
    block_name = entity.dxf.name
    block = doc.blocks.get(block_name)

    if block is None:
        return (0.0, 0.0)

    positions: list[list[float]] = []
    for sub_entity in block:
        etype = sub_entity.dxftype()
        if etype == "LINE":
            positions.extend(_extract_points_from_line(sub_entity))
        elif etype == "LWPOLYLINE":
            positions.extend(_extract_points_from_lwpolyline(sub_entity))
        elif etype == "POLYLINE":
            positions.extend(_extract_points_from_polyline(sub_entity))
        elif etype == "CIRCLE":
            positions.append([sub_entity.dxf.center[0], sub_entity.dxf.center[1]])
            # 圆的尺寸取直径
        elif etype == "ARC":
            positions.append([sub_entity.dxf.center[0], sub_entity.dxf.center[1]])
        elif etype == "POINT":
            positions.append([sub_entity.dxf.location[0], sub_entity.dxf.location[1]])
        elif etype == "INSERT":
            # 嵌套块 — 递归计算
            nested_w, nested_h = _compute_insert_size(doc, sub_entity)
            nested_pos = _resolve_insert_centroid(doc, sub_entity)
            positions.append(nested_pos)
            if nested_w > 0 or nested_h > 0:
                # 用四个角点扩展包围盒
                hw, hh = nested_w / 2, nested_h / 2
                for dx, dy in [(-hw, -hh), (hw, -hh), (-hw, hh), (hw, hh)]:
                    positions.append([nested_pos[0] + dx, nested_pos[1] + dy])

    if not positions:
        return (0.0, 0.0)

    return _compute_bounding_box(positions)


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------


def parse_dxf_file(file_path: str) -> dict:
    """
    解析 DXF 文件，过滤出 WALL/DOOR/WINDOW/ANTENNA 图层的几何数据。

    管线：
      1. ezdxf 读取文件
      2. 遍历 modelspace 所有实体
      3. 按图层名称分类
      4. 提取几何特征
      5. 聚合为结构化结果
    """
    doc = ezdxf.readfile(file_path)
    msp = doc.modelspace()

    result = ParsedResult()

    for entity in msp:
        layer_name: str = _get_layer(entity)
        entity_type = classify_layer(layer_name)
        if entity_type is None:
            continue

        if entity_type == "wall":
            _handle_wall_entity(entity, result.walls)
        elif entity_type == "door":
            _handle_opening_entity(entity, result.doors, "door")
        elif entity_type == "window":
            _handle_opening_entity(entity, result.windows, "window")
        elif entity_type == "antenna":
            _handle_antenna_entity(entity, result.antennas)
        elif entity_type == "light":
            _handle_light_entity(entity, result.lights, doc)

    return {
        "walls": [
            {"points": [{"x": p[0], "y": p[1]} for p in w.points], "height": w.height, "layer": w.layer, "closed": w.closed}
            for w in result.walls
        ],
        "doors": [
            {
                "position": {"x": d.position[0], "y": d.position[1]},
                "width": d.width,
                "height": d.height,
                "rotation": d.rotation,
                "layer": d.layer,
            }
            for d in result.doors
        ],
        "windows": [
            {
                "position": {"x": w.position[0], "y": w.position[1]},
                "width": w.width,
                "height": w.height,
                "rotation": w.rotation,
                "layer": w.layer,
            }
            for w in result.windows
        ],
        "antennas": [
            {"position": {"x": a.position[0], "y": a.position[1]}, "layer": a.layer} for a in result.antennas
        ],
        "lights": [
            {
                "position": {"x": l.position[0], "y": l.position[1]},
                "width": l.width,
                "height": l.height,
                "layer": l.layer,
            }
            for l in result.lights
        ],
    }
