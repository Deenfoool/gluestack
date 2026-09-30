import * as THREE from 'three';
import { applyDecimate, applyTriangulate } from './advanced.js';
import { applyBevelModifier } from './bevel.js';

function inputNumber(root, selector, fallback = 0) {
  const value = Number(root.querySelector(selector)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function stackAdd(modifiers, type, params, fallback) {
  if (modifiers.stack?.add) return modifiers.stack.add(type, params);
  return fallback();
}

let booleanModulePromise = null;

async function runBoolean(modifiers, operation) {
  const selected = modifiers.editor.getTopLevelSelection?.() ?? [];
  if (modifiers.stack?.hasStack && selected.some((mesh) => modifiers.stack.hasStack(mesh))) {
    modifiers.onStatus('Boolean: сначала Apply Stack или Clear Stack на выбранных Mesh');
    return false;
  }
  try {
    booleanModulePromise ??= import('./boolean.js');
    const { applyBoolean } = await booleanModulePromise;
    return applyBoolean(modifiers, operation);
  } catch (error) {
    booleanModulePromise = null;
    console.error('[gluestack] Boolean module failed to load', error);
    modifiers.onStatus(`Boolean недоступен: ${error.message || error}`);
    return false;
  }
}

export function bindModifierControls(modifiers, root = document) {
  root.querySelectorAll('[data-modifier-mirror]').forEach((button) => {
    button.addEventListener('click', () => stackAdd(
      modifiers,
      'mirror',
      { axis: button.dataset.modifierMirror },
      () => modifiers.applyMirror(button.dataset.modifierMirror),
    ));
  });

  root.querySelector('[data-modifier-array]')?.addEventListener('click', () => {
    const count = inputNumber(root, '#modifier-array-count', 2);
    const x = inputNumber(root, '#modifier-array-x', 2);
    const y = inputNumber(root, '#modifier-array-y', 0);
    const z = inputNumber(root, '#modifier-array-z', 0);
    stackAdd(
      modifiers,
      'array',
      { count, x, y, z },
      () => modifiers.applyArray(count, new THREE.Vector3(x, y, z)),
    );
  });

  root.querySelector('[data-modifier-solidify]')?.addEventListener('click', () => {
    const thickness = inputNumber(root, '#modifier-solidify-thickness', 0.1);
    stackAdd(modifiers, 'solidify', { thickness }, () => modifiers.applySolidify(thickness));
  });

  root.querySelector('[data-modifier-subdivision]')?.addEventListener('click', () => {
    const levels = inputNumber(root, '#modifier-subdivision-levels', 1);
    stackAdd(modifiers, 'subdivision', { levels }, () => modifiers.applySubdivision(levels));
  });

  root.querySelector('[data-modifier-bevel]')?.addEventListener('click', () => {
    const factor = inputNumber(root, '#modifier-bevel-factor', 0.08);
    stackAdd(modifiers, 'bevel', { factor }, () => applyBevelModifier(modifiers, factor));
  });

  root.querySelector('[data-modifier-decimate]')?.addEventListener('click', async () => {
    const ratio = inputNumber(root, '#modifier-decimate-ratio', 0.5);
    if (modifiers.stack?.add) modifiers.stack.add('decimate', { ratio });
    else await applyDecimate(modifiers, ratio);
  });

  root.querySelector('[data-modifier-triangulate]')?.addEventListener('click', () => {
    stackAdd(modifiers, 'triangulate', {}, () => applyTriangulate(modifiers));
  });

  root.querySelectorAll('[data-modifier-boolean]').forEach((button) => {
    button.addEventListener('click', () => runBoolean(modifiers, button.dataset.modifierBoolean));
  });
}
