import axios from "axios";
import type { ParsedDXFData } from "../types";

const apiClient = axios.create({
  baseURL: "/api",
  timeout: 30000,
});

/**
 * 上传 DXF 文件并获取解析结果。
 * 通过 Vite proxy 转发到后端 /api/upload。
 */
export async function uploadDXF(file: File): Promise<ParsedDXFData> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiClient.post<{ file_id: string; data: ParsedDXFData }>(
    "/upload",
    formData,
  );
  return response.data.data;
}
