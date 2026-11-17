// SPDX-License-Identifier: MIT OR Apache-2.0
// Import adapter for Rigby Auto-Rig 2D v0.4 (.rigby2d format) into Rigby2D main project.
// Converts the Work Auto-Rig format to Rigby2D skeleton format.

import { unzip } from '../editor/zip.js';
import { Skeleton, makeBone, makeSlot, makeAttachment, defaultSettings, INHERIT_MODES } from './model.js';
import { Affine, identityTransform, toAffine } from './math.js';
import { Pose } from './pose.js';
import { generateMesh } from './meshgen.js';

// Work Auto-Rig coordinate system: 1024x1536 pixels, origin top-left, Y down
// Rigby2D coordinate system: Y up, world units (pixels at scale 1)
const WORK_CANVAS_WIDTH = 1024;
const WORK_CANVAS_HEIGHT = 1536;
const PIXELS_PER_UNIT = 1; // 1 world unit = 1 pixel at default scale

// Joint name mapping from Work format to Rigby2D bone names
const JOINT_TO_BONE = {
  'root': 'root',
  'neck': 'neck',
  'head': 'head',
  'ls': 'shoulder_l',
  'le': 'elbow_l',
  'lw': 'wrist_l',
  'rs': 'shoulder_r',
  're': 'elbow_r',
  'rw': 'wrist_r',
  'lh': 'hip_l',
  'lk': 'knee_l',
  'la': 'ankle_l',
  'rh': 'hip_r',
  'rk': 'knee_r',
  'ra': 'ankle_r',
};

// Part ID to bone mapping
const PART_TO_BONES = {
  'torso': ['spine', 'neck'],
  'head': ['head'],
  'lu': ['upperarm_l'],
  'lf': ['forearm_l'],
  'lhand': ['hand_l'],
  'ru': ['upperarm_r'],
  'rf': ['forearm_r'],
  'rhand': ['hand_r'],
  'lt': ['thigh_l'],
  'll': ['shin_l'],
  'lfoot': ['foot_l'],
  'rt': ['thigh_r'],
  'rl': ['shin_r'],
  'rfoot': ['foot_r'],
};

export async function loadWorkAutorig(buffer) {
  // Unzip the .rigby2d file
  const entries = unzip(new Uint8Array(buffer));
  
  // Read manifest
  const manifestData = entries.get('manifest.json');
  if (!manifestData) throw new Error('Missing manifest.json in .rigby2d file');
  const manifest = JSON.parse(new TextDecoder().decode(manifestData));
  
  if (manifest.format !== 'Rigby Auto-Rig v1') {
    throw new Error(`Unsupported format: ${manifest.format}`);
  }
  
  // Read project.json
  const projectData = entries.get('project.json');
  if (!projectData) throw new Error('Missing project.json in .rigby2d file');
  const project = JSON.parse(new TextDecoder().decode(projectData));
  
  // Validate project format
  if (project.format !== 'rigby-autorig-open' || project.version !== 1) {
    throw new Error(`Invalid project format: ${project.format} v${project.version}`);
  }
  
  // Load all images
  const images = new Map();
  for (const [name, path] of Object.entries(project.assets)) {
    const imgData = entries.get(path);
    if (!imgData) throw new Error(`Missing image: ${path}`);
    images.set(name, imgData);
  }
  
  // Load part PNGs (masks)
  const partImages = new Map();
  for (const part of project.parts) {
    const imgData = entries.get(`parts/${part.id}.png`);
    if (imgData) {
      partImages.set(part.id, imgData);
    }
  }
  
  return { project, images, partImages, manifest };
}

function flipY(point, height = WORK_CANVAS_HEIGHT) {
  return [point[0], height - point[1]];
}

function workToRigbyPoint(point) {
  // Convert from Work pixel coords (top-left origin, Y down) to Rigby2D (Y up)
  const flipped = flipY(point);
  // Center the character at origin
  return [flipped[0] - WORK_CANVAS_WIDTH / 2, flipped[1] - WORK_CANVAS_HEIGHT / 2];
}

function createRigbySkeleton(project) {
  const sk = new Skeleton();
  sk.name = 'treinador_auto_rig';
  sk.format = 'rigby-snapshot/1';
  sk.settings = defaultSettings();
  sk.settings.fps = 30;
  sk.settings.width = 1920;
  sk.settings.height = 1080;
  
  // Build bone hierarchy from joints
  const jointPositions = {};
  for (const [name, pos] of Object.entries(project.joints)) {
    jointPositions[name] = workToRigbyPoint(pos);
  }
  
  // Create bones in hierarchical order
  const boneDefs = [
    { name: 'root', parent: null, joint: 'root', length: 0 },
    { name: 'spine', parent: 'root', joint: 'neck', length: 0 },
    { name: 'neck', parent: 'spine', joint: 'head', length: 0 },
    { name: 'head', parent: 'neck', joint: 'head', length: 0 },
    { name: 'shoulder_l', parent: 'spine', joint: 'ls', length: 0 },
    { name: 'elbow_l', parent: 'shoulder_l', joint: 'le', length: 0 },
    { name: 'wrist_l', parent: 'elbow_l', joint: 'lw', length: 0 },
    { name: 'hand_l', parent: 'wrist_l', joint: 'lw', length: 0 },
    { name: 'shoulder_r', parent: 'spine', joint: 'rs', length: 0 },
    { name: 'elbow_r', parent: 'shoulder_r', joint: 're', length: 0 },
    { name: 'wrist_r', parent: 'elbow_r', joint: 'rw', length: 0 },
    { name: 'hand_r', parent: 'wrist_r', joint: 'rw', length: 0 },
    { name: 'hip_l', parent: 'root', joint: 'lh', length: 0 },
    { name: 'knee_l', parent: 'hip_l', joint: 'lk', length: 0 },
    { name: 'ankle_l', parent: 'knee_l', joint: 'la', length: 0 },
    { name: 'foot_l', parent: 'ankle_l', joint: 'la', length: 0 },
    { name: 'hip_r', parent: 'root', joint: 'rh', length: 0 },
    { name: 'knee_r', parent: 'hip_r', joint: 'rk', length: 0 },
    { name: 'ankle_r', parent: 'knee_r', joint: 'ra', length: 0 },
    { name: 'foot_r', parent: 'ankle_r', joint: 'ra', length: 0 },
  ];
  
  const boneIndex = new Map();
  sk.bones = [];
  
  for (const def of boneDefs) {
    const parentIndex = def.parent ? boneIndex.get(def.parent) : null;
    const jointPos = jointPositions[def.joint];
    const parentPos = def.parent ? jointPositions[JOINT_TO_BONE[def.parent]] || [0, 0] : [0, 0];
    
    // Setup transform relative to parent
    const setup = identityTransform();
    if (jointPos) {
      setup.x = jointPos[0] - parentPos[0];
      setup.y = jointPos[1] - parentPos[1];
    }
    
    // Calculate bone length (distance to child joint)
    let length = 0;
    // Find child joints to determine length
    for (const [jName, jPos] of Object.entries(jointPositions)) {
      if (JOINTS_TO_BONES[jName] === def.name) {
        const childPos = jPos;
        const dx = childPos[0] - jointPos[0];
        const dy = childPos[1] - jointPos[1];
        length = Math.hypot(dx, dy);
        break;
      }
    }
    
    const bone = makeBone(def.name, parentIndex, setup, length);
    boneIndex.set(def.name, sk.bones.length);
    sk.bones.push(bone);
  }
  
  return { sk, jointPositions, boneIndex };
}

// Map from joint names to bone names that own them
const JOINTS_TO_BONES = {
  'root': 'root',
  'neck': 'spine',
  'head': 'neck',
  'ls': 'shoulder_l',
  'le': 'elbow_l',
  'lw': 'wrist_l',
  'rs': 'shoulder_r',
  're': 'elbow_r',
  'rw': 'wrist_r',
  'lh': 'hip_l',
  'lk': 'knee_l',
  'la': 'ankle_l',
  'rh': 'hip_r',
  'rk': 'knee_r',
  'ra': 'ankle_r',
};

export function convertWorkAutorigToRigby(project, images, partImages) {
  const { sk, jointPositions, boneIndex } = createRigbySkeleton(project);
  
  // Create slots and attachments from parts
  const partById = new Map(project.parts.map(p => [p.id, p]));
  
  for (const part of project.parts) {
    if (!part.visible) continue;
    
    const partImg = partImages.get(part.id);
    if (!partImg) {
      console.warn(`No image for part ${part.id}`);
      continue;
    }
    
    // Determine which bone this part attaches to
    let boneName = 'root';
    if (part.id === 'torso') boneName = 'spine';
    else if (part.id === 'head') boneName = 'head';
    else if (part.id === 'lu') boneName = 'upperarm_l';
    else if (part.id === 'lf') boneName = 'forearm_l';
    else if (part.id === 'lhand') boneName = 'hand_l';
    else if (part.id === 'ru') boneName = 'upperarm_r';
    else if (part.id === 'rf') boneName = 'forearm_r';
    else if (part.id === 'rhand') boneName = 'hand_r';
    else if (part.id === 'lt') boneName = 'thigh_l';
    else if (part.id === 'll') boneName = 'shin_l';
    else if (part.id === 'lfoot') boneName = 'foot_l';
    else if (part.id === 'rt') boneName = 'thigh_r';
    else if (part.id === 'rl') boneName = 'shin_r';
    else if (part.id === 'rfoot') boneName = 'foot_r';
    
    const boneIdx = boneIndex.get(boneName);
    if (boneIdx === undefined) {
      console.warn(`Bone ${boneName} not found for part ${part.id}`);
      continue;
    }
    
    // Create attachment from part polygon
    // The polygon is in Work coordinates (1024x1536, Y down)
    // Convert to attachment offset (center of polygon in bone space)
    const poly = part.poly;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    
    const centerWork = [(minX + maxX) / 2, (minY + maxY) / 2];
    const centerRigby = workToRigbyPoint(centerWork);
    const bonePos = jointPositions[JOINTS_TO_BONES[boneName]] || [0, 0];
    
    const offset = {
      x: centerRigby[0] - bonePos[0],
      y: centerRigby[1] - bonePos[1],
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    const attachment = makeAttachment(part.id, part.id, offset, width, height);
    
    // Create slot
    const slot = makeSlot(part.id, boneIdx, attachment);
    slot.blend = 'normal';
    slot.color = [1, 1, 1, 1];
    
    sk.slots.push(slot);
    sk.images.push({ name: part.id, path: `images/${part.id}.png`, width: width, height: height });
  }
  
  // Add IK constraints
  sk.ik = [
    {
      name: 'IK_Arm_L',
      order: 0,
      bones: [boneIndex.get('upperarm_l'), boneIndex.get('forearm_l'), boneIndex.get('hand_l')].filter(b => b !== undefined),
      target: boneIndex.get('wrist_l'),
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: false,
      uniform: false,
    },
    {
      name: 'IK_Arm_R',
      order: 1,
      bones: [boneIndex.get('upperarm_r'), boneIndex.get('forearm_r'), boneIndex.get('hand_r')].filter(b => b !== undefined),
      target: boneIndex.get('wrist_r'),
      mix: 1,
      softness: 0,
      bendPositive: false,
      compress: false,
      stretch: false,
      uniform: false,
    },
    {
      name: 'IK_Leg_L',
      order: 2,
      bones: [boneIndex.get('thigh_l'), boneIndex.get('shin_l'), boneIndex.get('foot_l')].filter(b => b !== undefined),
      target: boneIndex.get('ankle_l'),
      mix: 1,
      softness: 0,
      bendPositive: true,
      compress: false,
      stretch: false,
      uniform: false,
    },
    {
      name: 'IK_Leg_R',
      order: 3,
      bones: [boneIndex.get('thigh_r'), boneIndex.get('shin_r'), boneIndex.get('foot_r')].filter(b => b !== undefined),
      target: boneIndex.get('ankle_r'),
      mix: 1,
      softness: 0,
      bendPositive: false,
      compress: false,
      stretch: false,
      uniform: false,
    },
  ].filter(ik => ik.bones.length === 3);
  
  // Convert animations from keys
  if (project.keys && project.keys.length > 0) {
    const anim = {
      name: 'barra_fixa',
      duration: 5,
      timelines: [],
    };
    
    // For now, create a basic animation from the keyframes
    // The Work format uses elevation (rise) keyframes, we need to convert to bone rotations
    sk.animations.push(anim);
  }
  
  return sk;
}

// Main export function
export async function importWorkAutorigRigby2D(buffer) {
  const { project, images, partImages, manifest } = await loadWorkAutorig(buffer);
  const skeleton = convertWorkAutorigToRigby(project, images, partImages);
  return { skeleton, project, images, partImages, manifest };
}