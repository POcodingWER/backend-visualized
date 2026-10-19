# Stage 3 — 액세스 토큰 / 리프레시 토큰 설계

페이지: `/auth` · 코드: [`apps/api/src/auth`](../apps/api/src/auth), [`apps/web/app/auth`](../apps/web/app/auth)

## 왜 토큰이 두 개인가

| 토큰          | 형식                      | 수명 (기본)                                                                  | 보관 위치                                                           | 용도                                    |
| ------------- | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| 액세스 토큰   | JWT (HS256)               | 20초 (`AUTH_ACCESS_TOKEN_TTL_SECONDS`, 데모에서 로그인 시 5~300초 지정 가능) | 브라우저 **메모리**                                                 | 모든 API 요청의 `Authorization: Bearer` |
| 리프레시 토큰 | 랜덤 32바이트 (base64url) | 24시간 (`AUTH_REFRESH_TOKEN_TTL_SECONDS`)                                    | **httpOnly 쿠키** `bv_refresh_token` (`Path=/auth`, `SameSite=Lax`) | 새 액세스 토큰 발급                     |

- 액세스 토큰은 서버가 DB 조회 없이 서명만으로 검증 → 빠르지만 **폐기할 방법이 없으므로 수명을 짧게**.
- 리프레시 토큰은 DB에 상태가 있어 **폐기 가능**. 원문은 쿠키에만 있고 DB에는 **SHA-256 해시**만 저장 (DB가 유출돼도 토큰으로 못 씀).

## API

| 메서드 | 경로                              | 설명                                                                                                                                                  |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`                     | `{ username, password, accessTokenTtlSeconds? }` → `{ user, accessToken, accessTokenExpiresAt, refreshToken(행 정보) }` + 리프레시 쿠키. 10회/분 제한 |
| GET    | `/auth/me`                        | Bearer 필요. 만료 시 `401 { reason: "access_token_expired" }`                                                                                         |
| POST   | `/auth/refresh`                   | 쿠키의 리프레시 토큰을 **회전**. 60회/10초 제한                                                                                                       |
| POST   | `/auth/logout`                    | 현재 패밀리 전체 폐기 + 쿠키 삭제                                                                                                                     |
| GET    | `/auth/families/:familyId`        | 회전 체인 조회 (해시 제외, 시각화용)                                                                                                                  |
| POST   | `/auth/demo/steal-refresh-token`  | **데모 전용**: 쿠키 값을 돌려줘 "탈취"를 재현 (`AUTH_DEMO_ENDPOINTS=false`로 끔)                                                                      |
| POST   | `/auth/demo/expired-access-token` | **데모 전용**: 서명은 맞지만 이미 만료된 액세스 토큰                                                                                                  |

실패 응답은 `{ statusCode: 401, reason, message }` 형태로 원인(`reason`)을 구분합니다.

## 리프레시 토큰 회전과 재사용 감지

```
login ─▶ RT1(active)
refresh(RT1) ─▶ RT1(used) ─▶ RT2(active)        같은 familyId, RT2.parentId = RT1
refresh(RT2) ─▶ RT2(used) ─▶ RT3(active)
refresh(RT1) ─▶ RT1은 이미 used → 재사용 감지 → family의 모든 토큰 revoked (reason=reuse_detected)
```

- 쓰인 토큰이 다시 온다 = 같은 토큰을 가진 사람이 둘 → 누가 진짜인지 모르므로 **패밀리 전체를 폐기**. 공격자와 사용자 모두 다시 로그인해야 하지만, 공격자가 훔친 토큰은 더 이상 쓸 수 없습니다.
- `active → used` 전환은 `UPDATE … WHERE id = ? AND status = 'active'` 조건부 갱신이라, 같은 토큰으로 동시에 여러 요청이 와도 **정확히 하나만** 회전에 성공합니다 (나머지는 재사용으로 처리).

## 동시 요청 문제와 single-flight

액세스 토큰이 만료된 상태에서 API 5개가 동시에 401을 받으면:

- **naive**: 각자 `/auth/refresh` → 같은 쿠키(RT_n)로 5번 요청 → 1번만 회전 성공, 나머지 4번은 재사용으로 감지 → **패밀리 폐기, 로그아웃**.
- **single-flight** ([`apps/web/lib/single-flight.ts`](../apps/web/lib/single-flight.ts)): 진행 중인 refresh Promise를 공유 → refresh 1번, 나머지는 결과를 기다렸다가 재시도.

실무에선 서버에 짧은 **유예 기간(grace period)** 을 두어 직전 토큰의 짧은 재사용을 허용하기도 하지만, 이 데모는 원리를 보여주기 위해 유예 없이 엄격하게 처리합니다.

## 보관 위치 (XSS / CSRF)

| 보관          | XSS                                                                   | CSRF                                                                              |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| localStorage  | 주입된 스크립트가 바로 읽음                                           | 자동 전송 안 됨                                                                   |
| 메모리        | 전역에 두지 않으면 읽기 어려움 (열린 페이지에서 API 대리 호출은 가능) | 자동 전송 안 됨                                                                   |
| httpOnly 쿠키 | `document.cookie`로 못 읽음                                           | 자동 전송 → `SameSite=Lax`, `Path=/auth`, CORS(응답을 다른 출처가 못 읽음)로 완화 |

이 데모: 액세스 토큰 = 메모리, 리프레시 토큰 = httpOnly 쿠키. API CORS는 `WEB_ORIGIN`만 허용하고 `credentials: true`.

## 테스트

- `apps/api/src/auth/refresh-token.store.spec.ts` (실제 MySQL): 회전 체인, 재사용 시 패밀리 폐기, 같은 토큰 동시 5회 → 1회만 성공, 알 수 없는 토큰 거부. 테스트 사용자는 끝나면 삭제.
- `apps/web/lib/single-flight.test.ts`: 동시 호출 공유, 완료 후 새 호출, 실패 공유.

## 운영 전 체크

- `JWT_ACCESS_SECRET` 반드시 설정 (기본값은 개발용), `NODE_ENV=production`이면 쿠키 `Secure`.
- `AUTH_DEMO_ENDPOINTS=false` (탈취/만료 토큰 데모 엔드포인트, 본문으로 리프레시 토큰 받기 비활성화).

## Reload recovery (silent refresh)

The access token lives only in JS memory (not localStorage) to limit XSS exposure, so it is gone after a page reload.
On mount, `/auth` calls `POST /auth/refresh` with `credentials: 'include'`; the browser attaches the httpOnly
`bv_refresh_token` cookie (localhost:3000 → localhost:4000 is same-site, so SameSite=Lax is sent; CORS allows
`http://localhost:3000` with credentials). 200 → session restored and the timeline logs
"새로고침 → 쿠키의 리프레시 토큰으로 액세스 토큰 복구"; 401 → logged-out state with the reason.

The refresh is a module-level single-flight shared by the mount effect and the 401-retry path, so React
StrictMode's double effect run (dev) sends **one** request. Two requests with the same refresh token would make the
second one look like reuse and revoke the whole family.
