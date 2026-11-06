"use client";
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * A row of choices whose dark highlight slides to the option just clicked. The chosen button keeps a transparent
 * background and marks itself with aria-checked or aria-pressed; the highlight behind it is measured, so buttons of any
 * width work, on several lines, in right-to-left layouts and after their text is translated.
 */
export function SlideGroup({ children, className, style, role = "radiogroup", label, radius = 999, color = "var(--dc-solid)" }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: string;
  label?: string;
  radius?: number;
  color?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);

  const place = () => {
    const group = box.current;
    const highlight = thumb.current;
    if (!group || !highlight) return;
    const chosen = group.querySelector<HTMLElement>(':scope > [aria-checked="true"], :scope > [aria-pressed="true"]');
    if (!chosen) {
      highlight.style.opacity = "0";
      return;
    }
    highlight.style.opacity = "1";
    highlight.style.width = `${chosen.offsetWidth}px`;
    highlight.style.height = `${chosen.offsetHeight}px`;
    highlight.style.transform = `translate(${chosen.offsetLeft}px, ${chosen.offsetTop}px)`;
  };

  // Runs after every render, because that is when the choice changes.
  useLayoutEffect(place);

  useEffect(() => {
    const group = box.current;
    const highlight = thumb.current;
    if (!group || !highlight) return;
    // The first position is set without motion; only later choices slide.
    const frame = requestAnimationFrame(() => highlight.classList.add("dc-slide-live"));
    const resized = new ResizeObserver(place);
    resized.observe(group);
    const reworded = new MutationObserver(place);
    reworded.observe(group, { subtree: true, childList: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      reworded.disconnect();
    };
  }, []);

  return (
    <div ref={box} role={role} aria-label={label} className={`dc-slide ${className ?? ""}`} style={style}>
      <span ref={thumb} aria-hidden="true" className="dc-slide-thumb" style={{ borderRadius: radius, background: color }} />
      {children}
    </div>
  );
}
