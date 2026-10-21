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
              EC2 t4g.small · 3.35.59.193 · 밖으로 열린 문은 80/443뿐
            </p>
            <div className={`${styles.box} ${styles.caddy}`}>
              <b>Caddy :443</b>
              <small>인증서 · 3-35-59-193.sslip.io</small>
            </div>
            <p className={styles.arrowDown}>지금 서비스 중인 색으로 ↓</p>
            <div className={styles.pair}>
              <div className={`${styles.box} ${styles.blue}`}>
                <b>api_blue :4000</b>
                <small>NestJS</small>
              </div>
              <div className={`${styles.box} ${styles.green}`}>
                <b>api_green :4000</b>
                <small>다음 배포 때 켜짐</small>
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
      <figcaption>
        화면과 API는 따로 살아요. 인터넷에서 서버로 들어오는 길은 Caddy(443) 하나이고, API · MySQL ·
        Redis는 서버 안쪽 네트워크에서만 서로 이야기해요.
      </figcaption>
    </figure>
  );
}

const PIPELINE = [
  { who: '내 맥', what: 'git push origin main' },
  { who: 'GitHub', what: 'CI: 포맷 · 타입 · 린트 · 테스트 · 빌드' },
  { who: 'GitHub', what: 'ARM 러너가 이미지 굽기 → GHCR (:SHA, :main)' },
  { who: 'GitHub → AWS', what: 'OIDC 증명서 → 1시간짜리 배포 역할' },
  { who: 'AWS', what: 'SSM send-command → 서버의 SSM Agent' },
  { who: '서버', what: 'deploy.sh: 이미지 받기 → 쉬던 색에 띄우기' },
  { who: '서버', what: '/health 200 확인 → Caddy 문 바꾸기 → 옛 색 끄기' },
  { who: 'GitHub', what: '바깥에서 https://…/health 200 확인' },
] as const;

/** 배포가 흘러가는 순서 */
export function PipelineDiagram() {
  return (
    <figure className={styles.diagram}>
      <ol className={styles.pipeline}>
        {PIPELINE.map((step, index) => (
          <li key={index}>
            <small>{step.who}</small>
            <span>{step.what}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        main에 push하면 사람 손 없이 여기까지 가요. 중간 어디서 실패하면 Caddy는 계속 예전 색을 보고
        있어서 서비스는 그대로예요.
      </figcaption>
    </figure>
  );
}
