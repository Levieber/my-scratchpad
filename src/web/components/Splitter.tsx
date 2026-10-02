import { clampWidth, MAX_WIDTH, MIN_WIDTH } from "@/web/lib/storage";

// WAI-ARIA's window splitter is a focusable separator carrying a value, so keyboard and screen
// reader users can resize the list too; jsx-a11y treats every separator as non-interactive.
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
export function Splitter({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  // The sidebar starts at the left edge, so the pointer's x is the new width.
  const drag = (e: React.PointerEvent<HTMLHRElement>) => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onChange(clampWidth(ev.clientX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -20, ArrowRight: 20 }[e.key];
    if (step) {
      e.preventDefault();
      onChange(clampWidth(width + step));
    }
  };
  return (
    <hr
      // Only beside the editor on a wide screen; a phone shows one column at a time.
      className="m-0 hidden h-auto w-1.5 cursor-col-resize touch-none border-0 border-l border-border hover:border-l-2 hover:border-primary focus-visible:border-l-2 focus-visible:border-primary focus-visible:outline-none wide:block"
      aria-orientation="vertical"
      aria-label="Resize note list"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={key}
    />
  );
}
/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
