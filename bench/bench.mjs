/*
 * bench/bench.mjs — 冷启动 + 7 次重复取中位数，写 bench/result.json。
 * 真实计时，不做任何手脚：同一进程里 warmup 1 次，再跑 samples 次。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { certifyMesh, encodeNormalsOct } from "../src/core.mjs";
import { naivePositions, naiveNormals } from "../baseline/naive.mjs";

const raw = JSON.parse(readFileSync("data/mesh.json", "utf8"));
const mesh = {
  positions: Float64Array.from(raw.positions), uv: Float64Array.from(raw.uv),
  normals: Float64Array.from(raw.normals), indices: raw.indices,
};
const CFG = { posBits: 12, nrmBits: 8, uvBits: 12, texSize: 2048, tolRelPos: 1e-3, tolTexels: 0.5, tolDeg: 1.0 };
const SWEEP_N = 200000;

function sphereSweep(bits, N) {
  const levels = (1 << bits) - 1, ga = Math.PI * (3 - Math.sqrt(5));
  let worst = -1;
  for (let i = 0; i < N; i++) {
    const yy = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(Math.max(0, 1 - yy * yy)), th = i * ga;
    const x = Math.cos(th) * r, y = yy, z = Math.sin(th) * r;
    const l = Math.abs(x) + Math.abs(y) + Math.abs(z);
    let u = x / l, v = y / l;
    if (z < 0) { const su = u >= 0 ? 1 : -1, sv = v >= 0 ? 1 : -1; const ou = (1 - Math.abs(v)) * su, ov = (1 - Math.abs(u)) * sv; u = ou; v = ov; }
    const q0 = Math.round(((u + 1) / 2) * levels), q1 = Math.round(((v + 1) / 2) * levels);
    const du = (q0 / levels) * 2 - 1, dv = (q1 / levels) * 2 - 1;
    const zz = 1 - Math.abs(du) - Math.abs(dv);
    let ax = du, ay = dv, az = zz;
    if (zz < 0) { const su = du >= 0 ? 1 : -1, sv = dv >= 0 ? 1 : -1; ax = (1 - Math.abs(dv)) * su; ay = (1 - Math.abs(du)) * sv; }
    const nl = Math.hypot(ax, ay, az) || 1;
    let d = (x * ax + y * ay + z * az) / nl; if (d > 1) d = 1; if (d < -1) d = -1;
    const a = Math.acos(d); if (a > worst) worst = a;
  }
  return worst * 180 / Math.PI;
}

function time(fn) { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; }
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length, mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { min: s[0], median: s[Math.floor(n / 2)], p95: s[Math.min(n - 1, Math.floor(0.95 * n))],
           stddev: sd, relStddev: sd / mean, samples: n };
}

const SAMPLES = 7;
const coldCert = time(() => certifyMesh(mesh, CFG));
const warmup = time(() => certifyMesh(mesh, CFG));
const certTimes = []; for (let i = 0; i < SAMPLES; i++) certTimes.push(time(() => certifyMesh(mesh, CFG)));

const coldSweep = time(() => sphereSweep(CFG.nrmBits, SWEEP_N));
sphereSweep(CFG.nrmBits, SWEEP_N);
const sweepTimes = []; for (let i = 0; i < SAMPLES; i++) sweepTimes.push(time(() => sphereSweep(CFG.nrmBits, SWEEP_N)));

const coldBase = time(() => { naivePositions(mesh.positions, CFG.posBits); naiveNormals(mesh.normals, CFG.nrmBits); });
naivePositions(mesh.positions, CFG.posBits); naiveNormals(mesh.normals, CFG.nrmBits);
const baseTimes = []; for (let i = 0; i < SAMPLES; i++) baseTimes.push(time(() => { naivePositions(mesh.positions, CFG.posBits); naiveNormals(mesh.normals, CFG.nrmBits); }));

const cert = certifyMesh(mesh, CFG);
const naivePos = naivePositions(mesh.positions, CFG.posBits);
const naiveNrm = naiveNormals(mesh.normals, CFG.nrmBits);

const result = {
  node: process.version,
  samples: SAMPLES,
  mesh: { vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3 },
  cfg: CFG,
  coldStart: { certificateMs: coldCert, sweepMs: coldSweep, baselineMs: coldBase },
  certificateMs: stats(certTimes),
  sphereSweep200kMs: stats(sweepTimes),
  baselineMs: stats(baseTimes),
  speedup: { certVsSweep: stats(sweepTimes).median / stats(certTimes).median,
             certVsNaiveBaseline: stats(baseTimes).median / stats(certTimes).median },
  numbers: {
    posRelError: cert.posRelError, posBound: cert.posBound,
    uvTexels: cert.uvTexels, nrmMaxAngleDeg: cert.nrmMaxAngleDeg, nrmMeanAngleDeg: cert.nrmMeanAngleDeg,
    nrmBoundDeg: cert.nrmBoundDeg,
    naivePosMaxError: naivePos.maxError, naiveNrmMaxAngleDeg: naiveNrm.maxAngleDeg,
  },
};
writeFileSync("bench/result.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
