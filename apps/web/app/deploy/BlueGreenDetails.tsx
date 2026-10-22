import { githubFile } from '../../lib/site';
import styles from './deploy.module.css';

/** 끊기지 않는 배포의 개발자용 순서. deploy.yml(GitHub 쪽) + deploy/deploy.sh(서버 쪽) 그대로 */
export function BlueGreenDetails() {
  return (
    <details className={styles.fold}>
      <summary>서버에서 실제로 하는 일 보기 (deploy.yml → deploy/deploy.sh)</summary>
      <div className={styles.foldBody}>
        <ol className={styles.foldSteps}>
          <li>
            <b>GitHub: 어떤 커밋인지 확인.</b> 커밋 SHA를 40자로 풀고{' '}
            <code>git merge-base --is-ancestor &lt;SHA&gt; origin/main</code>으로 main에 있는
            커밋인지 본다. 아니면 여기서 멈춤.
          </li>
          <li>
            <b>GitHub → AWS → 서버.</b> OIDC로 1시간짜리 역할을 받아{' '}
            <code>aws ssm send-command</code>(<code>AWS-RunShellScript</code>). 서버에서는{' '}
            <code>
              sudo -u ubuntu bash -lc &apos;git fetch origin main; git reset --hard origin/main;
              ./deploy/deploy.sh &lt;SHA&gt;&apos;
            </code>
          </li>
          <li>
            <b>지금 색 알아내기.</b> <code>deploy/caddy/upstream.caddy</code>의{' '}
            <code>reverse_proxy api_blue_1:4000 api_blue_2:4000</code> 줄을 읽고, 반대 색을 새로
            띄울 쪽으로 정한다. (7장 전의 <code>api_blue:4000</code> 한 줄짜리도 읽는다)
          </li>
          <li>
            <b>이미지 받기.</b>{' '}
            <code>docker pull ghcr.io/pocodingwer/backend-visualized-api:&lt;SHA&gt;</code> →{' '}
            <code>backend-visualized-api:green</code>으로 태그. 못 받으면 서버에 남은 같은 이미지,
            그것도 없으면 비상용으로 서버에서 직접 빌드(<code>FALLBACK_LOCAL_BUILD</code>).
          </li>
          <li>
            <b>쉬던 색 띄우기.</b>{' '}
            <code>docker compose up -d --no-deps --force-recreate api_green_1 api_green_2</code>{' '}
            (MySQL · Redis는 그대로). 컨테이너 시작 스크립트 <code>apps/api/docker/start.sh</code>가{' '}
            <code>prisma migrate deploy</code>를 하고(DB가 늦게 뜨면 다시 시도) 서버를 켠다.
            마이그레이션은 <code>_1</code>만, <code>_2</code>는 <code>RUN_MIGRATIONS=false</code>로
            건너뛴다. 마이그레이션은 앞으로만 가니까 &quot;추가 먼저, 삭제는 다음 배포&quot;(expand
            → contract).
          </li>
          <li>
            <b>건강 확인.</b> Caddy 컨테이너 안에서 <code>wget http://api_green_1:4000/health</code>
            와 <code>_2</code>를 2초마다, 최대 60번(2분). 둘 다 200이어야 다음으로. 컨테이너가
            죽으면(마이그레이션 실패, 환경 변수 오류) 바로 멈춘다.
          </li>
          <li>
            <b>문 바꾸기.</b> <code>upstream.caddy</code>를 임시 파일에 쓰고 <code>mv</code>(한 번에
            바뀜) → <code>caddy reload</code>. Caddy가 막 새로 만들어졌으면 관리 API가 늦게 떠서 1초
            간격 15번까지 다시 시도. 이어서 <code>curl --resolve</code>로 HTTPS 443을 거친{' '}
            <code>/health</code>도 확인.
          </li>
          <li>
            <b>마무리 → 끄기 → 정리.</b> <code>sleep 10</code> →{' '}
            <code>docker compose stop api_blue_1 api_blue_2</code> → GHCR 이미지는 최근 3개만 남기고{' '}
            <code>docker image prune -f</code> → <code>DEPLOYED_SHA=… COLOR=green</code> 출력.
            GitHub가 그 SHA가 맞는지, 바깥 <code>https://…/health</code>가 200인지 확인하면 끝.
          </li>
        </ol>

        <table className={styles.swapTable}>
          <caption>2026-10-21 Deploy 기록의 서버 로그 (deploy.sh 시작 → 끝)</caption>
          <thead>
            <tr>
              <th scope="col">경우</th>
              <th scope="col">이미지 받기</th>
              <th scope="col">건강해질 때까지</th>
              <th scope="col">마무리</th>
              <th scope="col">deploy.sh 전체</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">API 이미지 새로 구움 (#8)</th>
              <td>19초</td>
              <td>8초</td>
              <td>10초</td>
              <td>39초</td>
            </tr>
            <tr>
              <th scope="row">이미지 그대로 (#9 ~ #11)</th>
              <td>2~3초</td>
              <td>4~5초</td>
              <td>10~11초</td>
              <td>19~21초</td>
            </tr>
          </tbody>
        </table>

        <dl className={styles.swapCases}>
          <dt>실패하면</dt>
          <dd>
            새 색이 2분 안에 건강해지지 않으면 그 색의 로그 40줄을 남기고 그 색만 멈춘 뒤 실패로
            끝난다. <code>upstream.caddy</code>를 건드리기 전이라 Caddy는 계속 예전 색으로 보낸다.
            GitHub에는 빨간 불이 켜진다.
          </dd>
          <dt>롤백</dt>
          <dd>
            GitHub Actions에서 Deploy를 수동 실행하고 <code>ref</code>에 예전 커밋 SHA를 넣는다
            (이미지 굽기는 건너뜀). 서버에서 직접 하려면{' '}
            <code>./deploy/deploy.sh &lt;예전 SHA&gt;</code>. 순서는 위와 똑같은 blue-green이라
            롤백도 안 끊긴다. 서버에 최근 이미지 3개가 남아 있고, 그보다 오래된 건 GHCR에서 다시
            받는다. DB 마이그레이션은 되돌아가지 않는다.
          </dd>
        </dl>
        <p className={styles.foldSource}>
          코드: <a href={githubFile('deploy/deploy.sh')}>deploy/deploy.sh</a> ·{' '}
          <a href={githubFile('.github/workflows/deploy.yml')}>.github/workflows/deploy.yml</a>
        </p>
      </div>
    </details>
  );
}
