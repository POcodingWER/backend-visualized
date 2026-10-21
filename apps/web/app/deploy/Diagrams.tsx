import { withCode } from '../../lib/inline-code';
import styles from './deploy.module.css';

/** 지금 돌아가는 모습: 화면은 Vercel, API는 EC2 한 대 안의 Docker 네트워크 */
export function RuntimeDiagram() {
  return (
    <figure className={styles.diagram}>
      <div className={styles.runtime}>
        <div className={`${styles.box} ${styles.browser}`}>
          <b>브라우저</b>
          <small>사용자의 폰 · 노트북</small>
        </div>

        <div className={styles.branch}>
          <p className={styles.arrowDown}>페이지 받기 ↓</p>
          <div className={`${styles.box} ${styles.vercel}`}>
            <b>Vercel</b>
            <span>Next.js 화면</span>
            <small>backend-visualized.vercel.app</small>
          </div>
        </div>

        <div className={styles.branch}>
          <p className={styles.arrowDown}>API 부르기 · HTTPS 443 ↓</p>
          <div className={styles.ec2}>
            <p className={styles.ec2Label}>
              EC2 t4g.small · 고정 IP(Elastic IP) · 열린 문은 아래 표
            </p>
            <div className={`${styles.box} ${styles.caddy}`}>
              <Marks steps={[4]} />
              <b>Caddy :443</b>
              <small>인증서 · sslip.io 주소</small>
            </div>
            <p className={styles.arrowDown}>지금 서비스 중인 색으로 ↓</p>
            <div className={styles.pair}>
              <div className={`${styles.box} ${styles.blue}`}>
                <Marks steps={[5, 6]} />
                <b>api_blue :4000</b>
                <small>NestJS · 지금 서비스 중</small>
              </div>
              <div className={`${styles.box} ${styles.green}`}>
                <Marks steps={[1, 2, 3]} />
                <b>api_green :4000</b>
                <small>쉬는 중 · 다음 배포 때 켜짐</small>
              </div>
            </div>
            <p className={styles.arrowDown}>Docker 내부 네트워크 (밖에서 안 보임) ↓</p>
            <div className={styles.pair}>
              <div className={`${styles.box} ${styles.db}`}>
                <b>MySQL 8.4</b>
                <small>127.0.0.1:3306만 · 매일 04:00 백업</small>
              </div>
              <div className={`${styles.box} ${styles.db}`}>
                <b>Redis 7.4</b>
                <small>캐시 64MB</small>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.swap}>
        <p className={styles.swapTitle}>
          끊기지 않는 배포(blue-green): 서버 안에서 일어나는 순서. 번호는 위 그림의 동그라미예요
          (blue가 서비스 중일 때의 예).
        </p>
        <ol>
          {SWAP.map((step, index) => (
            <li key={step.what}>
              <Marks steps={[index + 1]} />
              <b>{step.what}</b>
              <span>{withCode(step.detail)}</span>
            </li>
          ))}
        </ol>
        <p className={styles.swapSafe}>
          3에서 200이 안 나오면 4로 넘어가지 않아요. 손님은 계속 <code>api_blue</code>를 쓰고, 새
          쪽만 꺼져요. 배포 3번 동안 0.2초마다 찔러서 실패한 요청은 0번이었어요.
        </p>
      </div>
      <div className={styles.ports}>
        <section>
          <p className={styles.portsTitle}>밖에서 열린 포트 (보안 그룹)</p>
          <dl>
            {PORTS.open.map((port) => (
              <div key={port.port}>
                <dt>
                  <code>{port.port}</code> {port.name}
                </dt>
                <dd>{withCode(port.note)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <p className={styles.portsTitle}>서버 안에서만 (밖에서 안 보임)</p>
          <dl>
            {PORTS.inside.map((port) => (
              <div key={port.port}>
                <dt>
                  <code>{port.port}</code> {port.name}
                </dt>
                <dd>{withCode(port.note)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className={styles.portsNote}>
          배포는 SSM으로 들어와서, 배포 때문에 열어 둔 포트는 없어요.
        </p>
      </div>
      <figcaption>
        화면과 API는 따로 살아요. 손님 요청이 서버로 들어오는 길은 Caddy(443) 하나이고, API · MySQL
        · Redis는 서버 안쪽 네트워크에서만 서로 이야기해요.
      </figcaption>
    </figure>
  );
}

/** 보안 그룹과 docker-compose 기준 포트 */
const PORTS = {
  open: [
    { port: '22', name: 'SSH', note: '내 IP에서 내 키로만. Workbench DB 터널 · 터미널 접속용' },
    { port: '80', name: 'HTTP', note: 'Caddy. 인증서 발급, 그리고 HTTPS로 넘기기' },
    { port: '443', name: 'HTTPS', note: 'Caddy. 서비스로 들어오는 유일한 입구' },
  ],
  inside: [
    { port: '4000', name: 'API', note: 'Docker 내부망. `api_blue` · `api_green`' },
    { port: '3306', name: 'MySQL', note: '`127.0.0.1`에만 (SSH 터널로만 접속)' },
    { port: '6379', name: 'Redis', note: 'Docker 내부망' },
  ],
} as const;

/** 그림 속 번호 동그라미 (blue-green 교체 순서) */
function Marks({ steps }: { steps: number[] }) {
  return (
    <span className={styles.marks} aria-hidden="true">
      {steps.map((step) => (
        <i key={step}>{step}</i>
      ))}
    </span>
  );
}

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

const PIPELINE = [
  { who: '내 맥', what: '`git push origin main`' },
  { who: 'GitHub', what: 'CI: 포맷 · 타입 · 린트 · 테스트 · 빌드' },
  { who: 'GitHub', what: 'ARM 러너가 이미지 굽기 → GHCR (`:SHA`, `:main`)' },
  { who: 'GitHub → AWS', what: 'OIDC 증명서 → 1시간짜리 배포 역할' },
  { who: 'AWS', what: 'SSM `send-command` → 서버의 SSM Agent' },
  { who: '서버', what: '`deploy.sh`: 이미지 받기 → 쉬던 색에 띄우기' },
  { who: '서버', what: '`/health` 200 확인 → Caddy 문 바꾸기 → 옛 색 끄기' },
  { who: 'GitHub', what: '바깥에서 `https://…/health` 200 확인' },
] as const;

/** OIDC → SSM: deploy.yml의 deploy job (계정 ID는 자리표시자) */
const ACCESS = [
  {
    what: '출입증 받기',
    detail: 'main 브랜치의 Actions가 GitHub에서 "이 저장소 main" 증명서(OIDC 토큰)를 받아요',
  },
  {
    what: 'AWS에 제출',
    detail:
      'IAM이 신뢰 정책으로 저장소·브랜치를 확인해요 (`repo:<오너>@<ID>/<저장소>@<ID>:ref:refs/heads/main`)',
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

/** 배포가 흘러가는 순서 */
export function PipelineDiagram() {
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
      <div className={styles.swap}>
        <p className={styles.swapTitle}>
          위 4·5번 자세히: OIDC는 출입증 받기, SSM은 출입증 들고 서버에 일 시키기.
        </p>
        <ol>
          {ACCESS.map((step, index) => (
            <li key={step.what}>
              <Marks steps={[index + 1]} />
              <b>{step.what}</b>
              <span>{withCode(step.detail)}</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption>
        main에 push하면 사람 손 없이 여기까지 가요. 중간 어디서 실패하면 Caddy는 계속 예전 색을 보고
        있어서 서비스는 그대로예요.
      </figcaption>
    </figure>
  );
}
