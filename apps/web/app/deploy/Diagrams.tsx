import { withCode } from '../../lib/inline-code';
import styles from './deploy.module.css';

/** 포트 칩: 열림(보안 그룹 통과) / 닫힘(서버 안에서만) */
function Port({ port, open = false }: { port: string; open?: boolean }) {
  return (
    <span className={open ? styles.portOpen : styles.portClosed}>
      <code>{port}</code> {open ? '열림' : '안쪽만'}
    </span>
  );
}

/** (A) 요청 흐름: 브라우저 → sslip.io → 보안 그룹 → Caddy → API → Redis / MySQL */
export function RequestDiagram() {
  return (
    <figure className={styles.diagram}>
      <div className={styles.request}>
        <div className={`${styles.box} ${styles.browser}`}>
          <b>브라우저 · Vercel 화면</b>
          <small>
            <code>https://&lt;IP-대시&gt;.sslip.io</code>로 API 부르기
          </small>
        </div>
        <p className={styles.arrowDown}>sslip.io가 주소 안 숫자를 IP로 바꿔 줌 ↓</p>
        <div className={styles.ec2}>
          <p className={styles.ec2Label}>
            AWS 서버(EC2) · 보안 그룹: <Port port="80" open /> <Port port="443" open />{' '}
            <span className={styles.portOpen}>
              <code>22</code> SSH 개인 키 전용
            </span>
          </p>
          <div className={`${styles.box} ${styles.caddy}`}>
            <b>Caddy (문지기)</b>
            <small>
              http는 https로 돌려보냄 · HTTPS 풀기 · <code>upstream.caddy</code>에 적힌 색으로 전달
            </small>
          </div>
          <p className={styles.arrowDown}>지금 서비스 중인 색으로 ↓</p>
          <div className={styles.pair}>
            <div className={`${styles.box} ${styles.blue}`}>
              <b>api_blue</b>
              <small>지금 서비스 중</small>
              <Port port="4000" />
            </div>
            <div className={`${styles.box} ${styles.green}`}>
              <b>api_green</b>
              <small>쉬는 중 · 다음 배포 때 켜짐</small>
              <Port port="4000" />
            </div>
          </div>
          <p className={styles.arrowDown}>Docker 내부 네트워크 ↓</p>
          <div className={styles.pair}>
            <div className={`${styles.box} ${styles.db}`}>
              <b>Redis</b>
              <small>캐시</small>
              <Port port="6379" />
            </div>
            <div className={`${styles.box} ${styles.db}`}>
              <b>MySQL</b>
              <small>서버 안에서만 · 매일 04:00 백업</small>
              <Port port="3306" />
            </div>
          </div>
        </div>
        <p className={styles.arrowDown}>↑ 응답은 같은 길로 Caddy를 거쳐 브라우저로</p>
      </div>
      <figcaption>
        손님 요청은 Caddy라는 문 하나(443)로만 들어오고, API · 캐시 · DB는 서버 안쪽에서만 서로
        이야기해요.
      </figcaption>
      <details className={styles.fold}>
        <summary>포트와 길 자세히 보기</summary>
        <div className={styles.foldBody}>
          <div className={styles.ports}>
            {PORT_GROUPS.map((group) => (
              <section key={group.title}>
                <p className={styles.portsTitle}>{group.title}</p>
                <dl>
                  {group.ports.map((port) => (
                    <div key={port.port}>
                      <dt>
                        <code>{port.port}</code> {port.name}
                      </dt>
                      <dd>{withCode(port.note)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <p className={styles.portsNote}>
              배포는 SSM으로 들어와서, 배포 때문에 열어 둔 포트는 없어요.
            </p>
          </div>
        </div>
      </details>
    </figure>
  );
}

/** 보안 그룹과 docker-compose.prod.yml 기준 */
const PORT_GROUPS = [
  {
    title: '밖에서 열린 포트 (보안 그룹)',
    ports: [
      {
        port: '22',
        name: 'SSH',
        note: '내 IP에서 내 개인 키로만. Workbench DB 터널 · 터미널 접속용',
      },
      { port: '80', name: 'HTTP', note: 'Caddy. 인증서 발급, 그리고 HTTPS로 돌려보내기' },
      { port: '443', name: 'HTTPS', note: 'Caddy. 서비스로 들어오는 유일한 입구' },
    ],
  },
  {
    title: '서버 안에서만 (밖에서 안 보임)',
    ports: [
      { port: '4000', name: 'API', note: 'Docker 내부망. `api_blue` · `api_green`' },
      { port: '6379', name: 'Redis', note: 'Docker 내부망' },
      { port: '3306', name: 'MySQL', note: '`127.0.0.1`에만 (SSH 터널로만 접속)' },
    ],
  },
] as const;

/** (B) 배포 흐름: deploy.yml(GitHub 쪽) → deploy/deploy.sh(서버 쪽) */
const PIPELINE = [
  { who: 'GitHub Actions', what: 'main에 push → CI 통과' },
  { who: 'GHCR', what: 'ARM 러너가 이미지 굽기 → push (`:SHA`)' },
  { who: 'OIDC 출입증', what: '신뢰 정책이 저장소 · 브랜치 확인' },
  { who: 'AWS', what: '1시간짜리 임시 키 (저장된 비밀키 없음)' },
  { who: 'SSM', what: '`send-command` → 권한 정책이 이 서버 + `AWS-RunShellScript`만 허락' },
  { who: '서버 · deploy.sh', what: '쉬던 색에 새 버전 띄우기' },
  { who: '서버 · deploy.sh', what: '`/health` 200 → Caddy가 새 색으로' },
  { who: '서버 · deploy.sh', what: '이전 색 끄기 → 결과를 Actions로' },
] as const;

/** OIDC → SSM 자세히 */
const ACCESS = [
  {
    what: '출입증 받기',
    detail: 'main 브랜치의 Actions가 GitHub에서 "이 저장소 main" 증명서(OIDC 토큰)를 받아요',
  },
  {
    what: 'AWS에 제출',
    detail:
      'IAM이 신뢰 정책으로 저장소 · 브랜치를 확인해요 (`repo:<오너>@<ID>/<저장소>@<ID>:ref:refs/heads/main`)',
  },
  { what: '임시 키 발급', detail: '1시간짜리 임시 키를 줘요. GitHub에 저장해 둔 비밀키는 없어요' },
  {
    what: '일 시키기',
    detail:
      '임시 키로 SSM에 "`deploy.sh` 실행"을 요청해요. 권한 정책이 이 서버 + `AWS-RunShellScript`만 허락해요',
  },
  {
    what: '서버에 전달',
    detail: 'SSM이 서버의 에이전트에 넘기고, `deploy.sh`가 blue-green을 시작해요',
  },
  { what: '결과 돌려받기', detail: '실행 결과와 로그를 Actions가 받아 와서 성공/실패를 표시해요' },
] as const;

/** deploy/deploy.sh가 하는 일. 시간은 2026-10-21 Deploy 기록 (새 이미지 #8 / 이미지 그대로 #9~#11) */
const SWAP = [
  {
    what: '새 이미지 받기',
    detail: 'GitHub가 구워 둔 이번 버전을 받아요. 새로 구운 이미지면 19초, 그대로면 2~3초',
  },
  {
    what: '쉬던 쪽에 켜기',
    detail:
      '손님이 없는 `api_green`에 새 버전을 켜요. 켜지면서 DB 구조 변경(마이그레이션)을 한 번 해요',
  },
  {
    what: '건강한지 확인',
    detail: '서버 안쪽에서 `/health`가 200이 될 때까지 2초마다 물어봐요. 4~8초',
  },
  {
    what: '문 바꾸기',
    detail: 'Caddy가 보낼 곳을 `api_green`으로 바꾸고 설정만 다시 읽어요. 연결은 안 끊겨요',
  },
  { what: '하던 일 마무리', detail: '`api_blue`가 처리 중이던 요청이 끝나게 10초 기다려요' },
  { what: '예전 쪽 끄기', detail: '`api_blue`를 꺼요. 다음 배포 때는 이쪽이 "쉬던 쪽"이 돼요' },
] as const;

/** 번호 동그라미 */
function Marks({ steps }: { steps: number[] }) {
  return (
    <span className={styles.marks} aria-hidden="true">
      {steps.map((step) => (
        <i key={step}>{step}</i>
      ))}
    </span>
  );
}

/** 번호 붙은 짧은 단계 목록 (OIDC → SSM, blue-green 교체) */
function StepList({
  title,
  steps,
}: {
  title: string;
  steps: readonly { what: string; detail: string }[];
}) {
  return (
    <div className={styles.swap}>
      <p className={styles.swapTitle}>{title}</p>
      <ol>
        {steps.map((step, index) => (
          <li key={step.what}>
            <Marks steps={[index + 1]} />
            <b>{step.what}</b>
            <span>{withCode(step.detail)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** (B) 배포 흐름 */
export function DeployDiagram() {
  return (
    <figure className={styles.diagram}>
      <ol className={styles.pipeline}>
        {PIPELINE.map((step, index) => (
          <li key={index}>
            <small>{step.who}</small>
            <span>{withCode(step.what)}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        OIDC는 출입증 받기, SSM은 출입증 들고 서버에 일 시키기. 새 버전이 건강할 때만 문을 바꿔서
        손님 요청은 안 끊겨요.
      </figcaption>
      <details className={styles.fold}>
        <summary>배포 단계 자세히 보기</summary>
        <div className={styles.foldBody}>
          <StepList title="출입증(OIDC) → 서버에 일 시키기(SSM)" steps={ACCESS} />
          <StepList title="서버 안의 blue-green 교체 (blue가 서비스 중일 때의 예)" steps={SWAP} />
          <p className={styles.swapSafe}>
            3에서 200이 안 나오면 4로 넘어가지 않아요. 손님은 계속 <code>api_blue</code>를 쓰고, 새
            쪽만 꺼져요. 배포 3번 동안 0.2초마다 찔러서 실패한 요청은 0번이었어요.
          </p>
        </div>
      </details>
    </figure>
  );
}
