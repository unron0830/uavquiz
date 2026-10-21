import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { navigate } from '../../lib/router';
export default function Login() {
 const [p,setP]=useState(''),[confirm,setConfirm]=useState(''),[token,setToken]=useState(''),[url,setUrl]=useState('');
 const [setup,setSetup]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 useEffect(()=>{document.title='主持後台｜無人機知識王';api<{required:boolean}>('/setup/status').then(s=>setSetup(s.required)).catch(e=>setErr(e.message));},[]);
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setErr('');setBusy(true);
  try {
   if(setup){if(p!==confirm)throw new Error('兩次密碼不一致。');await api('/setup/complete',{body:{setupToken:token,password:p,confirmPassword:confirm,publicBaseUrl:url}});setSetup(false);setToken('');setConfirm('');}
   await api('/auth/login',{body:{password:p}});navigate('/host',{replace:true});
  }catch(e){setErr((e as Error).message);}finally{setBusy(false);}
 };
 return <div className="login-wrap"><form className="login-card" onSubmit={submit}>
 <h1 className="brand-title small dark"><span>無人機</span>知識王</h1>
 {setup===null?<p>正在檢查網站設定…</p>:<>
 {setup&&<><h2>歡迎！首次設定主持後台</h2><p>為自己的網站設定主持人密碼。請先向伺服器管理者取得一次性設定碼。</p><label htmlFor="setup-token">首次設定碼</label><input id="setup-token" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" required/><p className="hint">取得設定碼的方式請參閱專案的中文 IIS 部署說明。</p></>}
 <label htmlFor="pw">{setup?'設定主持人密碼（12–128 字元）':'老師密碼'}</label>
 <input id="pw" type="password" minLength={setup?12:undefined} maxLength={128} value={p} onChange={e=>setP(e.target.value)} autoComplete={setup?'new-password':'current-password'} required/>
 {setup&&<><label htmlFor="confirm-pw">再次輸入密碼</label><input id="confirm-pw" type="password" minLength={12} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" required/><label htmlFor="public-url">學生可連線的網站網址（選填）</label><input id="public-url" type="url" placeholder="https://quiz.example.org/quiz" value={url} onChange={e=>setUrl(e.target.value)}/><p className="hint">包含網站子目錄；留空時使用目前網址產生 QR Code。</p></>}
 <button className="btn3d" disabled={busy} type="submit">{busy?'處理中…':setup?'完成設定並進入後台':'進入'}</button></>}
 {err&&<p className="err" role="alert">{err}</p>}
 </form></div>;
}

