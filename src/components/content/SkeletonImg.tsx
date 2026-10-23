'use client';

import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

/**
 * `<img>` that gets `data-loaded` once it has loaded or failed, so its container can show a
 * skeleton until then (`.cardImage`, `.cover` in content.module.css).
 */
export default function SkeletonImg({ alt = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Already done before hydration: onLoad won't fire again.
    if (ref.current?.complete) {
      setLoaded(true);
    }
  }, []);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- /media redirects to signed R2 URLs
    <img
      {...props}
      alt={alt}
      ref={ref}
      data-loaded={loaded ? '' : undefined}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}
