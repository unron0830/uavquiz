/** 伺服器時間差：以伺服器狀態時間戳校正，倒數一律依伺服器截止時間 */
let offset = 0;
let samples: number[] = [];
export function syncFromServer(serverTime: number) {
  samples.push(serverTime - Date.now());
  if (samples.length > 15) samples = samples.slice(-15);
  // 取最大值：最接近即時抵達的樣本（網路延遲只會讓差值變小）
  offset = Math.max(...samples);
}
export const serverNow = () => Date.now() + offset;
