import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/nunito';
import './styles.css';
import { Router, navigate } from './lib/router';
import Join from './pages/play/Join';
import Play from './pages/play/Play';

const Stage = lazy(() => import('./pages/stage/Stage'));
const HostLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Login = lazy(() => import('./pages/admin/Login'));
const Home = lazy(() => import('./pages/admin/Home'));
const Control = lazy(() => import('./pages/admin/Control'));
const Records = lazy(() => import('./pages/admin/Records'));
const Feedback = lazy(() => import('./pages/admin/Feedback'));
const RecordDetail = lazy(() => import('./pages/admin/Records').then((m) => ({ default: m.RecordDetail })));

function Redirect({ to }: { to: string }) { React.useEffect(() => navigate(to, { replace: true }), [to]); return null; }
const host = (el: React.ReactNode) => <HostLayout>{el}</HostLayout>;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="admin-loading">載入中…</div>}>
      <Router
        routes={[
          ['/', () => <Redirect to="/join" />],
          ['/join', () => <Join />],
          ['/join/:code', () => <Join />],
          ['/play/:code', () => <Play />],
          ['/stage/:id', () => <Stage />],
          ['/host/login', () => <Login />],
          ['/host', () => host(<Home />)],
          ['/host/control/:id', () => host(<Control />)],
          ['/host/feedback', () => host(<Feedback />)],
          ['/records', () => host(<Records />)],
          ['/records/:id', () => host(<RecordDetail />)],
          ['/admin', () => <Redirect to="/host" />],
        ]}
        fallback={<div className="admin-loading">找不到頁面</div>}
      />
    </Suspense>
  </React.StrictMode>,
);
