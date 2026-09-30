import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { refreshIcons } from '../ui.js';

function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lowPolyMaterial(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
}

function randomizeGeometry(geometry, seed, amount = 0.18) {
  let indexed = geometry.index ? geometry : mergeVertices(geometry, 1e-5);
  const position = indexed.getAttribute('position');
  const random = rng(seed);
  for (let i = 0; i < position.count; i += 1) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    const factor = 1 + (random() * 2 - 1) * amount;
    p.multiplyScalar(factor);
    p.x *= 1 + (random() * 2 - 1) * amount * 0.35;
    p.z *= 1 + (random() * 2 - 1) * amount * 0.35;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  position.needsUpdate = true;
  indexed.computeVertexNormals();
  const result = indexed.toNonIndexed();
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  if (indexed !== geometry) indexed.dispose();
  geometry.dispose();
  return result;
}

export function installProceduralGenerators({ editor }) {
  const addMenu = document.querySelector('#add-menu .menu-popover');
  if (!addMenu) return null;

  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  const items = [
    ['rock', 'gem', 'Procedural › Low Poly Rock'],
    ['island', 'mountain', 'Procedural › Island'],
    ['tree', 'trees', 'Procedural › Tree'],
    ['crate', 'package', 'Procedural › Crate'],
  ];
  const buttons = [];
  for (const [type, icon, label] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.procedural = type;
    button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    addMenu.appendChild(button);
    buttons.push(button);
  }
  addMenu.insertBefore(separator, buttons[0]);

  function finish(object, label) {
    editor.assignIds(object, true);
    editor.modelRoot.add(object);
    editor.select(object);
    editor.events.onStructure();
    editor.events.onStatus(`${label} создан`);
    document.querySelector('#add-menu')?.removeAttribute('open');
    return object;
  }

  function rock() {
    editor.checkpoint('Add procedural rock');
    const seed = Math.floor(Math.random() * 0xffffffff);
    const geometry = randomizeGeometry(new THREE.IcosahedronGeometry(1, 1), seed, 0.22);
    geometry.scale(1.2, 0.82, 1.05);
    const mesh = new THREE.Mesh(geometry, lowPolyMaterial(0x68645f, 0.95));
    mesh.name = editor.uniqueName('LowPolyRock');
    mesh.userData.gluestackGenerator = { type: 'rock', seed };
    return finish(mesh, 'Low Poly Rock');
  }

  function island() {
    editor.checkpoint('Add procedural island');
    const seed = Math.floor(Math.random() * 0xffffffff);
    const random = rng(seed);
    const group = new THREE.Group();
    group.name = editor.uniqueName('LowPolyIsland');
    group.userData.gluestackGenerator = { type: 'island', seed };

    let cliff = new THREE.CylinderGeometry(1.65, 1.25, 0.75, 10, 1, false);
    const position = cliff.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i);
      const scale = 1 + (random() * 2 - 1) * (y > 0 ? 0.08 : 0.18);
      position.setX(i, position.getX(i) * scale);
      position.setZ(i, position.getZ(i) * scale);
    }
    position.needsUpdate = true;
    cliff = cliff.toNonIndexed();
    cliff.computeVertexNormals();
    const cliffMesh = new THREE.Mesh(cliff, lowPolyMaterial(0x75604a, 0.92));
    cliffMesh.position.y = -0.35;
    cliffMesh.name = 'Cliff';

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.62, 1.62, 0.08, 10, 1, false).toNonIndexed(),
      lowPolyMaterial(0x6f8d4c, 0.95),
    );
    top.geometry.computeVertexNormals();
    top.position.y = 0.065;
    top.name = 'GrassTop';
    group.add(cliffMesh, top);
    return finish(group, 'Low Poly Island');
  }

  function tree() {
    editor.checkpoint('Add procedural tree');
    const group = new THREE.Group();
    group.name = editor.uniqueName('LowPolyTree');
    group.userData.gluestackGenerator = { type: 'tree' };
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 7).toNonIndexed(), lowPolyMaterial(0x6c4a2f));
    trunk.geometry.computeVertexNormals();
    trunk.position.y = 0.8;
    trunk.name = 'Trunk';
    const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.45, 8).toNonIndexed(), lowPolyMaterial(0x3f7b42));
    crown1.geometry.computeVertexNormals();
    crown1.position.y = 1.75;
    crown1.name = 'CrownLower';
    const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.15, 8).toNonIndexed(), lowPolyMaterial(0x4c8b4e));
    crown2.geometry.computeVertexNormals();
    crown2.position.y = 2.35;
    crown2.name = 'CrownUpper';
    group.add(trunk, crown1, crown2);
    return finish(group, 'Low Poly Tree');
  }

  function crate() {
    editor.checkpoint('Add procedural crate');
    const group = new THREE.Group();
    group.name = editor.uniqueName('LowPolyCrate');
    group.userData.gluestackGenerator = { type: 'crate' };
    const wood = lowPolyMaterial(0x9a6a3b, 0.82);
    const dark = lowPolyMaterial(0x604126, 0.9);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), wood);
    body.name = 'Body';
    group.add(body);
    const beams = [
      [1.72, 0.13, 0.13, 0, 0.68, 0.86], [1.72, 0.13, 0.13, 0, -0.68, 0.86],
      [0.13, 1.72, 0.13, 0.68, 0, 0.86], [-0.13, 1.72, 0.13, -0.68, 0, 0.86],
    ];
    beams.forEach(([sx, sy, sz, x, y, z], i) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(sx), Math.abs(sy), Math.abs(sz)), dark);
      beam.position.set(x, y, z);
      beam.name = `Beam${i + 1}`;
      group.add(beam);
    });
    return finish(group, 'Low Poly Crate');
  }

  const generators = { rock, island, tree, crate };
  buttons.forEach((button) => button.addEventListener('click', () => generators[button.dataset.procedural]?.()));
  refreshIcons();
  return generators;
}
