/** 相對路徑：網站可以放在 IIS 的任何目錄（站台根目錄或虛擬目錄） */
export const BASE = '';
export const assetUrl = (f: string) => `images/${encodeURIComponent(f)}`;
