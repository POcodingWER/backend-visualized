import type { ReactNode } from 'react';
import styles from '../ui.module.css';

/**
 * "개발자용 자세히": 전문 용어·SQL·DB 상태는 이 안에만 둔다. 네이티브 <details>.
 * ponytail: 닫혀 있어도 children을 렌더한다. 안쪽이 무거워져 첫 화면이 느려지면 open 상태로 지연 렌더할 것.
 */
export function DevDetails({
  description,
  children,
}: {
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className={styles.devDetails} open>
      <summary>
        <b>개발자용 자세히</b>
        {description && <span>{description}</span>}
      </summary>
      <div className={styles.devBody}>{children}</div>
    </details>
  );
}
