/* main.js — 只做渲染与交互；量化计算全部来自 src/core.mjs（与 node 同一份代码） */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { quantizeUniform, encodeNormalsOct, bboxDiag } from "./src/core.mjs";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.001, 100);
camera.position.set(1.1, -1.0, 0.9);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.0));

const mesh = await (await fetch("./data/mesh.json")).json();
const ref = await (await fetch("./data/reference.json")).json();
const positions = Float64Array.from(mesh.positions);
const normals = Float64Array.from(mesh.normals);
const diag = bboxDiag(positions);

const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(positions), 3));
geo.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(normals), 3));
geo.setIndex(mesh.indices);
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.05 });
const obj = new THREE.Mesh(geo, mat);
obj.geometry.center();
obj.position.set(0, 0, 0);
scene.add(obj);

function heat(t) { // 0 → 蓝, 1 → 红
  const c = new THREE.Color();
  c.setHSL(0.66 * (1 - Math.min(1, t * 4)), 0.85, 0.5);
  return c;
}

function recompute(posBits, nrmBits) {
  const pq = quantizeUniform(positions, 3, posBits);
  const nq = encodeNormalsOct(normals, nrmBits);
  const err = new Float64Array(positions.length / 3);
  let maxRel = 0;
  for (let v = 0; v < err.length; v++) {
    const e = Math.hypot(
      positions[3 * v] - pq.decoded[3 * v],
      positions[3 * v + 1] - pq.decoded[3 * v + 1],
      positions[3 * v + 2] - pq.decoded[3 * v + 2]);
    err[v] = e; if (e / diag > maxRel) maxRel = e / diag;
  }
  const colors = new Float32Array(3 * err.length);
  for (let v = 0; v < err.length; v++) { const c = heat(err[v] / diag); colors[3 * v] = c.r; colors[3 * v + 1] = c.g; colors[3 * v + 2] = c.b; }
  geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pq.decoded), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(nq.decoded), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return { maxRel, pq, nq };
}

const posEl = document.getElementById("pos"), nrmEl = document.getElementById("nrm");
function refresh() {
  const posBits = +posEl.value, nrmBits = +nrmEl.value;
  document.getElementById("pb").textContent = posBits;
  document.getElementById("nb").textContent = nrmBits;
  const r = recompute(posBits, nrmBits);
  const rows = [
    ["pos rel error", r.maxRel.toExponential(4)],
    ["node pos rel (12b)", ref.posRelError.toExponential(4)],
    ["normal max deg", r.nq.maxAngleDeg.toFixed(4)],
    ["node normal max (8b)", ref.nrmMaxAngleDeg.toFixed(4)],
  ];
  document.getElementById("tbl").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const samePos = Math.abs(r.maxRel - ref.posRelError) <= 1e-12 * Math.max(1, ref.posRelError);
  const v = document.getElementById("verdict");
  if (posBits === 12 && nrmBits === 8) {
    v.innerHTML = samePos
      ? `<span class="ok">✔ 浏览器与 node 12-bit 位置最坏相对误差逐位一致</span>`
      : `<span class="bad">✘ 与 node 参考值不一致</span>`;
  } else v.textContent = "（把滑块调回 12 / 8 触发与 node 的逐位比对）";
}
posEl.addEventListener("input", refresh);
nrmEl.addEventListener("input", refresh);
refresh();
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
