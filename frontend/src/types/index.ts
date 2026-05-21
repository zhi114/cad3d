/** 二维坐标点 */
export interface Point2D {
  x: number;
  y: number;
}

/** 墙体数据 — 用于挤出成 3D 墙体 */
export interface WallData {
  readonly points: Point2D[];
  readonly height: number;
  readonly layer: string;
  readonly closed: boolean;
  readonly thickness: number; // CAD 单位，0 表示使用默认墙厚
}

/** 门数据 */
export interface DoorData {
  readonly position: Point2D;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly layer: string;
}

/** 窗数据 */
export interface WindowData {
  readonly position: Point2D;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly layer: string;
}

/** 天线数据 */
export interface AntennaData {
  readonly position: Point2D;
  readonly layer: string;
}

/** 灯光设备数据 */
export interface LightData {
  readonly position: Point2D;
  readonly width: number;
  readonly height: number;
  readonly layer: string;
}

/** 后端返回的完整解析结果 */
export interface ParsedDXFData {
  readonly walls: WallData[];
  readonly doors: DoorData[];
  readonly windows: WindowData[];
  readonly antennas: AntennaData[];
  readonly lights: LightData[];
}

/** 上传响应 */
export interface UploadResponse {
  readonly file_id: string;
  readonly data: ParsedDXFData;
}

/** 应用加载状态 */
export type AppState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly data: ParsedDXFData }
  | { readonly phase: "error"; readonly message: string };
