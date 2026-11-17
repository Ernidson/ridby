// SPDX-License-Identifier: MIT OR Apache-2.0
// Shoulder mesh deformation and pose corrections from Rigby Auto-Rig 2D v0.4
// Ported to Rigby2D main project architecture.

import { Affine } from './math.js';

const DEG = Math.PI / 180;

// Work Auto-Rig canvas: 1024x1536, origin top-left, Y down
const WORK_WIDTH = 1024;
const WORK_HEIGHT = 1536;
const WORK_CENTER_X = 512;

// Shoulder mesh: 15x19 grid, 16px spacing, origin at (272, 304) in Work coords
const SHOULDER_GRID_W = 15;
const SHOULDER_GRID_H = 19;
const SHOULDER_STEP = 16;
const SHOULDER_ORIGIN_X = 272;
const SHOULDER_ORIGIN_Y = 304;

// Generate shoulder mesh vertices (285 vertices = 15 * 19)
export function generateShoulderVertices() {
  const vertices = [];
  for (let y = 0; y < SHOULDER_GRID_H; y++) {
    for (let x = 0; x < SHOULDER_GRID_W; x++) {
      vertices.push([
        SHOULDER_ORIGIN_X + x * SHOULDER_STEP,
        SHOULDER_ORIGIN_Y + y * SHOULDER_STEP
      ]);
    }
  }
  return vertices;
}

// Generate shoulder mesh triangles (504 triangles)
export function generateShoulderTriangles() {
  const triangles = [];
  const edges = new Set();
  
  for (let y = 0; y < SHOULDER_GRID_H - 1; y++) {
    for (let x = 0; x < SHOULDER_GRID_W - 1; x++) {
      const a = y * SHOULDER_GRID_W + x;
      const b = y * SHOULDER_GRID_W + x + 1;
      const c = (y + 1) * SHOULDER_GRID_W + x;
      const d = (y + 1) * SHOULDER_GRID_W + x + 1;
      
      triangles.push([a, b, d]);
      triangles.push([a, d, c]);
      
      // Track edges for constraint solving
      addEdge(edges, a, b);
      addEdge(edges, b, d);
      addEdge(edges, d, c);
      addEdge(edges, c, a);
      addEdge(edges, a, d);
      addEdge(edges, b, c);
    }
  }
  
  return { triangles, edges: Array.from(edges) };
}

function addEdge(edges, a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  edges.add(key);
}

// Mirror vertices for right shoulder (X mirror around center)
export function mirrorShoulderVertices(vertices) {
  return vertices.map(([x, y]) => [WORK_WIDTH - x, y]);
}

// Pose amount calculation from shoulder rotation
export function calculatePoseAmount(setupJoints, currentJoints, side) {
  const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  
  const setupShoulder = setupJoints[side === 'l' ? 'ls' : 'rs'];
  const setupElbow = setupJoints[side === 'l' ? 'le' : 're'];
  const currentShoulder = currentJoints[side === 'l' ? 'ls' : 'rs'];
  const currentElbow = currentJoints[side === 'l' ? 'le' : 're'];
  const setupRoot = setupJoints.root;
  const setupNeck = setupJoints.neck;
  const currentRoot = currentJoints.root;
  const currentNeck = currentJoints.neck;
  
  let t = angle(currentShoulder, currentElbow) - angle(setupShoulder, setupElbow);
  t -= angle(currentRoot, currentNeck) - angle(setupRoot, setupNeck);
  
  return Math.min(1, Math.max(0, Math.abs(Math.atan2(Math.sin(t), Math.cos(t))) / 2.15));
}

// Torso transform: maps a point from setup torso space to current torso space
export function transformTorso(point, setupJoints, currentJoints) {
  const setupRoot = setupJoints.root;
  const setupNeck = setupJoints.neck;
  const currentRoot = currentJoints.root;
  const currentNeck = currentJoints.neck;
  
  const angle = Math.atan2(currentNeck[1] - currentRoot[1], currentNeck[0] - currentRoot[0]) -
                Math.atan2(setupNeck[1] - setupRoot[1], setupNeck[0] - setupRoot[0]);
  
  const dx = point[0] - setupRoot[0];
  const dy = point[1] - setupRoot[1];
  
  return [
    currentRoot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    currentRoot[1] + dx * Math.sin(angle) + dy * Math.cos(angle)
  ];
}

// Smoothstep interpolation
export function smoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

// Clamp helper
export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// Triangle area (signed)
export function triangleArea(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// Solve shoulder mesh with constraints
export function solveShoulderMesh(setupJoints, currentJoints, side, config) {
  const { vertices, triangles, edges } = generateShoulderTriangles();
  const sign = side === 'l' ? 1 : -1;
  const isLeft = side === 'l';
  
  // Get source vertices (in Work coordinates, Y down)
  const sourceVertices = isLeft ? vertices : mirrorShoulderVertices(vertices);
  
  // Base positions: torso-transformed source vertices
  const base = sourceVertices.map(v => transformTorso(v, setupJoints, currentJoints));
  
  // Target positions from rotation field (simplified)
  const target = sourceVertices.map((v, i) => {
    const x = v[0], y = v[1];
    const interior = smoothstep(Math.min(
      (x - SHOULDER_ORIGIN_X) / 32,
      (SHOULDER_ORIGIN_X + SHOULDER_GRID_W * SHOULDER_STEP - x) / 32,
      (y - SHOULDER_ORIGIN_Y) / 32,
      (SHOULDER_ORIGIN_Y + SHOULDER_GRID_H * SHOULDER_STEP - y) / 32
    ));
    const collar = smoothstep((x - 400) / 50) * (1 - smoothstep((y - 450) / 75));
    const w = 1 - collar * 0.96;
    const weight = config?.weights?.[i] ?? w;
    
    // Rotation field point
    const shoulder = currentJoints[isLeft ? 'ls' : 'rs'];
    const elbow = currentJoints[isLeft ? 'le' : 're'];
    const angle = Math.atan2(elbow[1] - shoulder[1], elbow[0] - shoulder[0]);
    const dx = v[0] - shoulder[0];
    const dy = v[1] - shoulder[1];
    const rotated = [
      shoulder[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
      shoulder[1] + dx * Math.sin(angle) + dy * Math.cos(angle)
    ];
    
    const outward = (1 - collar) * Math.exp(-((x - 358) ** 2 / 65 ** 2 + (y - 410) ** 2 / 90 ** 2)) * calculatePoseAmount(setupJoints, currentJoints, side);
    const ctrl = config?.controls?.[i] || [0, 0];
    const corr = config?.corrections?.[i] || [0, 0];
    const amount = calculatePoseAmount(setupJoints, currentJoints, side);
    
    return [
      rotated[0] + interior * (collar * (base[i][0] - rotated[0]) * amount * 0.98 + outward * (isLeft ? 12 : -12)) + (weight - w) * (rotated[0] - base[i][0]) + ctrl[0] * amount + corr[0],
      rotated[1] + interior * (collar * (base[i][1] - rotated[1]) * amount * 0.98 + outward * (isLeft ? -9 : -9)) + (weight - w) * (rotated[1] - base[i][1]) + ctrl[1] * amount + corr[1]
    ];
  });
  
  // Initialize positions at base
  const positions = base.map(v => [...v]);
  
  // Locked vertices: right edge (x=14) and bottom row (y=18)
  const locked = (i) => (i % SHOULDER_GRID_W === SHOULDER_GRID_W - 1) || (Math.floor(i / SHOULDER_GRID_W) === SHOULDER_GRID_H - 1);
  
  // Iterative solver
  const maxEdgeStretch = config?.maxEdge ?? 2.2;
  const minAreaRatio = config?.minArea ?? 0.22;
  
  for (let stage = 0; stage < 12; stage++) {
    // Spring toward target
    for (let i = 0; i < positions.length; i++) {
      if (locked(i)) continue;
      positions[i][0] += (target[i][0] - base[i][0]) / 12;
      positions[i][1] += (target[i][1] - base[i][1]) / 12;
    }
    
    // Constraint iterations
    const iterations = stage === 11 ? 100 : 12;
    for (let it = 0; it < iterations; it++) {
      // Edge length constraints
      for (const edge of edges) {
        const [a, b] = edge.split(':').map(Number);
        const A = positions[a];
        const B = positions[b];
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const d = Math.hypot(dx, dy) || 0.001;
        
        const wa = locked(a) ? 0 : 1;
        const wb = locked(b) ? 0 : 1;
        if (!wa && !wb) continue;
        
        const restLen = Math.hypot(sourceVertices[a][0] - sourceVertices[b][0], sourceVertices[a][1] - sourceVertices[b][1]);
        const minLen = restLen * 0.45;
        const maxLen = restLen * maxEdgeStretch;
        
        let c = (d - clamp(d, minLen, maxLen)) / d / (wa + wb) * 0.65;
        if (d < minLen) c = (d - minLen) / d / (wa + wb) * 0.65;
        else if (d > maxLen) c = (d - maxLen) / d / (wa + wb) * 0.65;
        else continue;
        
        A[0] += dx * c * wa;
        A[1] += dy * c * wa;
        B[0] -= dx * c * wb;
        B[1] -= dy * c * wb;
      }
      
      // Area constraints (prevent triangle inversion)
      for (const tri of triangles) {
        const [A, B, C] = tri.map(i => positions[i]);
        const area = triangleArea(A, B, C) * sign;
        if (area >= 256 * minAreaRatio) continue;
        
        const g = [
          [B[1] - C[1], C[0] - B[0]],
          [C[1] - A[1], A[0] - C[0]],
          [A[1] - B[1], B[0] - A[0]]
        ];
        
        let den = 0;
        for (let k = 0; k < 3; k++) {
          if (!locked(tri[k])) den += g[k][0] ** 2 + g[k][1] ** 2;
        }
        if (den < 1e-9) continue;
        
        const l = (256 * minAreaRatio - area) / den * 0.9 * sign;
        for (let k = 0; k < 3; k++) {
          if (!locked(tri[k])) {
            positions[tri[k]][0] += l * g[k][0];
            positions[tri[k]][1] += l * g[k][1];
          }
        }
      }
    }
  }
  
  return positions;
}

// Pose corrections (localized image swaps for armpits)
export const CORRECTION_FACES = (() => {
  const faces = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const a = y * 4 + x;
      faces.push([a, a + 1, a + 5]);
      faces.push([a, a + 5, a + 4]);
    }
  }
  return faces;
})();

export const CORRECTION_BASE = [
  [304, 352], [365, 352], [425, 402], [492, 420],
  [310, 435], [375, 435], [430, 445], [492, 455],
  [330, 510], [390, 510], [440, 510], [492, 510],
  [350, 590], [410, 590], [450, 590], [492, 590]
];

export const CORRECTION_UPPER = [
  [290, 310], [345, 240], [410, 237], [492, 250],
  [330, 350], [375, 300], [430, 300], [492, 285],
  [365, 380], [395, 350], [440, 330], [492, 330],
  [390, 410], [410, 410], [450, 410], [492, 410]
];

export function makeCorrectionConfig(enabled = false) {
  const side = (sd) => ({
    enabled,
    asset: `correction_${sd}`,
    bones: [sd + 's', sd + 'e', 'neck'],
    binding: sd + 's',
    pivot: [sd === 'l' ? 373 : 650, 436],
    position: [0, 0],
    scale: 1,
    start: 0.3,
    end: 0.85,
    intensity: 0.45,
    requirePin: true,
    easing: 'smoothstep',
    mask: CORRECTION_BASE.map(q => [sd === 'l' ? q[0] : WORK_WIDTH - q[0], q[1]]),
    uv: CORRECTION_UPPER.map(q => [sd === 'l' ? q[0] : WORK_WIDTH - q[0], q[1]]),
    offsets: CORRECTION_BASE.map(() => [0, 0])
  });
  return { version: 1, l: side('l'), r: side('r') };
}

export function calculateCorrectionActivation(setupJoints, currentJoints, side, config) {
  const c = config?.[side];
  if (!c?.enabled || (c.requirePin && !currentJoints.pins?.[side])) return 0;
  
  const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const setupShoulder = setupJoints[side === 'l' ? 'ls' : 'rs'];
  const setupElbow = setupJoints[side === 'l' ? 'le' : 're'];
  const currentShoulder = currentJoints[side === 'l' ? 'ls' : 'rs'];
  const currentElbow = currentJoints[side === 'l' ? 'le' : 're'];
  const currentWrist = currentJoints[side === 'l' ? 'lw' : 'rw'];
  const currentRoot = currentJoints.root;
  const setupRoot = setupJoints.root;
  
  let rot = angle(currentShoulder, currentElbow) - angle(setupShoulder, setupElbow);
  rot = Math.abs(Math.atan2(Math.sin(rot), Math.cos(rot)));
  
  const u = [currentShoulder[0] - currentElbow[0], currentShoulder[1] - currentElbow[1]];
  const v = [currentWrist[0] - currentElbow[0], currentWrist[1] - currentElbow[1]];
  const flex = Math.PI - Math.acos(Math.max(-1, Math.min(1, (u[0]*v[0] + u[1]*v[1]) / (Math.hypot(...u) * Math.hypot(...v)))));
  const rise = Math.max(0, (setupRoot[1] - currentRoot[1]) / 300);
  
  const amount = Math.min(1, 0.45 * rot / 1.8 + 0.35 * flex / 2.5 + 0.2 * rise);
  return smoothstep((amount - c.start) / (c.end - c.start)) * c.intensity;
}

// Barycentric coordinates for point in triangle
export function barycentric(p, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return [u, v, 1 - u - v];
}

// Find which correction face contains a point
export function findCorrectionFace(point, config, side) {
  const c = config?.[side];
  if (!c) return null;
  
  const mask = c.mask;
  for (const face of CORRECTION_FACES) {
    const w = barycentric(point, mask[face[0]], mask[face[1]], mask[face[2]]);
    if (w.every(n => n >= -1e-8)) return { face, w };
  }
  return null;
}

// Geometry offset from pose correction
export function correctionGeometryOffset(point, setupJoints, currentJoints, side, config) {
  const c = config?.[side];
  const amount = calculateCorrectionActivation(setupJoints, currentJoints, side, config);
  if (!amount || !c) return [0, 0];
  
  const hit = findCorrectionFace(point, config, side);
  if (!hit) return [0, 0];
  
  return [0, 1].map(k => amount * hit.face.reduce((sum, id, i) => sum + hit.w[i] * c.offsets[id][k], 0));
}

// Registered target for pose correction (reference-space cloth target)
export function correctionRegisteredTarget(point, oldPos, setupJoints, currentJoints, side, config) {
  const c = config?.[side];
  const amount = calculateCorrectionActivation(setupJoints, currentJoints, side, config);
  if (!amount || !c) return oldPos;
  
  const hit = findCorrectionFace(point, config, side);
  if (!hit) return oldPos;
  
  const sign = side === 'l' ? 1 : -1;
  const uv = [0, 1].map(k => hit.face.reduce((sum, id, i) => sum + hit.w[i] * c.uv[id][k], 0));
  
  const A = [side === 'l' ? 373 : 651, 285];
  const B = [side === 'l' ? 225 : 799, 410];
  const a = currentJoints[side + 's'];
  const b = currentJoints[side + 'e'];
  
  const theta = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(B[1] - A[1], B[0] - A[0]);
  const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.hypot(B[0] - A[0], B[1] - A[1]);
  
  const x = uv[0] - A[0];
  const y = uv[1] - A[1];
  const arm = [
    a[0] + scale * (x * Math.cos(theta) - y * Math.sin(theta)),
    a[1] + scale * (x * Math.sin(theta) + y * Math.cos(theta))
  ];
  
  const torso = [uv[0] + currentJoints.neck[0] - WORK_CENTER_X, uv[1] + currentJoints.neck[1] - 250];
  const w = c.binding === 'neck' ? 0 : 1 - smoothstep(((side === 'l' ? uv[0] : WORK_WIDTH - uv[0]) - 350) / 100);
  
  const target = arm.map((v, k) => v * w + torso[k] * (1 - w));
  
  const boundary = smoothstep((point[1] - 352) / 45) * (1 - smoothstep((point[1] - 520) / 70)) * (1 - smoothstep(((side === 'l' ? point[0] : WORK_WIDTH - point[0]) - 440) / 52));
  const influence = amount * boundary * 0.04;
  
  const geoOffset = correctionGeometryOffset(point, setupJoints, currentJoints, side, config);
  
  return oldPos.map((v, k) => v + (target[k] - v) * influence + geoOffset[k]);
}