// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tool to import Rigby Auto-Rig 2D v0.4 (.rigby2d) projects into Rigby2D main format.

import fs from 'node:fs/promises';
import path from 'node:path';
import { unzip, zip } from '../../editor/zip.js';
import { Skeleton, makeBone, makeSlot, makeAttachment, defaultSettings, INHERIT_MODES } from '../../core/model.js';
import { Affine, identityTransform, toAffine } from '../../core/math.js';
import { Pose } from '../../core/pose.js';
import { generateMesh } from '../../core/meshgen.js';
import { ToolError } from '../protocol.js';
import { generateShoulderVertices, generateShoulderTriangles } from '../../core/work-autorig-deform.js';

const WORK_CANVAS_WIDTH = 1024;
const WORK_CANVAS_HEIGHT = 1536;
const WORK_CENTER_X = WORK_CANVAS_WIDTH / 2;
const WORK_CENTER_Y = WORK_CANVAS_HEIGHT / 2;

// Work joint names in order for bone hierarchy
const WORK_JOINTS = [
  'root', 'neck', 'head',
  'ls', 'le', 'lw',
  'rs', 're', 'rw',
  'lh', 'lk', 'la',
  'rh', 'rk', 'ra'
];

// Bone hierarchy matching Work joint structure
const BONE_HIERARCHY = [
  { name: 'root', parent: null, joint: 'root' },
  { name: 'spine', parent: 'root', joint: 'neck' },
  { name: 'neck', parent: 'spine', joint: 'head' },
  { name: 'head', parent: 'neck', joint: 'head' },
  { name: 'shoulder_l', parent: 'spine', joint: 'ls' },
  { name: 'elbow_l', parent: 'shoulder_l', joint: 'le' },
  { name: 'wrist_l', parent: 'elbow_l', joint: 'lw' },
  { name: 'hand_l', parent: 'wrist_l', joint: 'lw' },
  { name: 'shoulder_r', parent: 'spine', joint: 'rs' },
  { name: 'elbow_r', parent: 'shoulder_r', joint: 're' },
  { name: 'wrist_r', parent: 'elbow_r', joint: 'rw' },
  { name: 'hand_r', parent: 'wrist_r', joint: 'rw' },
  { name: 'hip_l', parent: 'root', joint: 'lh' },
  { name: 'knee_l', parent: 'hip_l', joint: 'lk' },
  { name: 'ankle_l', parent: 'knee_l', joint: 'la' },
  { name: 'foot_l', parent: 'ankle_l', joint: 'la' },
  { name: 'hip_r', parent: 'root', joint: 'rh' },
  { name: 'knee_r', parent: 'hip_r', joint: 'rk' },
  { name: 'ankle_r', parent: 'knee_r', joint: 'ra' },
  { name: 'foot_r', parent: 'ankle_r', joint: 'ra' },
  // IK target bones for hand pinning (root-level, fixed in world space)
  { name: 'hand_target_l', parent: null, joint: 'lw', fixed: true, fixedWorldPosition: [-213, 693] },
  { name: 'hand_target_r', parent: null, joint: 'rw', fixed: true, fixedWorldPosition: [212, 693] },
];

// Part to bone mapping (which bone the part attaches to)
const PART_TO_BONE = {
  'torso': 'spine',
  'head': 'head',
  'lu': 'shoulder_l',
  'lf': 'elbow_l',
  'lhand': 'wrist_l',
  'ru': 'shoulder_r',
  'rf': 'elbow_r',
  'rhand': 'wrist_r',
  'lt': 'hip_l',
  'll': 'knee_l',
  'lfoot': 'ankle_l',
  'rt': 'hip_r',
  'rl': 'knee_r',
  'rfoot': 'ankle_r',
};

// Draw order from Work part z-index (lower z = drawn first = behind)
const PART_DRAW_ORDER = [
  'lt', 'rt',  // z=2
  'll', 'rl',  // z=3
  'lfoot', 'rfoot',  // z=4
  'torso',  // z=5
  'lu', 'ru',  // z=6
  'lf', 'rf',  // z=7
  'head',  // z=12
  'lhand', 'rhand',  // z=13
];

function workToRigbyPoint(pt) {
  // Work: 1024x1536, origin top-left, Y down
  // Rigby2D: origin center, Y up
  return [pt[0] - WORK_CENTER_X, WORK_CENTER_Y - pt[1]];
}

function polygonBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

async function loadWorkAutorig(buffer) {
  const entries = unzip(new Uint8Array(buffer));
  
  const manifestData = entries.get('manifest.json');
  if (!manifestData) throw new ToolError('Missing manifest.json in .rigby2d file');
  const manifest = JSON.parse(new TextDecoder().decode(manifestData));
  
  if (manifest.format !== 'Rigby Auto-Rig v1') {
    throw new ToolError(`Unsupported format: ${manifest.format}`);
  }
  
  const projectData = entries.get('project.json');
  if (!projectData) throw new ToolError('Missing project.json in .rigby2d file');
  const project = JSON.parse(new TextDecoder().decode(projectData));
  
  if (project.format !== 'rigby-autorig-open' || project.version !== 1) {
    throw new ToolError(`Invalid project format: ${project.format} v${project.version}`);
  }
  
  const images = new Map();
  for (const [name, relPath] of Object.entries(project.assets)) {
    const imgData = entries.get(relPath);
    if (!imgData) throw new ToolError(`Missing image: ${relPath}`);
    images.set(name, imgData);
  }
  
  const partImages = new Map();
  for (const part of project.parts) {
    const imgData = entries.get(`parts/${part.id}.png`);
    if (imgData) partImages.set(part.id, imgData);
  }
  
  return { project, images, partImages, manifest, entries };
}

function createRigbySkeleton(project) {
  const sk = new Skeleton();
  sk.name = project.metadata?.app || project.name || 'treinador_auto_rig';
  sk.format = 'rigby-snapshot/1';
  sk.settings = defaultSettings();
  sk.settings.fps = 30;
  sk.settings.width = 1920;
  sk.settings.height = 1080;
  
  // Convert all joint positions
  const jointPositions = {};
  for (const [name, pos] of Object.entries(project.joints)) {
    jointPositions[name] = workToRigbyPoint(pos);
  }
  
  const boneIndex = new Map();
  sk.bones = [];
  
  // Create bones in hierarchy order
  for (const def of BONE_HIERARCHY) {
    const parentIndex = def.parent ? boneIndex.get(def.parent) : null;
    const jointPos = jointPositions[def.joint] || [0, 0];
    const parentPos = def.parent ? jointPositions[BONE_HIERARCHY.find(b => b.name === def.parent)?.joint] || [0, 0] : [0, 0];
    
    const setup = identityTransform();
    
    // For fixed bones (IK targets), use absolute world position
    if (def.fixed) {
      setup.x = jointPos[0];
      setup.y = jointPos[1];
    } else {
      setup.x = jointPos[0] - parentPos[0];
      setup.y = jointPos[1] - parentPos[1];
    }
    
    // Calculate bone length to next joint in chain
    let length = 0;
    for (const child of BONE_HIERARCHY) {
      if (child.parent === def.name && jointPositions[child.joint]) {
        const childPos = jointPositions[child.joint];
        const dx = childPos[0] - jointPos[0];
        const dy = childPos[1] - jointPos[1];
        length = Math.hypot(dx, dy);
        break;
      }
    }
    
    const bone = makeBone(def.name, parentIndex, setup, length);
    // Mark fixed bones in extra data for runtime handling
    if (def.fixed) {
      bone.extra = { ...bone.extra, fixed: true, fixedWorldPosition: def.fixedWorldPosition };
    }
    boneIndex.set(def.name, sk.bones.length);
    sk.bones.push(bone);
  }
  
  return { sk, jointPositions, boneIndex };
}

function createSlotsAndAttachments(sk, project, jointPositions, boneIndex, partImages) {
  const partById = new Map(project.parts.map(p => [p.id, p]));
  
  // Create slots in draw order
  for (const partId of PART_DRAW_ORDER) {
    const part = partById.get(partId);
    if (!part || !part.visible) continue;
    
    const partImg = partImages.get(partId);
    if (!partImg) {
      console.warn(`No image for part ${partId}`);
      continue;
    }
    
    const boneName = PART_TO_BONE[partId];
    if (!boneName) {
      console.warn(`No bone mapping for part ${partId}`);
      continue;
    }
    
    const boneIdx = boneIndex.get(boneName);
    if (boneIdx === undefined) {
      console.warn(`Bone ${boneName} not found for part ${partId}`);
      continue;
    }
    
    // Get polygon bounds in Work coordinates
    const bounds = polygonBounds(part.poly);
    const centerWork = [bounds.cx, bounds.cy];
    const centerRigby = workToRigbyPoint(centerWork);
    
    // Bone ORIGIN position in Rigby2D (parent joint, not child joint!)
    const boneDef = BONE_HIERARCHY.find(b => b.name === boneName);
    const parentJoint = boneDef?.parent ? BONE_HIERARCHY.find(b => b.name === boneDef.parent)?.joint : null;
    const boneOriginPos = parentJoint ? jointPositions[parentJoint] : [0, 0];
    
    // Attachment offset: center of piece relative to bone origin (parent joint)
    const offset = {
      x: centerRigby[0] - boneOriginPos[0],
      y: centerRigby[1] - boneOriginPos[1],
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
    
    const attachment = makeAttachment(part.id, part.id, offset, bounds.width, bounds.height);
    attachment.type = 'region';
    
    const slot = makeSlot(part.id, boneIdx, attachment);
    slot.blend = 'normal';
    slot.color = [1, 1, 1, 1];
    
    sk.slots.push(slot);
    sk.images.push({ name: part.id, path: `images/${part.id}.png`, width: Math.round(bounds.width), height: Math.round(bounds.height) });
  }
}

function createIKConstraints(sk, boneIndex, project) {
  const ikData = project.ik || {};
  const constraints = [];
  
  // Arm IK - target the hand target bones (fixed positions on the bar)
  for (const side of ['l', 'r']) {
    const upper = side === 'l' ? 'shoulder_l' : 'shoulder_r';
    const fore = side === 'l' ? 'elbow_l' : 'elbow_r';
    const hand = side === 'l' ? 'wrist_l' : 'wrist_r';
    const targetBone = side === 'l' ? 'hand_target_l' : 'hand_target_r';
    
    const bones = [boneIndex.get(upper), boneIndex.get(fore), boneIndex.get(hand)].filter(b => b !== undefined);
    const targetIdx = boneIndex.get(targetBone);
    
    if (bones.length === 3 && targetIdx !== undefined) {
      // Work uses direction: -1 for left, 1 for right. maxFlex=150 to limit folding.
      // In Rigby2D IK solver: desired = theta - bend * A, where bend = bendPositive ? 1 : -1.
      // For OUTWARD elbow flare (pull-up):
      // - Left arm reaching LEFT: elbow should be LEFT of shoulder-target line = CW bend = bendPositive=false
      // - Right arm reaching RIGHT: elbow should be RIGHT of shoulder-target line = CCW bend = bendPositive=true
      const cfg = ikData[side] || { direction: side === 'l' ? -1 : 1, minFlex: 0, maxFlex: 150, minShoulder: -170, maxShoulder: 170 };
      constraints.push({
        name: `IK_Arm_${side === 'l' ? 'Left' : 'Right'}`,
        order: constraints.length,
        bones,
        target: targetIdx,
        mix: 1,
        softness: 0,
        bendPositive: side !== 'l', // Left: false (CW/outward), Right: true (CCW/outward)
        compress: true,
        stretch: true,
        uniform: false,
      });
    }
  }
  
  // Leg IK (optional - Work only pins hands)
  // Not adding leg IK since Work only fixes hands
  
  sk.ik = constraints;
}

function createScene(sk, project, jointPositions, boneIndex) {
  // Create scene with bar actor
  const obj = project.object; // {x, y, scale, id}
  const targets = project.targets; // {l: [x,y], r: [x,y]} in Work coords
  const pins = project.pins; // {l: true, r: true}
  
  if (!obj) return;
  
  // Convert bar position to Rigby2D
  const barPos = workToRigbyPoint([obj.x, obj.y]);
  
  // Convert hand targets to Rigby2D
  const handTargets = {};
  for (const side of ['l', 'r']) {
    handTargets[side] = workToRigbyPoint(targets[side]);
  }
  
  // Add scene data to skeleton.extra
  sk.scene = {
    actors: [{
      name: obj.id || 'barra',
      source: 'treinador_imported_barra', // Reference the bar rigby file
      bone: boneIndex.get('root'),
      x: barPos[0],
      y: barPos[1],
      scale: obj.scale || 1,
      flip: false,
      skin: '',
      clips: {
        'barra_fixa': [{ animation: 'idle' }] // Map main animation to bar's idle
      }
    }],
    depth: {
      [obj.id || 'barra']: -1000 // Behind character
    }
  };
  
  // Store IK target positions for runtime
  sk.extra.ikTargets = {
    left: handTargets.l,
    right: handTargets.r,
    pins: pins
  };
  
  // Store bar info for actor loading
  sk.extra.barObject = {
    id: obj.id || 'barra',
    image: 'object',
    position: barPos,
    scale: obj.scale || 1
  };
}

function createAnimations(sk, project) {
  if (!project.keys || project.keys.length < 2) return;
  
  // Find root bone index
  const rootIdx = sk.bones.findIndex(b => b.name === 'root');
  if (rootIdx === -1) return;
  
  // Convert Work elevation keyframes to root bone translate Y keyframes (DELTA from setup)
  // Work rise 0 = Rigby2D setup y = -22
  // Work rise 330 = Rigby2D setup y + 330 = 308
  // But the full 330 rise is physically impossible for the arm lengths (IK folding).
  // Work system limits the actual rise based on IK error (peak error <= 0.01).
  // Max rise without severe arm folding: target distance >= upper arm length (180).
  // At rise R: shoulder_y = 332+R, target_y=693, dx=74.
  // sqrt(74² + (361-R)²) >= 180 -> R <= 196.
  // Empirically, R=190 gives acceptable results with minor folding at peak.
  const maxFeasibleRise = 190;
  const keyframes = project.keys.map(k => ({
    time: k.t,
    value: Math.min(k.v, 190), // Cap rise at feasible maximum
  }));
  
  const anim = {
    name: 'barra_fixa',
    duration: 5,
    bones: [{
      bone: 0, // root
      translate: keyframes.map(k => ({ time: k.time, value: [0, k.value] })),
      rotate: [],
      scale: [],
      shear: [],
      translateX: [],
      translateY: keyframes.map(k => ({ time: k.time, value: k.value })),
      scaleX: [],
      scaleY: [],
      shearX: [],
      shearY: [],
      inherit: [],
    }],
    slots: [],
    deform: [],
    drawOrder: [],
    events: [],
    ik: [],
    extra: {}
  };
  
  sk.animations.push(anim);
}

function storeWorkDeformationData(sk, project) {
  const shoulderVertices = generateShoulderVertices();
  const { triangles: shoulderTriangles, edges: shoulderEdges } = generateShoulderTriangles();
  
  const CORRECTION_BASE = [
    [304, 352], [365, 352], [425, 402], [492, 420],
    [310, 435], [375, 435], [430, 445], [492, 455],
    [330, 510], [390, 510], [440, 510], [492, 510],
    [350, 590], [410, 590], [450, 590], [492, 590]
  ];
  
  const CORRECTION_UPPER = [
    [290, 310], [345, 240], [410, 237], [492, 250],
    [330, 350], [375, 300], [430, 300], [492, 285],
    [365, 380], [395, 350], [440, 330], [492, 330],
    [390, 410], [410, 410], [450, 410], [492, 410]
  ];
  
  const correctionConfig = {
    version: 1,
    l: {
      enabled: true,
      asset: 'correction_l',
      bones: ['shoulder_l', 'elbow_l', 'neck'],
      binding: 'shoulder_l',
      pivot: [373, 436],
      position: [0, 0],
      scale: 1,
      start: 0.3,
      end: 0.85,
      intensity: 0.45,
      requirePin: true,
      easing: 'smoothstep',
      mask: CORRECTION_BASE,
      uv: CORRECTION_UPPER,
      offsets: CORRECTION_BASE.map(() => [0, 0])
    },
    r: {
      enabled: true,
      asset: 'correction_r',
      bones: ['shoulder_r', 'elbow_r', 'neck'],
      binding: 'shoulder_r',
      pivot: [650, 436],
      position: [0, 0],
      scale: 1,
      start: 0.3,
      end: 0.85,
      intensity: 0.45,
      requirePin: true,
      easing: 'smoothstep',
      mask: CORRECTION_BASE.map(([x, y]) => [WORK_CANVAS_WIDTH - x, y]),
      uv: CORRECTION_UPPER.map(([x, y]) => [WORK_CANVAS_WIDTH - x, y]),
      offsets: CORRECTION_BASE.map(() => [0, 0])
    }
  };
  
  // Store setup joints in Work coordinates for runtime conversion
  const setupJoints = {};
  for (const [name, pos] of Object.entries(project.joints)) {
    setupJoints[name] = [...pos];
  }
  
  sk.extra.workAutorig = {
    version: 1,
    shoulders: {
      version: 1,
      enabled: true,
      minArea: 0.22,
      maxEdge: 2.2,
      mesh: {
        vertices: shoulderVertices,
        triangles: shoulderTriangles
      },
      l: { weights: {}, controls: {}, poses: [{at: 0, offsets: {}}, {at: 0.25, offsets: {}}, {at: 0.5, offsets: {}}, {at: 1, offsets: {}}] },
      r: { weights: {}, controls: {}, poses: [{at: 0, offsets: {}}, {at: 0.25, offsets: {}}, {at: 0.5, offsets: {}}, {at: 1, offsets: {}}] }
    },
    corrections: correctionConfig,
    setupJoints: setupJoints,
    pins: project.pins,
    targets: project.targets,
    object: project.object
  };
}

async function saveAsRigby(sk, images, partImages, outputPath, correctionAssets = new Map()) {
  const projectJson = sk.toObject();
  
  const files = [
    { path: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(projectJson, null, 2)) },
  ];
  
  for (const [name, data] of partImages) {
    files.push({ path: `images/${name}.png`, bytes: data });
  }
  
  for (const [name, data] of correctionAssets) {
    files.push({ path: `images/${name}.png`, bytes: data });
  }
  
  // Use fixed bar image (with transparency) if available
  const fixedBarPath = path.join(path.dirname(outputPath), 'barra_fixed.png');
  let fixedBarData = null;
  try {
    fixedBarData = await fs.readFile(fixedBarPath);
  } catch {
    // Fall back to original object image
    if (images.has('object')) {
      fixedBarData = images.get('object');
    }
  }
  
  if (fixedBarData) {
    files.push({ path: 'images/barra.png', bytes: fixedBarData });
  }
  
  const zipData = zip(files);
  await fs.writeFile(outputPath, Buffer.from(zipData));
}

async function createBarRigby(images, outputPath) {
  // Create a minimal .rigby for the bar (static image)
  const { Skeleton, makeBone, makeSlot, makeAttachment, defaultSettings } = await import('../../core/model.js');
  const { Animation } = await import('../../core/animation.js');
  
  const sk = new Skeleton();
  sk.name = 'barra';
  sk.format = 'rigby-snapshot/1';
  sk.settings = defaultSettings();
  sk.settings.fps = 30;
  sk.settings.width = 1920;
  sk.settings.height = 1080;
  
  // Single root bone
  const rootBone = makeBone('root', null, { x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 }, 0);
  sk.bones = [rootBone];
  
  // Bar slot on root
  const barImg = images.get('object');
  if (barImg) {
    // Assume bar image is full canvas 1024x1536
    const attachment = makeAttachment('barra', 'barra', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, 1024, 1536);
    attachment.type = 'region';
    
    const slot = makeSlot('barra', 0, attachment);
    slot.blend = 'normal';
    slot.color = [1, 1, 1, 1];
    
    sk.slots.push(slot);
    sk.images.push({ name: 'barra', path: 'images/barra.png', width: 1024, height: 1536 });
  }
  
  // Add a dummy animation so actor loading doesn't fail
  const dummyAnim = new Animation('idle', 1);
  sk.animations.push(dummyAnim);
  
  const projectJson = sk.toObject();
  
  const files = [
    { path: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(projectJson, null, 2)) },
  ];
  
  if (images.has('object')) {
    files.push({ path: 'images/barra.png', bytes: images.get('object') });
  }
  
  const zipData = zip(files);
  await fs.writeFile(outputPath, Buffer.from(zipData));
}

export async function importWorkAutorig(inputPath, outputPath) {
  const buffer = await fs.readFile(inputPath);
  const { project, images, partImages, manifest, entries } = await loadWorkAutorig(buffer);
  
  const { sk, jointPositions, boneIndex } = createRigbySkeleton(project);
  createSlotsAndAttachments(sk, project, jointPositions, boneIndex, partImages);
  createIKConstraints(sk, boneIndex, project);
  createScene(sk, project, jointPositions, boneIndex);
  createAnimations(sk, project);
  await storeWorkDeformationData(sk, project);
  
  const correctionAssets = new Map();
  for (const [name, data] of images) {
    if (name.startsWith('correction_')) {
      correctionAssets.set(name, data);
    }
  }
  
  await saveAsRigby(sk, images, partImages, outputPath, correctionAssets);
  
  // Also create bar.rigby for the static bar object
  const barOutputPath = outputPath.replace(/\.rigby$/, '_barra.rigby');
  await createBarRigby(images, barOutputPath);
  
  return { skeleton: sk, project, warnings: [] };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: node work-autorig-import.js <input.rigby2d> <output.rigby>');
    process.exit(1);
  }
  try {
    await importWorkAutorig(input, output);
    console.log(`Successfully imported ${input} -> ${output}`);
  } catch (e) {
    console.error('Import failed:', e.message);
    process.exit(1);
  }
}