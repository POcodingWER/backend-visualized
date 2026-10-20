import type { MenuRead } from './api';

/** "메뉴를 바꾸면 언제 보일까요?"의 한쪽(매번 DB / Redis 메뉴판) 상태 */
export interface SideState {
  read: MenuRead | null;
  dbReads: number;
  /** 수정 후 새 버전이 처음 보인 시각 (수정 기준 ms) */
  freshAfterMs: number | null;
  pollIndex: number;
}
export const emptySide: SideState = { read: null, dbReads: 0, freshAfterMs: null, pollIndex: 0 };

export function nextSide(
  side: SideState,
  read: MenuRead,
  editedVersion: number,
  at: number,
): SideState {
  return {
    read,
    dbReads: side.dbReads + (read.source === 'db' ? 1 : 0),
    freshAfterMs: side.freshAfterMs ?? (read.board.version >= editedVersion ? at : null),
    pollIndex: side.pollIndex + 1,
  };
}

/** 지금 보이는 판 옆 설명. 옛 메뉴면 오류가 아니라 "메뉴판이 언제 다시 확인되는지"를 알려 준다 */
export function versionLabel(side: SideState, editedVersion: number | null) {
  if (!side.read) return { text: '…', isStale: false };
  const { version } = side.read.board;
  if (editedVersion === null || version >= editedVersion)
    return { text: `${version}번째`, isStale: false };
  const ttlLeftMs = side.read.ttlLeftMs;
  return {
    text:
      ttlLeftMs === null
        ? `${version}번째 (옛 메뉴)`
        : `${version}번째 (옛 메뉴 · ${(ttlLeftMs / 1000).toFixed(1)}초 뒤 새로 확인)`,
    isStale: true,
  };
}

/**
 * 지켜보기 반복을 effect 수명에 묶는다. effect 안에서 부르고 반환값을 cleanup으로 돌려준다.
 * 개발 모드(StrictMode·Fast Refresh)는 effect를 떼었다 다시 붙이는데, 다시 붙을 때 멈춤 표시를 되돌리지 않으면
 * 메뉴를 바꿔도 다시 읽지 않아 화면이 옛 메뉴(빨강)에 멈춘다.
 */
export function watchWhileMounted(stopFlag: { current: boolean }) {
  stopFlag.current = false;
  return () => {
    stopFlag.current = true;
  };
}
