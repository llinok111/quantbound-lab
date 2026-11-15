
## 2026-11-15 08:35 · 3D 新项目（原创，发布）
- 做了什么：`llinok111/quantbound-lab` — 顶点属性量化误差证书 + 容差下最小位深。位置/UV 逐轴均匀量化给出
  「逐轴 halfStep 解析上界 + 全顶点实测精确最坏误差 + 见证顶点」；法向用八面体编码，给出网格精确最坏/平均角误差，
  并用 **200,000 条 Fibonacci 球面方向**独立扫描整个码本域验证保守上界（2.2×步长）在 bits 4…14 上从不下穿真实值；
  `minBits` 二分求最小位深并对 bits-1 给出**必然超容差的见证顶点**。浏览器拖位深看误差热力图，同一份 core 在页面复算并与 node 逐位比对。
- 结果：**发布**（public，pushed_at 2026-11-15T00:32Z；干净克隆复跑 `node tools/gen-sample.mjs && node bench/verify.mjs` → `RESULT PASS: 12 passed / 0 failed`，且 regen 后 `git status --porcelain` 为空）
- 仓库：https://github.com/llinok111/quantbound-lab
- 关键实测数字（bench/result.json，7 samples + cold；Node v24.19.0）：
  - 网格 16,017 顶点 / 31,360 三角；位置 12 bit 相对 bbox 对角线误差 **1.2210e-4**（解析上界 1.2957e-4）
  - 独立 oracle（另一套写法）在 8/10/12/14/16 bit 复现最坏误差，最大相对差 **3.535e-14**
  - 法向八面体 8 bit/轴（16 bit 总预算）：网格最坏 **0.6425°**、平均 **0.2728°**；200k 球面扫最坏 **0.935567°**
  - 等总预算对照：逐分量 15 bit 平均 **1.4219°**/最坏 **2.9513°** → **5.212× / 4.593×** 差
  - UV 12 bit → **0.3536 texel**@2048；最小位深 pos **9**（8 bit 1.961e-3 必失败, v8008）/ uv **12**（11 bit 0.7075 必失败）/ nrm **8**（7 bit 1.2279° 必失败）
  - 尺度 1e-6…1e6：相对误差散布 **3.248e-13**，最小位深恒为 9
  - 证书全网格中位 **5.896 ms**（冷 20.217）；200k 方向球面 oracle 中位 **26.162 ms**（冷 31.562）→ 证书 **4.44×** 快；
    朴素基线中位 4.996 ms（证书比朴素慢 0.847×，因为证书额外给精确最坏值与见证——已如实写进 README）
  - `sha256(mesh.json)=c24118d9c5d98f75…`，生成器跑两次一致
- 质量闸门：G1–G9 全过（G2 `node --check` ×6；G3 core 无 three/window/document/navigator 非注释命中 + import 无报错；
  G4 12/12 带具体数值；G5 7 samples + cold + relStddev；G6 200 + importmap=1；G7 `rm -rf data` 重建字节一致；
  G8 全仓无无头浏览器工具字样（首次被 README 自己提到而命中，已改措辞并重推）；G9 README 有承诺/运行/证据）
- 创新：**B**。台账无「顶点属性量化误差证书 / 最小位深」条目；`gltf-audit-lab`（容器完整性）、
  `depthbudget/depthfence`（深度精度）、`gradfit-lab`（梯度认证）均不重叠。
- 已评估上游回馈：原创主题，无对应上游仓库可修，按契约交 **0** 个提案（未写 state/upstream-pr.json）。
### 未完成 / 下一轮续接
1. 法向上界是**经验保守界**（2.2×步长），只在 bits 4…14 × 200k Fibonacci 方向上验证 sound，不是整球解析证明——
   下一轮可推导严格上界（八面体映射的 Lipschitz 常数）替换经验界。
2. 若按**每轴相同位深**比，逐分量 8 bit 反而优于八面体 8 bit（最坏 0.3403° vs 0.6425°）；5.21× 只在等**总比特预算**口径成立，README 已写明。
3. 位置/UV 用整体紧 bbox 逐轴均匀量化；含离群点时步长被拉大，未做按块/per-primitive 量化。
4. 未做真实 glTF 资产输入（示例网格是脚本生成的合成薄带，自有 JSON 格式，不是 glTF 二进制）。
5. 无自动化浏览器测试（硬性禁止无头浏览器）；只验证了静态服务 200 + importmap=1 + 页面与 node 共用同一 core。
6. `/home/ubuntu/GitHub/pipelines/state/*` 的追加被沙箱拒绝，等价记录已写在本目录
   `state/{runs-entry.jsonl,used-upstreams-entry.txt,innovation-entry.md,PROJECTS-entry.md}`，请归档时代为追加。
### 本轮选题去重记录（重要）
- 原计划「蒙皮动画连续时间自交证书 + 最小姿态修复」经只读子 agent 核查后**判定会撞车**：`llinok111/skinint-cert-lab`
  已于 2026-11-15T04:29 发布并被 ACCEPTED，逐点覆盖了 LBS + 扫掠 AABB + 连续时间区间证书 + 修复；
  前身链还有 `skinbound-lab` / `mesh-selfint-lab` / `toi-cert-lab`。因此**整条蒙皮 CCD 线本轮机放弃**，改题。
- 另一候选「点云法向估计证书」也已被 `llinok111/pointnorm-cert-lab`（2026-11-15T00:55）占用，未做。
