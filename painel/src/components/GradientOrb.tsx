type Tone = "mint" | "peach" | "lavender" | "sky" | "rose";

const TONE_VAR: Record<Tone, string> = {
  mint: "var(--color-gradient-mint)",
  peach: "var(--color-gradient-peach)",
  lavender: "var(--color-gradient-lavender)",
  sky: "var(--color-gradient-sky)",
  rose: "var(--color-gradient-rose)",
};

/**
 * Soft radial-gradient orb — pure atmosphere.
 * Position absolutely inside a relative parent.
 */
export function GradientOrb({
  tone,
  size = 480,
  className = "",
}: {
  tone: Tone;
  size?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute opacity-60 blur-3xl ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(closest-side, ${TONE_VAR[tone]} 0%, transparent 70%)`,
      }}
    />
  );
}
