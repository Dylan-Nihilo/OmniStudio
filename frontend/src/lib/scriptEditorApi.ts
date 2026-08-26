import { apiClient, API_URL } from '@/lib/apiClient';
import type { L3Result } from '@/store/editorStore';
export interface DocumentResponse {
  project_id: string;
  content: object;
  updated_at: string;
}

export interface SnapshotResponse {
  project_id: string;
  timestamp: string;
  created_at: string;
}

export const scriptEditorApi = {
  /** 保存文档 */
  saveDocument: async (projectId: string, content: object, createSnapshot = false): Promise<DocumentResponse> => {
    const res = await apiClient.post(`${API_URL}/projects/${projectId}/document`, {
      content,
      create_snapshot: createSnapshot,
    });
    return res.data;
  },

  /** 加载文档 */
  loadDocument: async (projectId: string): Promise<DocumentResponse> => {
    const res = await apiClient.get(`${API_URL}/projects/${projectId}/document`);
    return res.data;
  },

  /** 列出快照 */
  listSnapshots: async (projectId: string): Promise<SnapshotResponse[]> => {
    const res = await apiClient.get(`${API_URL}/projects/${projectId}/document/snapshots`);
    return res.data;
  },

  /** 创建快照 */
  createSnapshot: async (projectId: string): Promise<SnapshotResponse> => {
    const res = await apiClient.post(`${API_URL}/projects/${projectId}/document/snapshots`);
    return res.data;
  },

  /** 恢复快照 */
  restoreSnapshot: async (projectId: string, timestamp: string): Promise<DocumentResponse> => {
    const res = await apiClient.post(
      `${API_URL}/projects/${projectId}/document/snapshots/${timestamp}/restore`
    );
    return res.data;
  },

  /** 导入文档（FDX/Fountain/TXT → Tiptap JSON） */
  importDocument: async (projectId: string, file: File): Promise<any> => {
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    const fileType = ext === 'fdx' ? 'fdx' : ext === 'fountain' ? 'fountain' : 'txt';

    const res = await apiClient.post(`${API_URL}/projects/${projectId}/document/import`, {
      filename: file.name,
      content: base64,
      file_type: fileType,
    });
    return res.data;
  },

  /** 导出文档（Tiptap JSON → PDF/DOCX，返回 Blob） */
  exportDocument: async (projectId: string, content: any, format: string): Promise<Blob> => {
    const res = await apiClient.post(
      `${API_URL}/projects/${projectId}/document/export`,
      { content, format, options: {} },
      { responseType: 'blob' }
    );
    return res.data;
  },

  /** 同步派生数据到后端 */
  syncDerivation: async (projectId: string, data: any): Promise<void> => {
    await apiClient.post(`${API_URL}/projects/${projectId}/sync_derivation`, data);
  },

  /** L3 LLM 增量补全请求 */
  deriveGaps: async (
    projectId: string,
    params: {
      already_extracted?: { scenes: string[]; characters: string[] };
      gaps?: string[]; // e.g. ['props', 'beats', 'locations']
    }
  ): Promise<{ results: L3Result[]; task_id?: string }> => {
    const res = await apiClient.post(`${API_URL}/projects/${projectId}/derive_gaps`, params);
    return res.data;
  },

  /** 确认 ShotBlock */
  confirmShotBlock: async (projectId: string, shotId: string, data: any): Promise<any> => {
    const res = await apiClient.post(
      `${API_URL}/projects/${projectId}/shot_blocks/${shotId}/confirm`,
      data
    );
    return res.data;
  },
};
