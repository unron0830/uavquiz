import { avatarById } from '@uqa/shared';
import { apiUrl } from '../lib/api';
export function Avatar({ id, size = 48, ring }: { id: string; size?: number; ring?: string }) {
  const a = avatarById(id);
  const uploaded = /^upload:[a-f0-9]{32}$/.test(id);
  return (
    <span className="avatar" role="img" aria-label={uploaded ? '自訂頭像' : a.label}
      style={{ width: size, height: size, fontSize: size * 0.58, background: a.bg, boxShadow: ring ? `0 0 0 ${Math.max(2, size / 16)}px ${ring}` : undefined }}>
      {uploaded ? <img src={apiUrl(`/public/avatar?id=${id.slice(7)}`)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : a.emoji}
    </span>
  );
}
export function TeamChip({ team, small }: { team: { name: string; color: string; icon: string } | null | undefined; small?: boolean }) {
  if (!team) return <span className={`team-chip muted${small ? ' small' : ''}`}>未分隊</span>;
  return (
    <span className={`team-chip${small ? ' small' : ''}`} style={{ background: team.color }}>
      <span aria-hidden>{team.icon}</span> {team.name}
    </span>
  );
}
