import type { MaterialRecord } from '@/types';
import { putMaterial } from '@/core/storage/db';

// 素材处理：把用户选择的文件读为 base64 dataUrl 并存入 IndexedDB，
// 返回素材 id 列表供任务计划引用。

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 保存文件列表为素材记录，返回 id 列表 */
export async function saveMaterials(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    const dataUrl = await readAsDataUrl(file);
    const record: MaterialRecord = {
      id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mimeType: file.type,
      dataUrl,
      size: file.size,
      createdAt: Date.now(),
    };
    await putMaterial(record);
    ids.push(record.id);
  }
  return ids;
}
