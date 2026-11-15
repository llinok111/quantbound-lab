/*
 * baseline/naive.mjs — 对照基线（朴素做法），零依赖。
 *
 *  1. naivePositions: 不按每个属性各自的紧包围盒，而是固定 [-1,1] 逐轴量化
 *     （很多手写导出器就这么干；示例网格 x∈[0,1]，因此半轴被浪费一半）。
 *  2. naiveNormals: 逐分量量化 + 归一化（法向不是立方体上的均匀分布，这会有系统性偏差）。
 */
import { normalize3 } from "../src/core.mjs";

export function naivePositions(positions, bits) {
  const levels = (1 << bits) - 1;
  const n = positions.length / 3;
  let maxErr = -1, witness = -1;
  for (let i = 0; i < n; i++) {
    let sq = 0;
    for (let k = 0; k < 3; k++) {
      const v = positions[3 * i + k];
      let q = Math.round(((v + 1) / 2) * levels);
      if (q < 0) q = 0; if (q > levels) q = levels;
      const d = (q / levels) * 2 - 1;
      const e = v - d;
      sq += e * e;
    }
    if (sq > maxErr) { maxErr = sq; witness = i; }
  }
  return { maxError: Math.sqrt(maxErr), witness };
}

export function naiveNormals(normals, bits) {
  const levels = (1 << bits) - 1;
  const n = normals.length / 3;
  let maxAng = -1, witness = -1;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = normalize3(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
    const q = [x, y, z].map((c) => {
      let t = Math.round(((c + 1) / 2) * levels);
      if (t < 0) t = 0; if (t > levels) t = levels;
      return (t / levels) * 2 - 1;
    });
    const [dx, dy, dz] = normalize3(q[0], q[1], q[2]);
    let d = x * dx + y * dy + z * dz;
    if (d > 1) d = 1; if (d < -1) d = -1;
    const ang = Math.acos(d);
    if (ang > maxAng) { maxAng = ang; witness = i; }
  }
  return { maxAngleDeg: maxAng * 180 / Math.PI, witness };
}
