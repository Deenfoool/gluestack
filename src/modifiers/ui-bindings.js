import * as THREE from 'three';
import { applyDecimate, applyTriangulate } from './advanced.js';
import { applyBevelModifier } from './bevel.js';

function inputNumber(root, selector, fallback = 0) {
  const value = Number(root.querySelector(selector)?.value);
  return Number.isFinite(value) ? value : fallback;
}

async function stackAdd(modifiers, type, params, fallback) {
  let stack = modifiers.stack;
  if (!stack && modifiers.stackReady) {
    try { stack = await modifiers.stackReady; } catch {}
  }
  if (stack?.add) return stack.add(type, params);
  return fallback();
}

let booleanModulePromise = null;

async function runBoolean(modifiers, operation) {
  if (modifiers.stackReady && !modifiers.stack) {
    try { await modifiers.stackReady; } catch {}
  }
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
  modifiers.stackReady ??= import('./stack.js')
    .then(({ installModifierStack }) => installModifierStack({ editor: modifiers.editor, modifiers }))
    .catch((error) => {
      console.error('[gluestack] Modifier Stack failed to load', error);
      modifiers.onStatus(`Modifier Stack недоступен: ${error.message || error}`);
      return null;
    });
  modifiers.editor.modifierStackReady = modifiers.stackReady;

  root.querySelectorAll('[data-modifier-mirror]').forEach((button) => {
    button.addEventListener('click', async () => stackAdd(
      modifiers,
      'mirror',
      { axis: button.dataset.modifierMirror },
      () => modifiers.applyMirror(button.dataset.modifierMirror),
    ));
  });

  root.querySelector('[data-modifier-array]')?.addEventListener('click', async () => {
    const count = inputNumber(root, '#modifier-array-count', 2);
    const x = inputNumber(root, '#modifier-array-x', 2);
    const y = inputNumber(root, '#modifier-array-y', 0);
    const z = inputNumber(root, '#modifier-array-z', 0);
    await stackAdd(
      modifiers,
      'array',
      { count, x, y, z },
      () => modifiers.applyArray(count, new THREE.Vector3(x, y, z)),
    );
  });

  root.querySelector('[data-modifier-solidify]')?.addEventListener('click', async () => {
    const thickness = inputNumber(root, '#modifier-solidify-thickness', 0.1);
    await stackAdd(modifiers, 'solidify', { thickness }, () => modifiers.applySolidify(thickness));
  });

  root.querySelector('[data-modifier-subdivision]')?.addEventListener('click', async () => {
    const levels = inputNumber(root, '#modifier-subdivision-levels', 1);
    await stackAdd(modifiers, 'subdivision', { levels }, () => modifiers.applySubdivision(levels));
  });

  root.querySelector('[data-modifier-bevel]')?.addEventListener('click', async () => {
    const factor = inputNumber(root, '#modifier-bevel-factor', 0.08);
    await stackAdd(modifiers, 'bevel', { factor }, () => applyBevelModifier(modifiers, factor));
  });

  root.querySelector('[data-modifier-decimate]')?.addEventListener('click', async () => {
    const ratio = inputNumber(root, '#modifier-decimate-ratio', 0.5);
    await stackAdd(modifiers, 'decimate', { ratio }, () => applyDecimate(modifiers, ratio));
  });

  root.querySelector('[data-modifier-triangulate]')?.addEventListener('click', async () => {
    await stackAdd(modifiers, 'triangulate', {}, () => applyTriangulate(modifiers));
  });

  root.querySelectorAll('[data-modifier-boolean]').forEach((button) => {
    button.addEventListener('click', () => runBoolean(modifiers, button.dataset.modifierBoolean));
  });
}
