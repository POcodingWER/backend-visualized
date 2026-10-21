/** 아이콘에 필요한 것만: simple-icons의 SimpleIcon과 모양이 같다 */
export interface ChipIcon {
  path: string;
}

/**
 * 기술 이름 칩. 아이콘이 있으면 이름 앞에 작은 로고(글자색 그대로)를 붙인다.
 * 로고는 장식이라 화면 읽기 프로그램에는 숨기고(aria-hidden), 이름 글자가 그대로 라벨이 된다.
 */
export function TechChip({
  label,
  icon,
  className,
}: {
  label: string;
  icon?: ChipIcon;
  className?: string;
}) {
  return (
    <span className={className}>
      {icon && (
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d={icon.path} />
        </svg>
      )}
      {label}
    </span>
  );
}
