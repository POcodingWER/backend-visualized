import type { ButtonHTMLAttributes } from 'react';
import styles from '../ui.module.css';

/** 큰 버튼: 장마다 하나뿐인 "직접 해 보기". 작은 버튼: 그 밖의 보조 동작 */
export const buttonClassName = { big: styles.bigButton, small: styles.smallButton } as const;

export function Button({
  size,
  type = 'button',
  className,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { size: keyof typeof buttonClassName }) {
  return (
    <button
      type={type}
      className={className ? `${buttonClassName[size]} ${className}` : buttonClassName[size]}
      {...buttonProps}
    />
  );
}
