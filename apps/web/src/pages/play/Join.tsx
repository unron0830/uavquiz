import { useEffect, useState } from 'react';
import { navigate, useParams, hashQuery, Link } from '../../lib/router';
import { AVATARS, validateNickname } from '@uqa/shared';
import { api } from '../../lib/api';
import { unlockAudio } from '../../lib/sound';
import { uploadAvatar } from '../../lib/avatar-upload';
import { Avatar } from '../../components/Avatar';

export const testerNumber = () => { const n = hashQuery().get('tester'); return n && /^[1-5]$/.test(n) ? n : ''; };
export const testerSuffix = () => testerNumber() ? `?tester=${testerNumber()}` : '';
export const tokenKey = (code: string) => `uqa:${code}${testerNumber() ? `:tester:${testerNumber()}` : ''}`;
export function loadToken(code: string): string | null { try { return localStorage.getItem(tokenKey(code)); } catch { return null; } }
export function saveToken(code: string, t: string | null) { try { t ? localStorage.setItem(tokenKey(code), t) : localStorage.removeItem(tokenKey(code)); } catch { /* ignore */ } }

export default function Join() {
  const { code: codeParam } = useParams();
  const nav = navigate;
  useEffect(() => { document.title = testerNumber() ? `測試者 ${testerNumber()}｜加入比賽` : '學生加入｜無人機知識王'; }, []);
  const [code, setCode] = useState(codeParam ?? '');
  const [info, setInfo] = useState<{ courseTitle: string; rosterLocked: boolean; allowLateJoin: boolean } | null>(null);
  const [nick, setNick] = useState(() => { try { return testerNumber() ? `測試者 ${testerNumber()}` : localStorage.getItem('uqa:nick') ?? ''; } catch { return ''; } });
  const [avatar, setAvatar] = useState(() => AVATARS[Math.floor(Math.random() * AVATARS.length)].id);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [customAvatar, setCustomAvatar] = useState('');

  useEffect(() => {
    setInfo(null); setErr('');
    if (!codeParam) return;
    if (!/^\d{6}$/.test(codeParam)) { setErr('場次代碼是 6 位數字'); return; }
    if (loadToken(codeParam)) { nav(`/play/${codeParam}${testerSuffix()}`, { replace: true }); return; }
    api(`/public/session/${codeParam}`).then(setInfo).catch((e) => setErr(e.message));
  }, [codeParam, nav]);

  if (!codeParam) {
    return (
      <div className="play play-join">
        <h1 className="brand-title small"><span>無人機</span>知識王</h1>
        <form className="join-card" onSubmit={async (e) => {
          e.preventDefault();
          if (!/^\d{6}$/.test(code)) return setErr('請輸入完整的 6 位數字代碼');
          setBusy(true); setErr('');
          try {
            const session = await api<{ rosterLocked: boolean; allowLateJoin: boolean }>(`/public/session/${code}`);
            if (session.rosterLocked && !session.allowLateJoin && !loadToken(code)) throw new Error('這個場次已開始，請洽主持人開放中途加入');
            nav(`/join/${code}${testerSuffix()}`);
          } catch (error) { setErr(error instanceof Error ? error.message : '找不到場次，請確認代碼'); }
          finally { setBusy(false); }
        }}>
          <h2>輸入場次代碼</h2>
          <p className="hint">不用掃 QR Code，也可以輸入投影幕上的 6 位數字加入。</p>
          <label htmlFor="code">6 位數字代碼</label>
          <input id="code" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, 6)); setErr(''); }} className="code-input" placeholder="例如 123456" aria-describedby="code-help" />
          <p id="code-help" className="hint">每場最多 100 人。確認代碼後，再填寫學號、姓名或暱稱並選擇頭像。</p>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn3d big" type="submit" disabled={busy}>{busy ? '確認場次中…' : '確認代碼，下一步'}</button>
        </form>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (uploading) return;
    const v = validateNickname(nick);
    if (v) return setErr(v);
    setBusy(true); setErr('');
    try {
      const r = await api<{ token: string }>('/public/join', { body: { code: codeParam, nickname: nick, avatar } });
      saveToken(codeParam, r.token);
      try { localStorage.setItem('uqa:nick', nick.trim()); } catch { /* ignore */ }
      nav(`/play/${codeParam}${testerSuffix()}`, { replace: true });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="play play-join">
      <h1 className="brand-title small"><span>無人機</span>知識王</h1>
      {info && <p className="join-course">{info.courseTitle}</p>}
      <p>場次代碼：<b>{codeParam}</b>　<Link to={`/join${testerSuffix()}`}>改輸入其他代碼</Link></p>
      <form className="join-card" onSubmit={submit}>
        <label htmlFor="nick">學號／姓名／暱稱</label>
        <input id="nick" value={nick} maxLength={64} onChange={(e) => setNick(e.target.value)} placeholder="輸入學號、真名或暱稱（2–32 字）" autoComplete="off" />
        <p className="hint">擇一填寫即可，將用於排行榜與作答紀錄。</p>
        <fieldset className="avatar-pick">
          <legend>選一個頭像</legend>
          {AVATARS.map((a) => (
            <label key={a.id} className={`av-opt${avatar === a.id ? ' on' : ''}`} style={{ background: a.bg }}>
              <input type="radio" name="avatar" value={a.id} checked={avatar === a.id} onChange={() => setAvatar(a.id)} />
              <span aria-hidden>{a.emoji}</span><span className="sr">{a.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="avatar-upload">
          <label htmlFor="avatar-file">自行上傳頭像</label>
          <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || busy || !info} onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setUploading(true); setErr('');
            try { const uploaded = await uploadAvatar(file, codeParam); setCustomAvatar(uploaded); setAvatar(uploaded); }
            catch (error) { setErr(error instanceof Error ? error.message : '上傳失敗，請換一張圖片'); }
            finally { setUploading(false); }
          }} />
          <p className="hint">PNG、JPG 或 WebP，最大 5 MB，會自動裁成正方形小頭像。</p>
          {uploading && <p role="status">正在處理頭像…</p>}
          {customAvatar && <label className="check"><input type="radio" name="avatar" checked={avatar === customAvatar} onChange={() => setAvatar(customAvatar)} /><Avatar id={customAvatar} size={64} />使用上傳頭像</label>}
        </div>
        {info?.rosterLocked && !info.allowLateJoin && <p className="err">比賽已開始，名單已鎖定。</p>}
        {info?.rosterLocked && info.allowLateJoin && <p className="note">比賽進行中，你會以「中途加入」參賽，只計個人成績。</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn3d big" type="submit" disabled={busy || uploading || !info}>{busy ? '加入中…' : '加入比賽'}</button>
      </form>
    </div>
  );
}
