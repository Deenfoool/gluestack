import * as THREE from 'three';
import { applyDecimate, applyTriangulate } from './advanced.js';
import { applyBevelModifier } from './bevel.js';

function inputNumber(root, selector, fallback = 0) {
  const value = Number(root.querySelector(selector)?.value);
  return Number.isFinite(value) ? value : fallback;
}

let booleanModulePromise = null;

async function runBoolean(modifiers, operation) {
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
    button.addEventListener('click', () => modifiers.applyMirror(button.dataset.modifierMirror));
  });

  root.querySelector('[data-modifier-array]')?.addEventListener('click', () => {
    modifiers.applyArray(
      inputNumber(root, '#modifier-array-count', 2),
      new THREE.Vector3(
        inputNumber(root, '#modifier-array-x', 2),
        inputNumber(root, '#modifier-array-y', 0),
        inputNumber(root, '#modifier-array-z', 0),
      ),
    );
  });

  root.querySelector('[data-modifier-solidify]')?.addEventListener('click', () => {
    modifiers.applySolidify(inputNumber(root, '#modifier-solidify-thickness', 0.1));
  });

  root.querySelector('[data-modifier-subdivision]')?.addEventListener('click', () => {
    modifiers.applySubdivision(inputNumber(root, '#modifier-subdivision-levels', 1));
  });

  root.querySelector('[data-modifier-bevel]')?.addEventListener('click', () => {
    applyBevelModifier(modifiers, inputNumber(root, '#modifier-bevel-factor', 0.08));
  });

  root.querySelector('[data-modifier-decimate]')?.addEventListener('click', async () => {
    await applyDecimate(modifiers, inputNumber(root, '#modifier-decimate-ratio', 0.5));
  });

  root.querySelector('[data-modifier-triangulate]')?.addEventListener('click', () => {
    applyTriangulate(modifiers);
  });

  root.querySelectorAll('[data-modifier-boolean]').forEach((button) => {
    button.addEventListener('click', () => runBoolean(modifiers, button.dataset.modifierBoolean));
  });
}
