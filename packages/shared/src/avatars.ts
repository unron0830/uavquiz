/** 非真人卡通頭像（SPEC §4.1：至少 12 個） */
export const AVATARS: { id: string; emoji: string; bg: string; label: string }[] = [
  { id: 'fox', emoji: '🦊', bg: '#ffd8b5', label: '狐狸' },
  { id: 'panda', emoji: '🐼', bg: '#e6eef0', label: '熊貓' },
  { id: 'cat', emoji: '🐱', bg: '#ffe9a8', label: '貓咪' },
  { id: 'dog', emoji: '🐶', bg: '#f3dcc4', label: '小狗' },
  { id: 'owl', emoji: '🦉', bg: '#e2d5f5', label: '貓頭鷹' },
  { id: 'penguin', emoji: '🐧', bg: '#cfe8ff', label: '企鵝' },
  { id: 'frog', emoji: '🐸', bg: '#d4f5cf', label: '青蛙' },
  { id: 'tiger', emoji: '🐯', bg: '#ffe0a3', label: '老虎' },
  { id: 'rabbit', emoji: '🐰', bg: '#fde0ec', label: '兔子' },
  { id: 'koala', emoji: '🐨', bg: '#dde3e8', label: '無尾熊' },
  { id: 'octopus', emoji: '🐙', bg: '#ffd0d6', label: '章魚' },
  { id: 'eagle', emoji: '🦅', bg: '#e8dccb', label: '老鷹' },
  { id: 'unicorn', emoji: '🦄', bg: '#f1dcff', label: '獨角獸' },
  { id: 'dino', emoji: '🦖', bg: '#c9f0d9', label: '恐龍' },
  { id: 'robot', emoji: '🤖', bg: '#d6e4ee', label: '機器人' },
  { id: 'alien', emoji: '👾', bg: '#e0d9ff', label: '外星人' },
];
export const avatarById = (id: string) => AVATARS.find((a) => a.id === id) ?? AVATARS[0];

/** 隊伍色盤：顏色＋隊名＋圖示（不可只用顏色傳達身分） */
export const TEAM_PALETTE: { name: string; color: string; icon: string }[] = [
  { name: '紅隼隊', color: '#d64545', icon: '▲' },
  { name: '藍鷹隊', color: '#2f6fd6', icon: '●' },
  { name: '綠蜂隊', color: '#2e9d5b', icon: '■' },
  { name: '黃蜓隊', color: '#c99a06', icon: '★' },
  { name: '紫燕隊', color: '#8a4fd1', icon: '◆' },
  { name: '青鷺隊', color: '#138a95', icon: '✚' },
  { name: '粉雀隊', color: '#d14f95', icon: '♥' },
  { name: '棕鴞隊', color: '#8a5a33', icon: '⬟' },
  { name: '靛鶴隊', color: '#4a4fb8', icon: '✦' },
  { name: '墨鴉隊', color: '#3d4a52', icon: '⬢' },
  { name: '橄欖隊', color: '#6b7f1f', icon: '♣' },
  { name: '珊瑚隊', color: '#d4663a', icon: '♠' },
];
export const teamStyle = (i: number) => {
  const p = TEAM_PALETTE[i % TEAM_PALETTE.length];
  const cycle = Math.floor(i / TEAM_PALETTE.length);
  return cycle === 0 ? p : { ...p, name: p.name.replace('隊', `${cycle + 1}隊`) };
};
