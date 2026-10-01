function snapshotTransform(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  };
}

function restoreAll(object, snapshot) {
  object.position.copy(snapshot.position);
  object.quaternion.copy(snapshot.quaternion);
  object.scale.copy(snapshot.scale);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function preserveUnaffectedComponents(object, snapshot, mode) {
  if (mode === 'translate') {
    object.quaternion.copy(snapshot.quaternion);
    object.scale.copy(snapshot.scale);
  } else if (mode === 'rotate') {
    object.position.copy(snapshot.position);
    object.scale.copy(snapshot.scale);
  } else if (mode === 'scale') {
    object.position.copy(snapshot.position);
    object.quaternion.copy(snapshot.quaternion);
  }
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function almostEqual(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon;
}

function vectorEqual(a, b) {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z);
}

function quaternionEqual(a, b) {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z) && almostEqual(a.w, b.w);
}

export function installTransformIntegrity(editor) {
  if (!editor?.transform || editor.__gluestackTransformIntegrity) return editor?.__gluestackTransformIntegrity ?? null;

  let dragState = null;
  const originalSetTransformMode = editor.setTransformMode.bind(editor);

  function isObjectTransformTarget(object) {
    return Boolean(
      object
      && object === editor.selected
      && object !== editor.modelRoot
      && object.name !== '__gluestack_edit_pivot'
      && editor.selectedObjects?.has?.(object)
    );
  }

  function beginDrag() {
    const object = editor.transform.object;
    if (!isObjectTransformTarget(object)) {
      dragState = null;
      return;
    }
    dragState = {
      object,
      mode: editor.transform.mode,
      snapshot: snapshotTransform(object),
    };
  }

  function enforceDragIntegrity() {
    if (!dragState || dragState.object !== editor.transform.object) return;
    preserveUnaffectedComponents(dragState.object, dragState.snapshot, dragState.mode);
    editor.updateSelectionBoxes();
    editor.events.onTransform(dragState.object);
  }

  function finishDrag() {
    if (!dragState) return;
    enforceDragIntegrity();
    dragState = null;
  }

  editor.transform.addEventListener('mouseDown', beginDrag);
  editor.transform.addEventListener('objectChange', enforceDragIntegrity);
  editor.transform.addEventListener('mouseUp', finishDrag);

  editor.setTransformMode = (mode) => {
    const object = editor.transform.object;
    const snapshot = isObjectTransformTarget(object) ? snapshotTransform(object) : null;
    originalSetTransformMode(mode);
    if (snapshot && isObjectTransformTarget(object)) {
      restoreAll(object, snapshot);
      editor.updateSelectionBoxes();
    }
  };

  function runSelfTest() {
    const object = editor.selected;
    if (!isObjectTransformTarget(object)) {
      return { ok: false, detail: 'select an object first' };
    }

    const originalMode = editor.transform.mode;
    const actualBefore = snapshotTransform(object);
    originalSetTransformMode('rotate');
    const rotateNeutral = vectorEqual(object.position, actualBefore.position)
      && quaternionEqual(object.quaternion, actualBefore.quaternion)
      && vectorEqual(object.scale, actualBefore.scale);
    originalSetTransformMode(originalMode);

    const test = object.clone(false);
    test.position.set(1.25, -2.5, 3.75);
    test.rotation.set(0.31, -0.47, 0.22);
    test.scale.set(2.2, 0.7, 1.4);
    test.updateMatrix();
    const baseline = snapshotTransform(test);

    test.scale.set(1, 1, 1);
    preserveUnaffectedComponents(test, baseline, 'rotate');
    const rotateGuard = vectorEqual(test.scale, baseline.scale)
      && vectorEqual(test.position, baseline.position);

    restoreAll(test, baseline);
    test.quaternion.identity();
    preserveUnaffectedComponents(test, baseline, 'scale');
    const scaleGuard = quaternionEqual(test.quaternion, baseline.quaternion)
      && vectorEqual(test.position, baseline.position);

    restoreAll(test, baseline);
    test.quaternion.identity();
    test.scale.setScalar(0.5);
    preserveUnaffectedComponents(test, baseline, 'translate');
    const moveGuard = quaternionEqual(test.quaternion, baseline.quaternion)
      && vectorEqual(test.scale, baseline.scale);

    return {
      ok: rotateNeutral && rotateGuard && scaleGuard && moveGuard,
      detail: `mode-neutral ${rotateNeutral ? 'PASS' : 'FAIL'} · rotate preserves scale ${rotateGuard ? 'PASS' : 'FAIL'} · scale preserves rotation ${scaleGuard ? 'PASS' : 'FAIL'} · move preserves both ${moveGuard ? 'PASS' : 'FAIL'}`,
    };
  }

  function run() {
    const result = runSelfTest();
    return [{
      name: 'Transform mode integrity',
      ok: result.ok,
      level: result.ok ? 'pass' : 'fail',
      detail: result.detail,
    }];
  }

  const api = { runSelfTest, run };
  editor.__gluestackTransformIntegrity = api;
  return api;
}
