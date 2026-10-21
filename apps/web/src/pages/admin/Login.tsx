import { useState } from 'react';
import { api } from '../../lib/api';
import { navigate } from '../../lib/router';

export default function Login() {
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api('/auth/login', { body: { password: p } }); navigate('/host', { replace: true }); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="brand-title small dark"><span>無人機</span>知識王</h1>
        <p>老師密碼</p>
        <label htmlFor="pw" className="sr">老師密碼</label>
        <input id="pw" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" autoFocus required />
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn3d" type="submit">進入</button>
      </form>
    </div>
  );
}
