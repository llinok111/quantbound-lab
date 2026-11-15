/*
 * bench/verify.mjs — 断言脚本：所有数字都来自本次真实运行。
 * 通过则 exit(0)，否则 exit(1)。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  bboxDiag, quantizeUniform, octEncode, octDecode, encodeNormalsOct,
  encodeNormalsNaive, certifyMesh, minBits, normalize3,
} from "../src/core.mjs";
import { naivePositions, naiveNormals } from "../baseline/naive.mjs";

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}  ${detail}`); }
  else { fail++; console.log(`FAIL  ${name}  ${detail}`); }
  results.push({ name, pass: !!cond, detail });
}

if (!existsSync("data/mesh.json")) {
  console.error("data/mesh.json 不存在：先跑 node tools/gen-sample.mjs");
  process.exit(1);
}
const raw = JSON.parse(readFileSync("data/mesh.json", "utf8"));
const mesh = {
  positions: Float64Array.from(raw.positions),
  uv: Float64Array.from(raw.uv),
  normals: Float64Array.from(raw.normals),
  indices: raw.indices,
};
const V = mesh.positions.length / 3, T = mesh.indices.length / 3;
const diag = bboxDiag(mesh.positions);

// ---- 独立 oracle：位置量化（不同写法，不 import core 的 quantizeUniform） ----
function oracleUniformMax(values, stride, bits) {
  const levels = (1 << bits) - 1;
  const n = values.length / stride;
  const mn = new Array(stride).fill(Infinity), mx = new Array(stride).fill(-Infinity);
  for (let i = 0; i < n; i++) for (let k = 0; k < stride; k++) {
    const v = values[i * stride + k];
    if (v < mn[k]) mn[k] = v;
    if (v > mx[k]) mx[k] = v;
  }
  let best = -1, wi = -1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < stride; k++) {
      const span = mx[k] - mn[k];
      const idx = Math.round((values[i * stride + k] - mn[k]) * levels / span);
      const dec = mn[k] + (idx / levels) * span;
      s += (values[i * stride + k] - dec) ** 2;
    }
    if (s > best) { best = s; wi = i; }
  }
  return { maxError: Math.sqrt(best), witness: wi };
}

// ---- 独立 oracle：法向码本在整球面上的最坏角误差（Fibonacci 球扫） ----
function sphereSweepMaxAngleDeg(bits, N) {
  const levels = (1 << bits) - 1;
  const ga = Math.PI * (3 - Math.sqrt(5));
  let worst = -1;
  for (let i = 0; i < N; i++) {
    const yy = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = i * ga;
    const x = Math.cos(th) * r, y = yy, z = Math.sin(th) * r;
    const [u, v] = octEncode(x, y, z);
    const q0 = Math.round(((u + 1) / 2) * levels), q1 = Math.round(((v + 1) / 2) * levels);
    const [dx, dy, dz] = octDecode((q0 / levels) * 2 - 1, (q1 / levels) * 2 - 1);
    let d = x * dx + y * dy + z * dz; if (d > 1) d = 1; if (d < -1) d = -1;
    const a = Math.acos(d); if (a > worst) worst = a;
  }
  return worst * 180 / Math.PI;
}

const CFG = { posBits: 12, nrmBits: 8, uvBits: 12, texSize: 2048, tolRelPos: 1e-3, tolTexels: 0.5, tolDeg: 1.0 };
const cert = certifyMesh(mesh, CFG);

// A1
ok("A1 mesh shape", V === 16017 && T === 31360, `vertices=${V} triangles=${T}`);

// A2 解析上界严格覆盖实测最坏误差
const posQ = quantizeUniform(mesh.positions, 3, CFG.posBits);
ok("A2 pos bound sound", posQ.maxError <= posQ.boundMax + 1e-15,
  `maxError=${posQ.maxError.toExponential(6)} bound=${posQ.boundMax.toExponential(6)}`);

// A3 独立 oracle 逐位复现位置最坏误差（5 个位深）
let worstRel = 0, oracleTxt = [];
for (const b of [8, 10, 12, 14, 16]) {
  const a = quantizeUniform(mesh.positions, 3, b);
  const o = oracleUniformMax(mesh.positions, 3, b);
  const rel = Math.abs(a.maxError - o.maxError) / Math.max(a.maxError, 1e-300);
  if (rel > worstRel) worstRel = rel;
  oracleTxt.push(`b${b}:${a.maxError.toExponential(4)}/${o.maxError.toExponential(4)}`);
}
ok("A3 pos independent oracle", worstRel <= 1e-12, `5 bit depths, max rel diff=${worstRel.toExponential(3)} [${oracleTxt.join(" ")}]`);

// A4 容差 + 见证顶点复算
const w = posQ.witness;
const wErr = Math.hypot(
  mesh.positions[3 * w.index] - posQ.decoded[3 * w.index],
  mesh.positions[3 * w.index + 1] - posQ.decoded[3 * w.index + 1],
  mesh.positions[3 * w.index + 2] - posQ.decoded[3 * w.index + 2]);
ok("A4 pos tolerance+witness", cert.posRelError <= CFG.tolRelPos && Math.abs(wErr - w.error) < 1e-15,
  `relError=${cert.posRelError.toExponential(4)} tol=${CFG.tolRelPos} witness v${w.index} err=${wErr.toExponential(6)}`);

// A5 尺度不变性 1e-6 … 1e6
const rels = [], bitsPer = [];
for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
  const ps = new Float64Array(mesh.positions.length);
  for (let i = 0; i < ps.length; i++) ps[i] = mesh.positions[i] * s;
  const q = quantizeUniform(ps, 3, CFG.posBits);
  const d = bboxDiag(ps);
  rels.push(q.maxError / d);
  bitsPer.push(minBits({ positions: ps, uv: mesh.uv, normals: mesh.normals }, "pos", 1e-3).bits);
}
const relSpread = (Math.max(...rels) - Math.min(...rels)) / rels[0];
ok("A5 scale invariance", relSpread <= 1e-12 && bitsPer.every((b) => b === bitsPer[0]),
  `scales 1e-6..1e6 relError spread=${relSpread.toExponential(3)} minBits=${bitsPer.join(",")}`);

// A6 法向码本：整球面 200k 方向扫描的最坏角误差 ≤ 解析上界，且上界不虚高
const SWEEP_N = 200000;
let boundWorst = 0, ratios = [], sound = true;
for (const b of [4, 6, 8, 10, 12, 14]) {
  const sw = sphereSweepMaxAngleDeg(b, SWEEP_N);
  const bd = encodeNormalsOct(mesh.normals, b).boundDeg;
  if (sw > bd * 1.0000001) sound = false;
  ratios.push(bd / sw);
  if (bd / sw > boundWorst) boundWorst = bd / sw;
}
const sweep = sphereSweepMaxAngleDeg(CFG.nrmBits, SWEEP_N);
const nb = encodeNormalsOct(mesh.normals, CFG.nrmBits).boundDeg;
ok("A6 normal bound sound over sphere", sound && boundWorst <= 1.15,
  `bits 4,6,8,10,12,14 x ${SWEEP_N} dirs: bound/measured max=${boundWorst.toFixed(4)} (bound never below measured); at bits=${CFG.nrmBits} sweep=${sweep.toFixed(6)}deg bound=${nb.toFixed(6)}deg`);

// A7 网格法向容差
ok("A7 normal tol on mesh", cert.nrmMaxAngleDeg <= CFG.tolDeg,
  `max=${cert.nrmMaxAngleDeg.toFixed(6)}deg mean=${cert.nrmMeanAngleDeg.toFixed(6)}deg tol=${CFG.tolDeg} witness v${cert.witnesses.nrm.index}`);

// A8 八面体 vs 逐分量
// 等比特预算对照：八面体 2 轴 ×8 bit = 16 bit；逐分量版 3 轴 ×5 bit = 15 bit
const octAvg = encodeNormalsOct(mesh.normals, 8).meanAngleDeg;
const naiAvg = encodeNormalsNaive(mesh.normals, 5).meanAngleDeg;
const octMax = encodeNormalsOct(mesh.normals, 8).maxAngleDeg;
const naiMax = encodeNormalsNaive(mesh.normals, 5).maxAngleDeg;
ok("A8 oct vs naive (equal bit budget)", naiAvg / octAvg >= 2 && naiMax / octMax >= 2,
  `oct 16bit: mean=${octAvg.toFixed(6)} max=${octMax.toFixed(6)}deg | component 15bit: mean=${naiAvg.toFixed(6)} max=${naiMax.toFixed(6)}deg | ratio mean=${(naiAvg / octAvg).toFixed(3)}x max=${(naiMax / octMax).toFixed(3)}x`);

// A9 UV 容差 + 最小位深
const uvMin = minBits(mesh, "uv", CFG.tolTexels, { texSize: CFG.texSize });
ok("A9 uv tol + minimality",
  cert.uvTexels <= CFG.tolTexels && uvMin.feasible && uvMin.minimality.exceedsTol === true,
  `texels=${cert.uvTexels.toFixed(6)} tol=${CFG.tolTexels} minBits=${uvMin.bits} bits-1 fails=${uvMin.minimality.exceedsTol} @${uvMin.minimality.value.toFixed(6)}texels`);

// A10 最小性：chosen 过、chosen-1 不过且有见证
const pMin = minBits(mesh, "pos", CFG.tolRelPos);
const nMin = minBits(mesh, "nrm", CFG.tolDeg);
ok("A10 minimality pos/nrm",
  pMin.feasible && pMin.minimality.exceedsTol && nMin.feasible && nMin.minimality.exceedsTol,
  `pos minBits=${pMin.bits} (b-1=${pMin.minimality.value.toExponential(3)}>${CFG.tolRelPos} v${pMin.minimality.witness.index}); nrm minBits=${nMin.bits} (b-1=${nMin.minimality.value.toFixed(4)}>${CFG.tolDeg} v${nMin.minimality.witness.index})`);

// A11 生成器确定性
const h1 = createHash("sha256").update(readFileSync("data/mesh.json")).digest("hex");
execFileSync("node", ["tools/gen-sample.mjs"], { stdio: "ignore" });
const h2 = createHash("sha256").update(readFileSync("data/mesh.json")).digest("hex");
ok("A11 generator deterministic", h1 === h2, `sha256=${h1.slice(0, 16)}… twice identical`);

// A12 无 NaN/Inf
let bad = 0;
for (const arr of [posQ.decoded, encodeNormalsOct(mesh.normals, CFG.nrmBits).decoded, quantizeUniform(mesh.uv, 2, CFG.uvBits).decoded]) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
}
ok("A12 no NaN/Inf in decoded", bad === 0, `non-finite values=${bad}`);

// 参考数据（浏览器用同一 core 复算并逐位比对）
const naivePos = naivePositions(mesh.positions, CFG.posBits);
const naiveNrm = naiveNormals(mesh.normals, CFG.nrmBits);
const reference = {
  node: process.version,
  cfg: CFG,
  diag,
  vertices: V, triangles: T,
  posMaxError: cert.posMaxError, posRelError: cert.posRelError, posBound: cert.posBound,
  uvTexels: cert.uvTexels, nrmMaxAngleDeg: cert.nrmMaxAngleDeg, nrmMeanAngleDeg: cert.nrmMeanAngleDeg,
  nrmBoundDeg: cert.nrmBoundDeg,
  naivePosMaxError: naivePos.maxError, naiveNrmMaxAngleDeg: naiveNrm.maxAngleDeg,
  minBits: { pos: pMin.bits, uv: uvMin.bits, nrm: nMin.bits },
  sphereSweep: { n: SWEEP_N, maxAngleDeg: sweep },
  witnesses: cert.witnesses,
};
writeFileSync("data/reference.json", JSON.stringify(reference, null, 1));

console.log(`\nRESULT ${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed / ${fail} failed`);
if (fail > 0) process.exit(1);
