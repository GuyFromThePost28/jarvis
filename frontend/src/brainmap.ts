/**
 * Vader Brain Map — 3D knowledge graph explorer.
 *
 * Opens as a full-screen overlay from the menu.
 * Nodes fetched from /api/nodes. OrbitControls for look-around.
 * Click any node to see its details and recent activity.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

interface NodeDef {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

interface LiveNode {
  def: NodeDef;
  mesh: THREE.Mesh;
  sprite: THREE.Sprite;
  glow: THREE.Mesh;
  lastActivated: number;
  activationCount: number;
}

// Node descriptions shown in the info panel
const NODE_INFO: Record<string, { icon: string; desc: string; color: number }> = {
  calendar:  { icon: "📅", desc: "Apple Calendar — reads your events and schedule.", color: 0x00aaff },
  mail:      { icon: "✉️", desc: "Apple Mail — read-only access to your inbox.", color: 0x00ffee },
  memory:    { icon: "🧠", desc: "Long-term memory — facts Vader has learned about you.", color: 0xcc00ff },
  spotify:   { icon: "🎵", desc: "Spotify — play, pause, skip, volume control.", color: 0x00ff66 },
  bambu:     { icon: "🖨️", desc: "Bambu Lab printer — monitor and control prints.", color: 0xff3300 },
  screen:    { icon: "🖥️", desc: "Screen awareness — Vader can see your open apps.", color: 0x00ffcc },
  claude:    { icon: "⚡", desc: "Claude Code — spawns dev tasks in your projects.", color: 0xffee00 },
  obsidian:  { icon: "🔮", desc: "Obsidian vault — every memory and note Vader stores, visible as a knowledge graph.", color: 0x9b59b6 },
};

function makeLabel(label: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 300; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 300, 64);
  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.fillStyle = hex;
  ctx.font = "bold 24px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 150, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(18, 4, 1);
  return sprite;
}

export class BrainMap {
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private nodes: Map<string, LiveNode> = new Map();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private infoPanel: HTMLDivElement;
  private animId = 0;
  private clock = new THREE.Clock();
  private memoryCount = 0;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.id = "brain-map-overlay";
    Object.assign(this.overlay.style, {
      position: "fixed", inset: "0", background: "rgba(3,4,8,0.97)",
      zIndex: "1000", display: "none", flexDirection: "column",
    });

    // Header bar
    const header = document.createElement("div");
    Object.assign(header.style, {
      position: "absolute", top: "0", left: "0", right: "0",
      padding: "16px 24px", display: "flex", alignItems: "center",
      justifyContent: "space-between", zIndex: "10",
      background: "linear-gradient(to bottom, rgba(5,5,12,0.9), transparent)",
    });
    header.innerHTML = `
      <div style="color:#4ca8e8;font-family:'Courier New',monospace;font-size:13px;letter-spacing:3px;opacity:0.8">
        VADER / NEURAL MAP
      </div>
      <button id="brain-map-close" style="background:none;border:1px solid rgba(76,168,232,0.3);color:#4ca8e8;
        font-family:'Courier New',monospace;font-size:12px;padding:6px 16px;cursor:pointer;letter-spacing:2px;
        border-radius:2px">CLOSE</button>
    `;
    this.overlay.appendChild(header);

    // Canvas
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
    this.overlay.appendChild(this.canvas);

    // Info panel (right side, hidden by default)
    this.infoPanel = document.createElement("div");
    this.infoPanel.id = "brain-map-info";
    Object.assign(this.infoPanel.style, {
      position: "absolute", right: "0", top: "0", bottom: "0", width: "300px",
      background: "rgba(5,10,20,0.92)", borderLeft: "1px solid rgba(76,168,232,0.2)",
      padding: "80px 24px 24px", zIndex: "5", display: "none",
      fontFamily: "'Courier New', monospace", color: "#4ca8e8",
      transition: "transform 0.3s ease",
    });
    this.overlay.appendChild(this.infoPanel);

    // Hint text
    const hint = document.createElement("div");
    Object.assign(hint.style, {
      position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)",
      color: "rgba(76,168,232,0.4)", fontFamily: "'Courier New',monospace",
      fontSize: "11px", letterSpacing: "2px", zIndex: "5", pointerEvents: "none",
    });
    hint.textContent = "DRAG TO ORBIT  ·  SCROLL TO ZOOM  ·  CLICK NODE FOR DETAILS";
    this.overlay.appendChild(hint);

    document.body.appendChild(this.overlay);

    // Three.js setup
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 0, 120);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 300;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;

    // Central brain glow
    const brainGeo = new THREE.SphereGeometry(8, 16, 16);
    const brainMat = new THREE.MeshBasicMaterial({ color: 0x1a4a8a, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending });
    this.scene.add(new THREE.Mesh(brainGeo, brainMat));

    // Stars background
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500 * 3; i++) starPos[i] = (Math.random() - 0.5) * 800;
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x334466, size: 0.5, transparent: true, opacity: 0.6 });
    this.scene.add(new THREE.Points(starGeo, starMat));

    this.bindEvents();
  }

  private bindEvents() {
    document.getElementById("brain-map-close")?.addEventListener("click", () => this.close());
    this.overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });

    this.canvas.addEventListener("click", (e) => this.onCanvasClick(e));
    this.canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener("resize", () => this.onResize());
  }

  private onCanvasClick(e: MouseEvent) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes = [...this.nodes.values()].map(n => n.mesh);
    const hits = this.raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh;
      for (const [, n] of this.nodes) {
        if (n.mesh === hitMesh) { this.showInfo(n); break; }
      }
      this.controls.autoRotate = false;
    } else {
      this.infoPanel.style.display = "none";
      this.controls.autoRotate = true;
    }
  }

  private showInfo(node: LiveNode) {
    const info = NODE_INFO[node.def.id] || { icon: "●", desc: "Custom integration.", color: 0x4ca8e8 };
    const lastSeen = node.lastActivated > 0
      ? `${Math.round((Date.now() / 1000 - node.lastActivated))}s ago`
      : "Not yet used";
    const hex = "#" + info.color.toString(16).padStart(6, "0");

    this.infoPanel.innerHTML = `
      <div style="font-size:32px;margin-bottom:12px">${info.icon}</div>
      <div style="font-size:18px;color:${hex};letter-spacing:2px;margin-bottom:8px">${node.def.label.toUpperCase()}</div>
      <div style="font-size:11px;color:rgba(76,168,232,0.5);margin-bottom:24px;line-height:1.6">${info.desc}</div>
      <div style="border-top:1px solid rgba(76,168,232,0.15);padding-top:16px;font-size:11px;color:rgba(76,168,232,0.4)">
        <div style="margin-bottom:8px">ACTIVATIONS <span style="color:${hex}">${node.activationCount}</span></div>
        <div>LAST USED <span style="color:${hex}">${lastSeen}</span></div>
        ${node.def.id === "memory" ? `<div style="margin-top:8px">MEMORIES STORED <span style="color:${hex}">${this.memoryCount}</span></div>` : ""}
      </div>
    `;
    this.infoPanel.style.display = "block";
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private addNodeToScene(def: NodeDef, animate: boolean) {
    if (this.nodes.has(def.id)) return;

    const info = NODE_INFO[def.id] || { icon: "●", desc: "", color: 0x4ca8e8 };
    const color = info.color;

    // Node sphere
    const geo = new THREE.SphereGeometry(5, 20, 20);
    const nodeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: animate ? 0 : 0.95, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, nodeMat);
    mesh.position.set(def.x, def.y, def.z);
    this.scene.add(mesh);

    // Outer glow ring
    const glowGeo = new THREE.SphereGeometry(9, 20, 20);
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: animate ? 0 : 0.35, blending: THREE.AdditiveBlending, side: THREE.BackSide });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(mesh.position);
    this.scene.add(glow);

    // Label
    const sprite = makeLabel(def.label, color);
    sprite.position.set(def.x, def.y + 10, def.z);
    this.scene.add(sprite);

    // Line from center to node
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(def.x, def.y, def.z)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });
    this.scene.add(new THREE.Line(lineGeo, lineMat));

    const liveNode: LiveNode = { def, mesh, sprite, glow, lastActivated: 0, activationCount: 0 };
    this.nodes.set(def.id, liveNode);

    // Grow-in animation
    if (animate) {
      let progress = 0;
      const grow = () => {
        progress = Math.min(1, progress + 0.02);
        (mesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.95;
        (glow.material as THREE.MeshBasicMaterial).opacity = progress * 0.35;
        const spriteMat = sprite.material as THREE.SpriteMaterial;
        spriteMat.opacity = progress;
        mesh.scale.setScalar(0.1 + progress * 0.9);
        glow.scale.setScalar(0.1 + progress * 0.9);
        if (progress < 1) requestAnimationFrame(grow);
      };
      requestAnimationFrame(grow);
    }
  }

  private animate() {
    this.animId = requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();
    this.controls.update();

    // Pulse node glows
    for (const [, n] of this.nodes) {
      const age = Date.now() / 1000 - n.lastActivated;
      const recentActivation = Math.max(0, 1 - age / 5);
      const pulse = Math.sin(t * 2 + n.def.x) * 0.08;
      const glowMat = n.glow.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.28 + pulse + recentActivation * 0.35;
      const nodeMat = n.mesh.material as THREE.MeshBasicMaterial;
      nodeMat.opacity = 0.85 + pulse * 1.5 + recentActivation * 0.15;
    }

    // Hover highlight
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [...this.nodes.values()].map(n => n.mesh);
    const hits = this.raycaster.intersectObjects(meshes);
    this.canvas.style.cursor = hits.length > 0 ? "pointer" : "grab";

    this.renderer.render(this.scene, this.camera);
  }

  async open() {
    this.overlay.style.display = "flex";
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Fetch nodes from server
    try {
      const res = await fetch("/api/nodes");
      const defs: NodeDef[] = await res.json();
      for (const def of defs) this.addNodeToScene(def, false);
    } catch {
      // Fallback if server not reachable
    }

    this.clock.start();
    this.animate();
  }

  close() {
    this.overlay.style.display = "none";
    cancelAnimationFrame(this.animId);
    this.controls.autoRotate = true;
    this.infoPanel.style.display = "none";
  }

  // Called from main.ts when server sends node_activate
  activateNode(nodeId: string) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    n.lastActivated = Date.now() / 1000;
    n.activationCount++;
    // Brief flash
    const mat = n.mesh.material as THREE.MeshBasicMaterial;
    const orig = mat.opacity;
    mat.opacity = 1.0;
    setTimeout(() => { mat.opacity = orig; }, 300);
  }

  // Called from main.ts on memory_store event
  onMemoryStore() {
    this.memoryCount++;
    this.activateNode("memory");
  }

  // Called when a new node is dynamically added
  addNode(def: NodeDef) {
    this.addNodeToScene(def, this.overlay.style.display !== "none");
  }
}

export const brainMap = new BrainMap();
