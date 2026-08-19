import React from 'react';
import { View } from 'react-native';
import Svg, { Path as SvgPath } from 'react-native-svg';

// ─── MiniLineChart ──────────────────────────────────────────────────────────
// Mini gráfico de tendencia data-driven, compartido. Antes existían dos
// versiones independientes e incompatibles (home.tsx y savings.tsx): una
// tomaba props y dibujaba la serie real, la otra era un mock estático sin
// props. Se unifica en esta, y ambas pantallas le pasan sus propios datos.

interface MiniLineChartProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}

export function MiniLineChart({ data, color, width = 88, height = 44 }: MiniLineChartProps) {
  const nonZero = data.filter(v => v > 0);
  if (nonZero.length < 2) return <View style={{ width, height, flexShrink: 0 }} />;

  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - (v / max) * (height - 6) - 3,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <View style={{ width, height, flexShrink: 0 }}>
      <Svg width={width} height={height}>
        <SvgPath d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
