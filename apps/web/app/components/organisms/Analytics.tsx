'use client';

import { GoogleAnalytics } from '@next/third-parties/google';
import { useClickTracking } from '../../../lib/useClickTracking';

// Vercel Production에만 넣어 둔 값. 로컬·프리뷰에선 비어 있어서 GA 스크립트도 클릭 추적도 안 싣는다
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/** GA에 관한 건 이 컴포넌트 하나로 끝난다: GA 스크립트를 싣고, 클릭 이벤트를 보낸다 */
export default function Analytics() {
  useClickTracking(!!GA_ID);
  return GA_ID ? <GoogleAnalytics gaId={GA_ID} /> : null;
}
