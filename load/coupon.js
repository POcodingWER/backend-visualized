// k6 run -e STRATEGY=atomic -e USERS=500 -e QTY=100 -e API_URL=http://localhost:4100 load/coupon.js
// 쿠폰을 리셋한 뒤 USERS명의 VU가 동시에 1번씩 발급 요청. API는 THROTTLE_LIMIT=1000000 으로 실행할 것.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const STRATEGY = __ENV.STRATEGY || 'atomic';
const USERS = Number(__ENV.USERS || 500);
const QTY = Number(__ENV.QTY || 100);
const json = { headers: { 'Content-Type': 'application/json' } };

const issued = new Counter('coupon_issued');
const retries = new Counter('coupon_retries');

export const options = {
  scenarios: {
    rush: { executor: 'per-vu-iterations', vus: USERS, iterations: 1, maxDuration: '2m' },
  },
};

export function setup() {
  http.post(`${API}/coupons/reset`, JSON.stringify({ quantity: QTY }), json);
}

export default function () {
  const response = http.post(
    `${API}/coupons/issue`,
    JSON.stringify({ strategy: STRATEGY, userId: `k6-${__VU}` }),
    json,
  );
  check(response, { 'status 200': (checked) => checked.status === 200 });
  const body = response.json();
  if (body.success) issued.add(1);
  retries.add(body.retries || 0);
}

export function teardown() {
  const demoState = http.get(`${API}/coupons/demo`).json();
  console.log(
    `issued=${demoState.issued} counter=${demoState.counter} oversold=${demoState.oversold} (quantity ${QTY})`,
  );
}
