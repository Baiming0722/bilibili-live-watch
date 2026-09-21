import { useEffect, useRef, useState } from "react";

interface LazyIframeProps {
  src: string;
  title: string;
  /** 距離 viewport 多遠開始載入，預設 200px */
  rootMargin?: string;
}

/**
 * 搭配 IntersectionObserver，僅在 iframe 進入視口（含 rootMargin 預載範圍）時才掛載 iframe。
 * 避免多房同屏時所有 iframe 同時載入造成的記憶體與網路壓力。
 */
export function LazyIframe({ src, title, rootMargin = "200px" }: LazyIframeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 不支援 IntersectionObserver 的瀏覽器直接載入
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={containerRef} style={{ width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: "8px", overflow: "hidden" }}>
      {shouldLoad ? (
        <iframe
          title={title}
          src={src}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      ) : (
        <div
          onClick={() => setShouldLoad(true)}
          style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: "13px", cursor: "pointer" }}
        >
          點擊或滾動至此將載入直播
        </div>
      )}
    </div>
  );
}
