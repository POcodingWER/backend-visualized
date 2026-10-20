import { githubFile } from '../../lib/site';
import type { DevFlowContent } from '../components/molecules/DevFlow';

/** 4장 "개발자용 자세히" 글. 표 값은 2026-10-20 로컬에서 200건 실험을 한 번 돌리고 읽은 것 */
export const LEDGER_DEV_FLOW: DevFlowContent = {
  terms: [
    {
      analogy: '잔액 칸',
      term: (
        <>
          <code>PointWallet.balance</code>
        </>
      ),
    },
    {
      analogy: '입출금 내역',
      term: (
        <>
          <code>PointEntry</code>: 추가만 하는 원장 (append-only)
        </>
      ),
    },
    {
      analogy: '덮어쓰기',
      term: (
        <>
          애플리케이션에서 읽고 계산해서 쓰는 read-modify-write → <b>lost update</b>
        </>
      ),
    },
    {
      analogy: '통장 방식',
      term: (
        <>
          한 트랜잭션: <code>SELECT balance … FOR UPDATE</code>(행 잠금) → 0 미만 검사 →{' '}
          <code>INSERT PointEntry</code> → <code>UPDATE balance = balance + ?</code>
        </>
      ),
    },
    {
      analogy: '맞춰 보기',
      term: (
        <>
          대사(reconciliation): <code>balance</code> vs <code>SUM(PointEntry.amount)</code>
        </>
      ),
    },
  ],
  steps: [
    {
      who: '브라우저 → API',
      what: (
        <>
          <code>simulatePoints(200)</code>이 <code>POST /points/simulate</code>{' '}
          <code>{'{ requests: 200 }'}</code>를 보내요.
        </>
      ),
      branches: [<>다른 실험 중이면 409, 쿨다운 중이면 429 (IP당 10초 6번도 429)</>],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          <code>PointsService.simulateBothModes</code>가 덮어쓰기 → 통장 순서로 돌려요. 지갑마다
          먼저 잔액 5,000과 <code>opening</code> 내역 한 줄로 리셋해요.
        </>
      ),
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          요청 200개를 동시에 던져요. 적립 +100 세 번에 사용 −100 한 번 꼴이라, 정상이면
          15,000이에요.
        </>
      ),
      branches: [
        <>
          덮어쓰기 <code>applyByOverwrite</code>: 잔액 읽기 → 내역 INSERT →{' '}
          <code>balance = 읽은 값 + amount</code>로 UPDATE (트랜잭션 없음)
        </>,
        <>
          통장 <code>applyByLedger</code>: 트랜잭션 안에서 <code>FOR UPDATE</code>로 지갑 행 잠금 →
          0 미만이면 거절 → 내역 INSERT → <code>balance = balance + amount</code>
        </>,
      ],
    },
    {
      who: 'API → MySQL',
      what: (
        <>
          끝나면 <code>reconcile()</code>이 잔액 칸과 내역 합계를 비교해요. 통장 쪽은 잔액보다 100
          많은 금액을 써 보고 거절되는지도 확인해요.
        </>
      ),
    },
    {
      who: 'API → 브라우저',
      what: (
        <>
          200 <code>{'{ results: [overwrite, ledger] }'}</code>. 요청마다 읽은 시각, 쓴 시각, 본
          잔액이 들어 있어요.
        </>
      ),
    },
    {
      who: '브라우저 → API',
      what: (
        <>
          아래 표는 <code>GET /points/:mode/entries?limit=8</code>로 실제 행을 읽어요.
        </>
      ),
    },
  ],
  samples: [
    {
      caption: 'PointWallet 행 (한 번 실행한 예)',
      note: (
        <>
          200건 실험 직후 읽었어요. 오른쪽 두 칸은 <code>PointEntry</code>를 센 값이에요.
        </>
      ),
      columns: ['id', 'name', 'balance', 'updatedAt', 'SUM(amount)', 'PointEntry 행 수'],
      rows: [
        ['47', 'sim-overwrite', '4900', '2026-10-20 05:00:35.157', '15000', '201'],
        ['48', 'sim-ledger', '15000', '2026-10-20 05:00:35.405', '15000', '201'],
      ],
    },
    {
      caption: 'PointEntry 행 (같은 실행)',
      note: (
        <>
          <code>sim-overwrite</code> 지갑의 앞부분이에요. 시각은 UTC예요.
        </>
      ),
      columns: ['id', 'walletName', 'amount', 'reason', 'createdAt'],
      rows: [
        ['8875', 'sim-overwrite', '5000', 'opening', '2026-10-20 05:00:35.080'],
        ['8876', 'sim-overwrite', '100', 'earn', '2026-10-20 05:00:35.121'],
        ['8877', 'sim-overwrite', '100', 'earn', '2026-10-20 05:00:35.121'],
        ['8883', 'sim-overwrite', '-100', 'spend', '2026-10-20 05:00:35.121'],
      ],
    },
  ],
  notes: [
    {
      title: '표를 이렇게 읽어요',
      items: [
        <>
          덮어쓰기 쪽도 내역 201줄(opening + 200)은 다 남았고 합계도 15,000이에요. 잔액 칸만
          4,900이에요.
        </>,
        <>
          마지막에 쓴 요청이 옛 잔액 5,000을 읽고 100을 쓴 값을 덮어쓴 거예요. 대사가 이
          어긋남(−10,100)을 잡아내요.
        </>,
      ],
    },
    {
      title: '한계·운영에선',
      items: [
        <>지갑 한 행을 잠그므로 한 사람에게 요청이 몰리면 줄이 길어져요 (위 시간 비교).</>,
        <>
          수백 개가 같은 잠금을 기다려서 트랜잭션 대기·제한 시간을 15초로 늘려 뒀어요 (기본
          2초/5초).
        </>,
        <>
          실무에선 잔액 칸을 아예 두지 않고 SUM으로만 계산하거나, 잔액은 캐시로 두고 매일 밤 대사
          잡으로 검증해요.
        </>,
      ],
    },
    {
      title: '개발자 도구로 보면',
      items: [
        <>
          Network에는 <code>POST /points/simulate</code> 한 건이에요. 요청 200개는 서버 안에서
          동시에 돌아요.
        </>,
        <>
          응답의 <code>reconciliation.difference</code>가 0이 아니면 장부와 잔액이 어긋난 거예요.
        </>,
      ],
    },
  ],
  links: [
    { label: 'ledger/api.ts', href: githubFile('apps/web/app/ledger/api.ts') },
    { label: 'points.controller.ts', href: githubFile('apps/api/src/points/points.controller.ts') },
    {
      label: 'points.service.ts',
      href: githubFile('apps/api/src/points/points.service.ts'),
      note: '두 방식·대사',
    },
    {
      label: 'ledger/lost-update.ts',
      href: githubFile('apps/web/app/ledger/lost-update.ts'),
      note: '"왜 15,000P가 아닐까요" 숫자',
    },
    {
      label: 'docs/chapters-4-6.md',
      href: `${githubFile('docs/chapters-4-6.md')}#4장-포인트-통장`,
    },
  ],
};
