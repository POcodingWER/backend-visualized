'use client';

import { useEffect, useState } from 'react';
import styles from './auth.module.css';

export const LOCAL_STORAGE_KEY = 'bv_demo_access_token';
const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.demo-access-token.signature';

export type StorageKind = 'localStorage' | 'memory' | 'httpOnlyCookie';

export interface AttackOutcome {
  stolen: boolean;
  detail: string;
}

/**
 * 주입된 스크립트가 할 수 있는 일만으로 토큰을 읽어 본다 (전역 객체와 document 접근).
 * localStorage에는 데모용 가짜 토큰을 넣어 둔다 (StorageComparison이 페이지를 떠날 때 지움).
 */
export function readTokensLikeXss(): Record<StorageKind, AttackOutcome> {
  localStorage.setItem(LOCAL_STORAGE_KEY, FAKE_TOKEN);
  const fromLocalStorage = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  const fromGlobal = (window as unknown as Record<string, unknown>).accessToken;
  const cookieVisible = document.cookie;
  return {
    localStorage: fromLocalStorage
      ? { stolen: true, detail: `localStorage.getItem → "${fromLocalStorage.slice(0, 24)}…"` }
      : { stolen: false, detail: '없음' },
    memory: fromGlobal
      ? { stolen: true, detail: 'window.accessToken 노출' }
      : {
          stolen: false,
          detail: 'window.accessToken → undefined (토큰은 컴포넌트 내부 변수에만 있음)',
        },
    httpOnlyCookie: cookieVisible.includes('bv_refresh_token')
      ? { stolen: true, detail: 'document.cookie에 노출됨' }
      : {
          stolen: false,
          detail: `document.cookie → "${cookieVisible || '(빈 문자열)'}" — bv_refresh_token 없음`,
        },
  };
}

const ROWS: { kind: StorageKind; title: string; xss: string; csrf: string; note: string }[] = [
  {
    kind: 'localStorage',
    title: 'localStorage',
    xss: '취약: 페이지에서 실행되는 모든 JS가 읽을 수 있음',
    csrf: '안전: 자동 전송되지 않음',
    note: '새로고침해도 유지되지만, XSS 한 번이면 토큰이 밖으로 유출됩니다.',
  },
  {
    kind: 'memory',
    title: '메모리 (JS 변수)',
    xss: '덜 취약: 전역에 없으면 읽기 어려움 (단, 열린 페이지에서 API 호출은 대신 할 수 있음)',
    csrf: '안전: 자동 전송되지 않음',
    note: '새로고침하면 사라짐 → 리프레시 쿠키로 다시 받아옵니다. 이 데모의 액세스 토큰 방식.',
  },
  {
    kind: 'httpOnlyCookie',
    title: 'httpOnly 쿠키',
    xss: '안전: document.cookie로 읽을 수 없음',
    csrf: '주의: 브라우저가 자동 전송 → SameSite=Lax, 경로 제한(/auth), CORS로 응답 읽기 차단',
    note: '이 데모의 리프레시 토큰 방식. 탈취돼도 회전 + 재사용 감지로 피해를 줄입니다.',
  },
];

/** "XSS 스크립트가 토큰을 읽으려 한다" — 브라우저에서 실제로 시도 */
export default function StorageComparison() {
  const [outcomes, setOutcomes] = useState<Partial<Record<StorageKind, AttackOutcome>>>({});

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, FAKE_TOKEN);
    return () => localStorage.removeItem(LOCAL_STORAGE_KEY);
  }, []);

  const runXss = () => setOutcomes(readTokensLikeXss());

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>④ 토큰을 어디에 보관할까? (XSS / CSRF)</h2>
        <button className={styles.primary} onClick={runXss}>
          XSS 스크립트 실행
        </button>
      </div>
      <p className={styles.muted}>
        버튼을 누르면 이 페이지에 주입된 악성 스크립트처럼 <code>localStorage</code>, 전역 변수,{' '}
        <code>document.cookie</code>를 실제로 읽어 봅니다. (localStorage에는 데모용 가짜 토큰을 넣어
        두었고, 페이지를 떠나면 지웁니다)
      </p>
      <div className={styles.storageGrid}>
        {ROWS.map((row) => {
          const outcome = outcomes[row.kind];
          return (
            <div
              key={row.kind}
              className={`${styles.storageCard} ${outcome ? (outcome.stolen ? styles.storageStolen : styles.storageSafe) : ''}`}
            >
              <h3>{row.title}</h3>
              {outcome && (
                <p className={outcome.stolen ? styles.badText : styles.okText}>
                  {outcome.stolen ? '탈취 성공' : '읽기 실패'}{' '}
                  <span className={styles.mono}>{outcome.detail}</span>
                </p>
              )}
              <p>
                <b>XSS:</b> {row.xss}
              </p>
              <p>
                <b>CSRF:</b> {row.csrf}
              </p>
              <p className={styles.muted}>{row.note}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
