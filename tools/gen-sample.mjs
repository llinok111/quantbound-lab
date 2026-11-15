/*
 * tools/gen-sample.mjs — 确定性生成示例网格到 data/
 *
 * 生成一条 NX×NY 的波纹薄带，输出顶点位置 / UV / 面积加权顶点法向 / 三角索引。
 * 无随机、无时间戳：同一条命令跑两次产物字节一致。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");

const NX = 280, NY = 56;
const L = 1.0, W = 0.35;
const r6 = (x) => Number(x.toFixed(6));

const positions = [], uv = [];
for (let iy = 0; iy <= NY; iy++) {
  const y = (iy / NY - 0.5) * W;
  for (let ix = 0; ix <= NX; ix++) {
    const x = (ix / NX) * L;
    const z = 0.030 * Math.sin(6 * Math.PI * x) * Math.cos(2 * Math.PI * (y / W));
    positions.push(r6(x), r6(y), r6(z));
    uv.push(r6(ix / NX), r6(iy / NY));
  }
}
const indices = [];
for (let iy = 0; iy < NY; iy++) {
  for (let ix = 0; ix < NX; ix++) {
    const a = iy * (NX + 1) + ix, b = a + 1, c = a + (NX + 1), d = c + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
}
const V = positions.length / 3;

// 面积加权顶点法向（确定性）
const normals = new Float64Array(3 * V);
const P = positions;
for (let t = 0; t < indices.length; t += 3) {
  const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
  const ux = P[3 * i1] - P[3 * i0], uy = P[3 * i1 + 1] - P[3 * i0 + 1], uz = P[3 * i1 + 2] - P[3 * i0 + 2];
  const vx = P[3 * i2] - P[3 * i0], vy = P[3 * i2 + 1] - P[3 * i0 + 1], vz = P[3 * i2 + 2] - P[3 * i0 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const i of [i0, i1, i2]) { normals[3 * i] += nx; normals[3 * i + 1] += ny; normals[3 * i + 2] += nz; }
}
for (let i = 0; i < V; i++) {
  const n = Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]) || 1;
  normals[3 * i] = r6(normals[3 * i] / n);
  normals[3 * i + 1] = r6(normals[3 * i + 1] / n);
  normals[3 * i + 2] = r6(normals[3 * i + 2] / n);
}

const mesh = {
  positions, uv, normals: Array.from(normals), indices,
};
mkdirSync(dataDir, { recursive: true });
const json = JSON.stringify(mesh);
writeFileSync(join(dataDir, "mesh.json"), json);
const h = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
console.log(`mesh: ${V} vertices, ${indices.length / 3} triangles, ${(json.length / 1048576).toFixed(2)} MB`);
console.log(`sha256(mesh.json) = ${h(json)}`);
