import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** 極簡 hash 路由（#/play/123456）：IIS 不需要 URL Rewrite，放在任何目錄都能用 */
const current = () => { const h = location.hash.replace(/^#/, '') || '/'; const i = h.indexOf('?'); return i >= 0 ? h.slice(0, i) : h; };
export const hashQuery = () => { const h = location.hash; const i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
const Ctx = createContext<{ path: string; params: Record<string, string> }>({ path: '/', params: {} });

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = '#' + to;
  opts.replace ? history.replaceState(null, '', url) : history.pushState(null, '', url);
  window.dispatchEvent(new Event('uqa:navigate'));
}

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Router({ routes, fallback }: { routes: [string, () => ReactNode][]; fallback: ReactNode }) {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const f = () => setPath(current());
    window.addEventListener('hashchange', f);
    window.addEventListener('popstate', f);
    window.addEventListener('uqa:navigate', f);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('popstate', f); window.removeEventListener('uqa:navigate', f); };
  }, []);
  for (const [pattern, render] of routes) {
    const params = match(pattern, path);
    if (params) return <Ctx.Provider value={{ path, params }}>{render()}</Ctx.Provider>;
  }
  return <>{fallback}</>;
}

export const useParams = () => useContext(Ctx).params;
export const usePath = () => useContext(Ctx).path;

export function Link({ to, className, activeClass, exact, children, ...rest }: { to: string; activeClass?: string; exact?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const path = usePath();
  const active = activeClass && (exact ? path === to : path === to || path.startsWith(to + '/'));
  return (
    <a {...rest} href={'#' + to} className={[className, active ? activeClass : ''].filter(Boolean).join(' ') || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || rest.target) return; e.preventDefault(); navigate(to); }}>
      {children}
    </a>
  );
}
