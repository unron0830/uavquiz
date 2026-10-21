import { api } from './api';

export async function uploadAvatar(file: File, code: string): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('請選擇 PNG、JPG 或 WebP 圖片');
  if (file.size > 5 * 1024 * 1024) throw new Error('頭像圖片請小於 5 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context || !bitmap.width || !bitmap.height) throw new Error('無法讀取圖片，請換一張圖片');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const result = await api<{ avatar: string }>('/public/avatar', { body: { code, image: canvas.toDataURL('image/png') } });
    return result.avatar;
  } finally { bitmap.close(); }
}
