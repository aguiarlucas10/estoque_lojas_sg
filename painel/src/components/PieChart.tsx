export type PieSlice = {
  label: string;
  value: number;
  color: string;
};

/**
 * Gráfico de pizza puro SVG (sem deps externas). Renderiza arcos com `path`
 * usando coordenadas polares. Quando há só 1 fatia, vira círculo cheio.
 */
export function PieChart({
  slices,
  size = 96,
}: {
  slices: PieSlice[];
  size?: number;
}) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  // Caso especial: 1 fatia → círculo cheio
  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
      </svg>
    );
  }

  let acc = 0;
  const paths = slices.map((s, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += s.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return <path key={i} d={d} fill={s.color} />;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
    </svg>
  );
}
