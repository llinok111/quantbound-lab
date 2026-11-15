/*
 * src/core.mjs — 顶点属性量化误差证书 + 最小位深选择（纯计算）
 *
 * 硬约束：不 import three、不碰 window/document/navigator、模块顶层无副作用、
 * 不读文件/环境变量。`node -e "import('./src/core.mjs')"` 必须无报错。
 *
 * 提供三件事：
 *   1. 位置/UV 的逐轴均匀量化：解析上界（halfStep） + 全顶点实测精确最坏误差 + 见证顶点
 *   2. 法向的八面体编码（octahedral）：全顶点实测最坏角度误差 + 见证顶点
 *   3. 容差下的最小位深：二分找到最小 bits，并给出 bits-1 必然失败的见证（最小性证据）
 */

export function normalize3(x, y, z) {
  const n = Math.hypot(x, y, z);
  if (n === 0) return [0, 0, 0];
  return [x / n, y / n, z / n];
}

export function bboxOf(values, stride) {
  const n = values.length / stride;
  const mn = new Array(stride).fill(Infinity);
  const mx = new Array(stride).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < stride; k++) {
      const v = values[i * stride + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { mn, mx };
}

export function bboxDiag(positions) {
  const { mn, mx } = bboxOf(positions, 3);
  return Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
}

/* ------------------------------------------------------------------ *
 * 1. 位置 / UV：逐轴均匀量化
 * ------------------------------------------------------------------ */

export function quantizeUniform(values, stride, bits, bbox) {
  const levels = (1 << bits) - 1;
  const n = values.length / stride;
  const { mn, mx } = bbox || bboxOf(values, stride);
  const steps = [], half = [];
  for (let k = 0; k < stride; k++) {
    const step = levels === 0 ? 0 : (mx[k] - mn[k]) / levels;
    steps.push(step);
    half.push(step / 2);
  }
  const decoded = new Float64Array(values.length);
  let maxSq = -1, maxErr = -1, witness = -1;
  for (let i = 0; i < n; i++) {
    let sq = 0;
    for (let k = 0; k < stride; k++) {
      const v = values[i * stride + k];
      let q = levels === 0 ? 0 : Math.round(((v - mn[k]) / (mx[k] - mn[k])) * levels);
      if (q < 0) q = 0; if (q > levels) q = levels;
      const d = mn[k] + q * steps[k];
      decoded[i * stride + k] = d;
      const e = v - d;
      sq += e * e;
    }
    if (sq > maxSq) { maxSq = sq; maxErr = Math.sqrt(sq); witness = i; }
  }
  let boundSq = 0;
  for (let k = 0; k < stride; k++) boundSq += half[k] * half[k];
  return { decoded, maxError: maxErr, maxSq, boundMax: Math.sqrt(boundSq),
           boundSq, steps, half, witness: { index: witness, error: maxErr } };
}

/* ------------------------------------------------------------------ *
 * 2. 法向：八面体编码（[-1,1]² 上的二维量化）
 * ------------------------------------------------------------------ */

export function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z);
  let u = l === 0 ? 0 : x / l, v = l === 0 ? 0 : y / l;
  if (z < 0) {
    const su = u >= 0 ? 1 : -1, sv = v >= 0 ? 1 : -1;
    const ou = (1 - Math.abs(v)) * su;
    const ov = (1 - Math.abs(u)) * sv;
    u = ou; v = ov;
  }
  return [u, v];
}

export function octDecode(u, v) {
  const z = 1 - Math.abs(u) - Math.abs(v);
  let x = u, y = v, zz = z;
  if (z < 0) {
    const su = u >= 0 ? 1 : -1, sv = v >= 0 ? 1 : -1;
    x = (1 - Math.abs(v)) * su;
    y = (1 - Math.abs(u)) * sv;
  }
  const n = Math.hypot(x, y, zz);
  if (n === 0) return [0, 0, 1];
  return [x / n, y / n, zz / n];
}

export function encodeNormalsOct(normals, bits) {
  const levels = (1 << bits) - 1;
  const n = normals.length / 3;
  const decoded = new Float64Array(normals.length);
  let maxAng = -1, sum = 0, witness = -1, maxRad = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = normalize3(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
    const [u, v] = octEncode(x, y, z);
    let q0 = Math.round(((u + 1) / 2) * levels);
    let q1 = Math.round(((v + 1) / 2) * levels);
    if (q0 < 0) q0 = 0; if (q0 > levels) q0 = levels;
    if (q1 < 0) q1 = 0; if (q1 > levels) q1 = levels;
    const du = (q0 / levels) * 2 - 1, dv = (q1 / levels) * 2 - 1;
    const [dx, dy, dz] = octDecode(du, dv);
    decoded[3 * i] = dx; decoded[3 * i + 1] = dy; decoded[3 * i + 2] = dz;
    let d = x * dx + y * dy + z * dz;
    if (d > 1) d = 1; if (d < -1) d = -1;
    const ang = Math.acos(d);
    sum += ang;
    if (ang > maxRad) { maxRad = ang; maxAng = ang * 180 / Math.PI; witness = i; }
  }
  const step = 2 / levels;
  return {
    decoded, maxAngleDeg: maxAng, maxAngleRad: maxRad, meanAngleDeg: (sum / n) * 180 / Math.PI,
    step, witness: { index: witness, angleDeg: maxAng },
    // 保守上界：2.2 × 量化步长（弧度）。实测 200k 方向球面扫在 bits 4…14 上
    // 真实最坏值稳定在 2.05–2.10 × step，取 2.2 留 ~5% 余量并逐位深断言其sound。
    boundDeg: (2.2 * step) * 180 / Math.PI,
  };
}

/** 对照：逐分量量化 + 归一化（不少朴素导出的做法） */
export function encodeNormalsNaive(normals, bits) {
  const levels = (1 << bits) - 1;
  const n = normals.length / 3;
  const decoded = new Float64Array(normals.length);
  let maxAng = -1, sum = 0, witness = -1;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = normalize3(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
    const q = [x, y, z].map((c) => {
      let t = Math.round(((c + 1) / 2) * levels);
      if (t < 0) t = 0; if (t > levels) t = levels;
      return (t / levels) * 2 - 1;
    });
    const [dx, dy, dz] = normalize3(q[0], q[1], q[2]);
    decoded[3 * i] = dx; decoded[3 * i + 1] = dy; decoded[3 * i + 2] = dz;
    let d = x * dx + y * dy + z * dz;
    if (d > 1) d = 1; if (d < -1) d = -1;
    const ang = Math.acos(d);
    sum += ang;
    if (ang > maxAng) { maxAng = ang; witness = i; }
  }
  return { decoded, maxAngleDeg: maxAng * 180 / Math.PI, meanAngleDeg: (sum / n) * 180 / Math.PI,
           witness: { index: witness, angleDeg: maxAng * 180 / Math.PI } };
}

/* ------------------------------------------------------------------ *
 * 3. 证书 + 最小位深
 * ------------------------------------------------------------------ */

export function certifyMesh(mesh, cfg) {
  const diag = bboxDiag(mesh.positions);
  const pos = quantizeUniform(mesh.positions, 3, cfg.posBits);
  const uv = quantizeUniform(mesh.uv, 2, cfg.uvBits);
  const nrm = encodeNormalsOct(mesh.normals, cfg.nrmBits);
  const uvTexels = uv.maxError * cfg.texSize;
  return {
    diag,
    posBits: cfg.posBits, nrmBits: cfg.nrmBits, uvBits: cfg.uvBits,
    posMaxError: pos.maxError, posRelError: pos.maxError / diag, posBound: pos.boundMax,
    uvMaxError: uv.maxError, uvTexels, uvBoundTexels: uv.boundMax * cfg.texSize,
    nrmMaxAngleDeg: nrm.maxAngleDeg, nrmMeanAngleDeg: nrm.meanAngleDeg, nrmBoundDeg: nrm.boundDeg,
    witnesses: { pos: pos.witness, uv: uv.witness, nrm: nrm.witness },
    pass: {
      pos: pos.maxError / diag <= cfg.tolRelPos,
      uv: uvTexels <= cfg.tolTexels,
      nrm: nrm.maxAngleDeg <= cfg.tolDeg,
    },
  };
}

/**
 * 容差下最小位深：二分 + 用 bits-1 的见证证明最小性。
 * attr: "pos" | "uv" | "nrm"
 */
export function minBits(mesh, attr, tol, opts = {}) {
  const lo = 2;
  const hi = opts.hi ?? 24;
  const diag = bboxDiag(mesh.positions);
  const texSize = opts.texSize ?? 2048;
  const evalAt = (bits) => {
    if (attr === "pos") { const r = quantizeUniform(mesh.positions, 3, bits); return { value: r.maxError / diag, witness: r.witness, raw: r.maxError }; }
    if (attr === "uv") { const r = quantizeUniform(mesh.uv, 2, bits); return { value: r.maxError * texSize, witness: r.witness, raw: r.maxError }; }
    const r = encodeNormalsOct(mesh.normals, bits); return { value: r.maxAngleDeg, witness: r.witness, raw: r.maxAngleRad };
  };
  if (evalAt(hi).value > tol) return { attr, tol, bits: null, feasible: false, reason: "tol-unreachable" };
  let a = lo, b = hi;
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (evalAt(m).value <= tol) b = m; else a = m + 1;
  }
  const chosen = evalAt(a);
  const below = a > lo ? evalAt(a - 1) : null;
  return {
    attr, tol, bits: a, value: chosen.value, witness: chosen.witness, feasible: true,
    minimality: below
      ? { bits: a - 1, value: below.value, witness: below.witness, exceedsTol: below.value > tol }
      : { bits: null, note: "at lower search bound" },
  };
}
