import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep the first `always` mounted; IO the rest. Unmount when offscreen. */
export function IdleMount({
  index,
  always,
  placeholder,
  children,
}: {
  index: number;
  always: number;
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(index < always);

  useEffect(() => {
    if (index < always) {
      setOn(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setOn(Boolean(e?.isIntersecting)),
      { rootMargin: "240px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, always]);

  return <div ref={ref}>{on ? children : placeholder}</div>;
}
