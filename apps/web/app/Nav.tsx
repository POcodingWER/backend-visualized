'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: '① 이벤트 수집 파이프라인' },
  { href: '/coupon', label: '② 선착순 쿠폰 동시성' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav
      style={{
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'center',
        padding: '0.7rem 1.5rem',
        borderBottom: '1px solid #1c2547',
        background: 'rgba(11,16,32,0.85)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backdropFilter: 'blur(6px)',
      }}
    >
      <b style={{ marginRight: '1rem', color: '#818cf8' }}>backend-visualized</b>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          style={{
            color: path === link.href ? '#fff' : '#8b93b0',
            background: path === link.href ? '#1f2a52' : 'transparent',
            padding: '0.35rem 0.8rem',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
