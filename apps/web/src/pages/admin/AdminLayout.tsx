import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { Link, navigate } from '../../lib/router';

/** 老師頁面外框：檢查密碼登入狀態 */
export default function HostLayout({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ host: boolean }>('/auth/me').then((r) => { setOk(r.host); if (!r.host) navigate('/host/login', { replace: true }); }).catch(() => setOk(false));
  }, []);
  if (!ok) return <div className="admin-loading">載入中…</div>;
  return (
    <div className="admin">
      <aside className="side">
        <div className="side-brand"><span className="dot" aria-hidden /> 無人機知識王<small>老師</small></div>
        <nav>
          <Link to="/host" exact activeClass="active">開場</Link>
          <Link to="/records" activeClass="active">紀錄查詢</Link>
          <Link to="/host/feedback" activeClass="active">題目回饋</Link>
        </nav>
        <div className="side-user">
          <span />
          <button className="btn-link" onClick={async () => { await api('/auth/logout', { method: 'POST' }); navigate('/host/login'); }}>登出</button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
