'use client';

import { useEffect, useMemo, useState } from 'react';
import { authApi, errorReason, REASON_KO } from './api';
import styles from './auth.module.css';

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown> & { exp?: number; iat?: number };
  signature: string;
}

function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: decodeSegment(parts[0]!) as DecodedJwt['header'],
      payload: decodeSegment(parts[1]!) as DecodedJwt['payload'],
      signature: parts[2]!,
    };
  } catch {
    return null;
  }
}

/** JWT 디코더: header.payload.signature 를 나눠 보여주고 exp 카운트다운 */
export default function JwtDecoder({ accessToken }: { accessToken: string | null }) {
  const [input, setInput] = useState('');
  const [editedByUser, setEditedByUser] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (accessToken && !editedByUser) setInput(accessToken);
  }, [accessToken, editedByUser]);
  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(intervalId);
  }, []);
  useEffect(() => setVerification(null), [input]);

  const decoded = useMemo(() => decodeJwt(input), [input]);
  const [headerPart, payloadPart, signaturePart] = input.trim().split('.');
  const expiresInSeconds = decoded?.payload.exp ? decoded.payload.exp - nowMs / 1000 : null;

  const verify = async () => {
    const response = await authApi.me(input.trim());
    setVerification(
      response.ok
        ? '서버가 서명과 만료를 확인했습니다 (200)'
        : `${response.status}: ${REASON_KO[errorReason(response.body)] ?? errorReason(response.body)}`,
    );
  };

  return (
    <section className={styles.card}>
      <h2>⑤ JWT 디코더</h2>
      <p className={styles.muted}>
        JWT는 암호화가 아니라 <b>서명</b>입니다. header와 payload는 누구나 base64로 풀어 볼 수 있고,
        서명은 서버의 비밀키 (HS256)로만 확인할 수 있습니다. 그래서 payload에 비밀번호 같은 민감
        정보를 넣으면 안 됩니다.
      </p>
      <textarea
        className={styles.jwtInput}
        value={input}
        placeholder="로그인하면 현재 액세스 토큰이 들어옵니다. 다른 JWT를 붙여 넣어도 됩니다."
        onChange={(changeEvent) => {
          setInput(changeEvent.target.value);
          setEditedByUser(true);
        }}
      />
      {input && (
        <p className={styles.jwtColored}>
          <span className={styles.jwtHeader}>{headerPart}</span>.
          <span className={styles.jwtPayload}>{payloadPart}</span>.
          <span className={styles.jwtSignature}>{signaturePart}</span>
        </p>
      )}
      {decoded ? (
        <div className={styles.jwtGrid}>
          <div>
            <h3 className={styles.jwtHeader}>HEADER</h3>
            <pre className={styles.pre}>{JSON.stringify(decoded.header, null, 2)}</pre>
          </div>
          <div>
            <h3 className={styles.jwtPayload}>PAYLOAD</h3>
            <pre className={styles.pre}>{JSON.stringify(decoded.payload, null, 2)}</pre>
            {decoded.payload.iat && (
              <p className={styles.muted}>
                iat: {new Date(decoded.payload.iat * 1000).toLocaleTimeString('ko-KR')}
              </p>
            )}
            {expiresInSeconds !== null && (
              <p className={expiresInSeconds > 0 ? styles.okText : styles.badText}>
                exp:{' '}
                {expiresInSeconds > 0
                  ? `${expiresInSeconds.toFixed(1)}초 후 만료`
                  : `${(-expiresInSeconds).toFixed(0)}초 전에 만료됨`}
              </p>
            )}
          </div>
          <div>
            <h3 className={styles.jwtSignature}>SIGNATURE</h3>
            <p className={styles.mono}>{decoded.signature.slice(0, 20)}…</p>
            <p className={styles.muted}>
              HMAC-SHA256(header.payload, 서버 비밀키). 브라우저에는 비밀키가 없으므로 검증은
              서버에서.
            </p>
            <button onClick={() => void verify()}>서버에 검증 요청 (GET /auth/me)</button>
            {verification && <p>{verification}</p>}
            {editedByUser && accessToken && (
              <button className={styles.ghost} onClick={() => setEditedByUser(false)}>
                현재 토큰으로 되돌리기
              </button>
            )}
          </div>
        </div>
      ) : (
        input && <p className={styles.badText}>JWT 형식이 아닙니다 (header.payload.signature)</p>
      )}
    </section>
  );
}
