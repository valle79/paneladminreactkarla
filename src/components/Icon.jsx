import { useMemo } from 'react';

const CDN = 'https://img.icons8.com/ios/';

export default function Icon({ name, size = 16, title, className = '', style: extraStyle }) {
  const px = Math.max(32, Math.round(size * 3));
  const mask = useMemo(
    () => ({ WebkitMask: `no-repeat center / contain url(${CDN}${px}/${name}.png)`, mask: `no-repeat center / contain url(${CDN}${px}/${name}.png)` }),
    [name, px]
  );
  return (
    <span
      className={`icon ${className}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        flexShrink: 0,
        verticalAlign: 'middle',
        ...mask,
        ...extraStyle,
      }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}