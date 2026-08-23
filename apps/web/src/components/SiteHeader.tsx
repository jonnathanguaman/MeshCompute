'use client';

import { Activity, Cpu, Handshake, LayoutDashboard, LogIn, LogOut, Network } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

const links = [
  { href: '/providers', label: 'Providers', icon: Cpu },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, ready, logout } = useAuth();
  const portalHref = user?.role === 'PROVIDER' ? '/portal/provider' : '/portal/client';

  return (
    <header className="site-header">
      <div className="page-shell header-inner">
        <Link href="/" className="brand" aria-label="MeshCompute home">
          <span className="brand-mark"><Network size={19} /></span>
          <span>MeshCompute</span>
        </Link>
        <nav className="main-nav" aria-label="Primary navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={pathname.startsWith(href) ? 'nav-link nav-link-active' : 'nav-link'}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
          {ready && user && (
            <Link
              href={portalHref}
              className={pathname.startsWith('/portal') ? 'nav-link nav-link-active' : 'nav-link'}
            >
              <Handshake size={15} />
              My portal
            </Link>
          )}
        </nav>
        <div className="header-session">
          <div className="network-pill"><Activity size={14} /> QVAC P2P</div>
          {ready && user ? (
            <>
              <span className="session-user">{user.displayName}</span>
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  logout();
                  router.push('/');
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className={pathname.startsWith('/login') ? 'nav-link nav-link-active' : 'nav-link'}
            >
              <LogIn size={15} /> Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
