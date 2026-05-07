/**
 * Vader — Brain particle visualization with knowledge nodes.
 *
 * Brain-shaped particle cloud (two lobes) with floating knowledge nodes.
 * Nodes light up when Vader accesses the corresponding system.
 */

import * as THREE from "three";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface Orb {
  setState(s: OrbState): void;
  setAnalyser(a: AnalyserNode | null): void;
  activateNode(nodeId: string): void;
  destroy(): void;
}

// Knowledge nodes — positioned around the brain
const NODE_DEFS = [
  { id: "calendar", label: "Calendar",    x: -24, y:  18, z:  4 },
  { id: "mail",     label: "Mail",        x:  24, y:  18, z:  4 },
  { id: "memory",   label: "Memory",      x:   0, y:  30, z:  0 },
  { id: "spotify",  label: "Spotify",     x: -26, y: -10, z:  4 },
  { id: "bambu",    label: "Bambu",       x:  26, y: -10, z:  4 },
  { id: "screen",   label: "Screen",      x: -20, y: -22, z: -4 },
  { id: "claude",   label: "Claude Code", x:  20, y: -22, z: -4 },
] as const;

interface NodeState {
  def: typeof NODE_DEFS[number];
  mesh: THREE.Mesh;
  sprite: THREE.Sprite;
  line: THREE.Line;
  activation: number;   // 0–1, decays over time
  activatedAt: number;  // clock time of last activation
}

function makeTextSprite(label: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 56;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 56);
  ctx.fillStyle = "rgba(120, 210, 255, 0.9)";
  ctx.font = "bold 21px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 28);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(14, 3.2, 1);
  return sprite;
}

export function createOrb(canvas: HTMLCanvasElement): Orb {
  let destroyed = false;
  const N = 2000;
  const LOBE_OFFSET = 5.5;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x050508, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.z = 90;

  // ── Brain particles (two-lobe shape) ──
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const lobeSide = new Float32Array(N); // -1 = left lobe, +1 = right lobe

  for (let i = 0; i < N; i++) {
    const lobe = Math.random() < 0.5 ? -1 : 1;
    lobeSide[i] = lobe;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.35) * 18;
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta) + lobe * LOBE_OFFSET;
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.72;
    pos[i * 3 + 2] = r * Math.cos(phi) * 0.65;
    phase[i] = Math.random() * 1000;
  }

  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x4ca8e8, size: 0.4, transparent: true, opacity: 0.6,
    sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  // ── Connection lines ──
  const MAX_LINES = 8000;
  const linePos = new Float32Array(MAX_LINES * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setDrawRange(0, 0);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x4ca8e8, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lineSegs = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lineSegs);

  // ── Electrons ──
  const MAX_ELECTRONS = 200;
  const electronGeo = new THREE.BufferGeometry();
  const electronPos = new Float32Array(MAX_ELECTRONS * 3);
  electronGeo.setAttribute("position", new THREE.BufferAttribute(electronPos, 3));
  electronGeo.setDrawRange(0, 0);

  const electronMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.8, transparent: true, opacity: 1.0,
    sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const electrons = new THREE.Points(electronGeo, electronMat);
  scene.add(electrons);

  interface Electron { sx: number; sy: number; sz: number; ex: number; ey: number; ez: number; t: number; speed: number; }
  const activeElectrons: Electron[] = [];
  let electronSpawnRate = 0, targetElectronRate = 0, lastElectronSpawn = 0;
  let activeConnections: { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }[] = [];

  // ── Knowledge nodes ──
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);

  const nodeStates = new Map<string, NodeState>();
  const sphereGeo = new THREE.SphereGeometry(1.2, 10, 10);

  for (const def of NODE_DEFS) {
    // Node sphere
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0x1a4a7a, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(sphereGeo, nodeMat.clone());
    mesh.position.set(def.x, def.y, def.z);
    nodeGroup.add(mesh);

    // Text label
    const sprite = makeTextSprite(def.label);
    sprite.position.set(def.x, def.y + 3.8, def.z);
    nodeGroup.add(sprite);

    // Line from brain center to node
    const linePts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(def.x, def.y, def.z)];
    const lg = new THREE.BufferGeometry().setFromPoints(linePts);
    const lm = new THREE.LineBasicMaterial({
      color: 0x1a4a6a, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const nodeLine = new THREE.Line(lg, lm);
    nodeGroup.add(nodeLine);

    nodeStates.set(def.id, { def, mesh, sprite, line: nodeLine, activation: 0, activatedAt: -999 });
  }

  // ── State ──
  let state: OrbState = "idle";
  let targetRadius = 20, currentRadius = 20;
  let targetSpeed = 0.3, currentSpeed = 0.3;
  let targetBright = 0.6, currentBright = 0.6;
  let targetSize = 0.4, currentSize = 0.4;
  let lineAmount = 0, targetLineAmount = 0;
  const lineDistance = 8;

  let spinX = 0, spinY = 0, spinZ = 0;
  let transitionEnergy = 0;
  let lastState: OrbState = "idle";
  let cloudZ = 0, cloudZVel = 0;

  // ── Audio ──
  let analyser: AnalyserNode | null = null;
  let freqData = new Uint8Array(64);
  let bass = 0, mid = 0;

  const clock = new THREE.Clock();

  function animate() {
    if (destroyed) return;
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    switch (state) {
      case "idle":
        targetRadius = 20; targetSpeed = 0.2; targetBright = 0.5; targetSize = 0.35;
        targetLineAmount = 0.15; targetElectronRate = 0; break;
      case "listening":
        targetRadius = 17; targetSpeed = 0.3; targetBright = 0.65; targetSize = 0.4;
        targetLineAmount = 0.4; targetElectronRate = 0; break;
      case "thinking":
        targetRadius = 13; targetSpeed = 0.5; targetBright = 0.7; targetSize = 0.3;
        targetLineAmount = 1.0; targetElectronRate = 0.015; break;
      case "speaking":
        targetRadius = 15; targetSpeed = 0.2; targetBright = 0.7; targetSize = 0.4;
        targetLineAmount = 0.8; targetElectronRate = 0; break;
    }

    currentRadius += (targetRadius - currentRadius) * 0.02;
    currentSpeed += (targetSpeed - currentSpeed) * 0.02;
    currentBright += (targetBright - currentBright) * 0.02;
    currentSize += (targetSize - currentSize) * 0.02;
    lineAmount += (targetLineAmount - lineAmount) * 0.02;
    electronSpawnRate += (targetElectronRate - electronSpawnRate) * 0.02;

    if (state !== lastState) { transitionEnergy = 1.0; lastState = state; }
    transitionEnergy *= 0.985;
    if (transitionEnergy > 0.05) {
      spinX += transitionEnergy * 0.012 * Math.sin(t * 1.7);
      spinY += transitionEnergy * 0.015;
      spinZ += transitionEnergy * 0.008 * Math.cos(t * 1.3);
    }

    bass = 0; mid = 0;
    if (analyser) {
      analyser.getByteFrequencyData(freqData);
      let bSum = 0, mSum = 0;
      for (let i = 0; i < 8; i++) bSum += freqData[i];
      for (let i = 8; i < 24; i++) mSum += freqData[i];
      bass = bSum / (8 * 255); mid = mSum / (16 * 255);
    }

    let zTarget = Math.sin(t * 0.12) * 8;
    if (state === "thinking") zTarget = Math.sin(t * 0.3) * 15 + Math.sin(t * 0.9) * 6;
    else if (state === "speaking") zTarget = Math.sin(t * 0.15) * 6 - bass * 10;
    cloudZVel += (zTarget - cloudZ) * 0.008;
    cloudZVel *= 0.94;
    cloudZ += cloudZVel;

    points.rotation.x = spinX; points.rotation.y = spinY; points.rotation.z = spinZ;
    points.position.z = cloudZ;
    lineSegs.rotation.x = spinX; lineSegs.rotation.y = spinY; lineSegs.rotation.z = spinZ;
    lineSegs.position.z = cloudZ;

    // ── Update brain particles ──
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = p.array as Float32Array;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const x = a[i3], y = a[i3 + 1], z = a[i3 + 2];
      const px = phase[i];
      const lobeCX = lobeSide[i] * LOBE_OFFSET;

      vel[i3]     += Math.sin(t * 0.05 + px) * 0.001 * currentSpeed;
      vel[i3 + 1] += Math.cos(t * 0.06 + px * 1.3) * 0.001 * currentSpeed;
      vel[i3 + 2] += Math.sin(t * 0.055 + px * 0.7) * 0.001 * currentSpeed;
      vel[i3]     += Math.sin(t * 0.02 + px * 2.1 + y * 0.1) * 0.0008 * currentSpeed;
      vel[i3 + 1] += Math.cos(t * 0.025 + px * 1.7 + z * 0.1) * 0.0008 * currentSpeed;
      vel[i3 + 2] += Math.sin(t * 0.022 + px * 0.9 + x * 0.1) * 0.0008 * currentSpeed;

      // Pull toward lobe center to maintain brain shape
      const dx = x - lobeCX, dy = y, dz = z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const pull = Math.max(0, dist - currentRadius) * 0.002 + 0.0003;
      vel[i3]     -= (dx / dist) * pull;
      vel[i3 + 1] -= (dy / dist) * pull;
      vel[i3 + 2] -= (dz / dist) * pull;

      if (bass > 0.05) {
        vel[i3]     += (dx / dist) * bass * 0.02;
        vel[i3 + 1] += (dy / dist) * bass * 0.02;
        vel[i3 + 2] += (dz / dist) * bass * 0.02;
      }
      if (state === "speaking" && mid > 0.1) {
        const pulse = Math.sin(t * 8 + px);
        vel[i3]     += (dx / dist) * mid * 0.012 * pulse;
        vel[i3 + 1] += (dy / dist) * mid * 0.012 * pulse;
      }

      vel[i3] *= 0.992; vel[i3 + 1] *= 0.992; vel[i3 + 2] *= 0.992;
      a[i3] += vel[i3]; a[i3 + 1] += vel[i3 + 1]; a[i3 + 2] += vel[i3 + 2];
    }
    p.needsUpdate = true;

    // ── Update connection lines ──
    if (lineAmount > 0.01) {
      const lp = lineGeo.getAttribute("position") as THREE.BufferAttribute;
      const la = lp.array as Float32Array;
      let lineCount = 0;
      const maxDist = lineDistance * (1 + bass * 0.5);
      const maxDistSq = maxDist * maxDist;
      const step = Math.max(1, Math.floor(N / 600));

      for (let i = 0; i < N && lineCount < MAX_LINES; i += step) {
        const i3 = i * 3;
        const x1 = a[i3], y1 = a[i3 + 1], z1 = a[i3 + 2];
        for (let j = i + step; j < N && lineCount < MAX_LINES; j += step) {
          const j3 = j * 3;
          const ddx = a[j3] - x1, ddy = a[j3 + 1] - y1, ddz = a[j3 + 2] - z1;
          if (ddx * ddx + ddy * ddy + ddz * ddz < maxDistSq) {
            const idx = lineCount * 6;
            la[idx] = x1; la[idx+1] = y1; la[idx+2] = z1;
            la[idx+3] = a[j3]; la[idx+4] = a[j3+1]; la[idx+5] = a[j3+2];
            lineCount++;
          }
        }
      }
      lineGeo.setDrawRange(0, lineCount * 2);
      lp.needsUpdate = true;
      lineMat.opacity = lineAmount * 0.12;

      activeConnections = [];
      for (let c = 0; c < Math.min(lineCount, 500); c++) {
        const ci = c * 6;
        activeConnections.push({ x1: la[ci], y1: la[ci+1], z1: la[ci+2], x2: la[ci+3], y2: la[ci+4], z2: la[ci+5] });
      }
    } else {
      lineGeo.setDrawRange(0, 0);
      activeConnections = [];
    }

    // ── Update electrons ──
    if (activeConnections.length > 0 && electronSpawnRate > 0.005) {
      if (activeElectrons.length < 3 && (t - lastElectronSpawn) > 1.0) {
        const conn = activeConnections[Math.floor(Math.random() * activeConnections.length)];
        activeElectrons.push({ sx: conn.x1, sy: conn.y1, sz: conn.z1, ex: conn.x2, ey: conn.y2, ez: conn.z2, t: 0, speed: 0.003 + Math.random() * 0.003 });
        lastElectronSpawn = t;
      }
    }

    const ep = electronGeo.getAttribute("position") as THREE.BufferAttribute;
    const ea = ep.array as Float32Array;
    let aliveCount = 0;

    for (let e = activeElectrons.length - 1; e >= 0; e--) {
      const el = activeElectrons[e];
      el.t += el.speed;
      if (el.t >= 1) { activeElectrons.splice(e, 1); continue; }
      const ei = aliveCount * 3;
      ea[ei] = el.sx + (el.ex - el.sx) * el.t;
      ea[ei+1] = el.sy + (el.ey - el.sy) * el.t;
      ea[ei+2] = el.sz + (el.ez - el.sz) * el.t;
      aliveCount++;
    }

    electronGeo.setDrawRange(0, aliveCount);
    ep.needsUpdate = true;
    electrons.rotation.x = spinX; electrons.rotation.y = spinY; electrons.rotation.z = spinZ;
    electrons.position.z = cloudZ;

    mat.opacity = currentBright + bass * 0.08;
    mat.size = currentSize + bass * 0.05;

    if (state === "thinking")      { mat.color.lerp(new THREE.Color(0x6ec4ff), 0.015); lineMat.color.lerp(new THREE.Color(0x6ec4ff), 0.015); }
    else if (state === "speaking") { mat.color.lerp(new THREE.Color(0x5ab8f0), 0.015); lineMat.color.lerp(new THREE.Color(0x5ab8f0), 0.015); }
    else                           { mat.color.lerp(new THREE.Color(0x4ca8e8), 0.015); lineMat.color.lerp(new THREE.Color(0x4ca8e8), 0.015); }

    // ── Update knowledge nodes ──
    for (const [, ns] of nodeStates) {
      const age = t - ns.activatedAt;
      ns.activation = Math.max(0, 1 - age / 3.0);

      const glow = ns.activation * (0.85 + Math.sin(t * 5 + ns.def.x) * 0.1 * ns.activation);
      const nodeMat = ns.mesh.material as THREE.MeshBasicMaterial;
      nodeMat.opacity = 0.15 + glow * 0.75;
      if (ns.activation > 0.1) {
        nodeMat.color.set(new THREE.Color(0x00ccff).lerp(new THREE.Color(0x2277cc), 1 - ns.activation));
      } else {
        nodeMat.color.set(0x1a4a7a);
      }

      const spriteMat = ns.sprite.material as THREE.SpriteMaterial;
      spriteMat.opacity = 0.25 + ns.activation * 0.75;

      const lm2 = ns.line.material as THREE.LineBasicMaterial;
      lm2.opacity = 0.08 + ns.activation * 0.45;
      if (ns.activation > 0.1) lm2.color.set(0x00aaff);
      else lm2.color.set(0x1a4a6a);
    }

    nodeGroup.rotation.y = spinY * 0.25;

    camera.position.x = Math.sin(t * 0.02) * 5;
    camera.position.y = Math.cos(t * 0.03) * 3;
    camera.lookAt(0, 0, cloudZ * 0.2);

    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener("resize", onResize);
  animate();

  return {
    setState(s: OrbState) { state = s; },
    setAnalyser(a: AnalyserNode | null) {
      analyser = a;
      if (a) freqData = new Uint8Array(a.frequencyBinCount);
    },
    activateNode(nodeId: string) {
      const ns = nodeStates.get(nodeId);
      if (!ns) return;
      ns.activation = 1.0;
      ns.activatedAt = clock.getElapsedTime();
      // Spawn an electron from brain center toward the node
      if (activeElectrons.length < MAX_ELECTRONS - 1) {
        activeElectrons.push({
          sx: (Math.random() - 0.5) * 8, sy: (Math.random() - 0.5) * 6, sz: (Math.random() - 0.5) * 4,
          ex: ns.def.x * 0.7, ey: ns.def.y * 0.7, ez: ns.def.z * 0.7,
          t: 0, speed: 0.012 + Math.random() * 0.006,
        });
      }
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    },
  };
}
