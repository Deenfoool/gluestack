import { collectReferencedResources } from './resource-ownership.js';
import { refreshIcons } from '../ui.js';

function bytesLabel(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function textureBytes(texture) {
  const image = texture?.image;
  const width = image?.width ?? image?.videoWidth ?? 0;
  const height = image?.height ?? image?.videoHeight ?? 0;
  return width * height * 4;
}

function canvasTextureStats(textures) {
  let count = 0;
  let bytes = 0;
  for (const texture of textures) {
    const image = texture?.image;
    if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
      count += 1;
      bytes += textureBytes(texture);
    }
  }
  return { count, bytes };
}

function sceneCounts(editor) {
  let objects = 0;
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  editor.modelRoot.traverse((object) => {
    if (object === editor.modelRoot) return;
    objects += 1;
    if (!object.isMesh) return;
    meshes += 1;
    const position = object.geometry?.getAttribute?.('position');
    if (!position) return;
    vertices += position.count;
    triangles += Math.floor((object.geometry.index?.count ?? position.count) / 3);
  });
  return { objects, meshes, vertices, triangles };
}

function benchmarkTraversal(editor, iterations = 25) {
  const samples = [];
  let visited = 0;
  for (let run = 0; run < iterations; run += 1) {
    let local = 0;
    const start = performance.now();
    editor.modelRoot.traverse(() => { local += 1; });
    samples.push(performance.now() - start);
    visited = local;
  }
  const avg = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return { visited, avg, p95: percentile(samples, 0.95), max: Math.max(0, ...samples) };
}

function sampleFrames(count = 90) {
  return new Promise((resolve) => {
    const samples = [];
    let previous = performance.now();
    const step = (now) => {
      samples.push(now - previous);
      previous = now;
      if (samples.length >= count) {
        const stable = samples.slice(5);
        const avg = stable.reduce((sum, value) => sum + value, 0) / Math.max(1, stable.length);
        resolve({
          frames: stable.length,
          avg,
          p95: percentile(stable, 0.95),
          max: Math.max(0, ...stable),
          fps: avg > 0 ? 1000 / avg : 0,
        });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function rendererSnapshot(editor) {
  const info = editor.renderer?.info;
  return {
    calls: info?.render?.calls ?? 0,
    triangles: info?.render?.triangles ?? 0,
    lines: info?.render?.lines ?? 0,
    points: info?.render?.points ?? 0,
    geometries: info?.memory?.geometries ?? 0,
    textures: info?.memory?.textures ?? 0,
    programs: info?.programs?.length ?? 0,
  };
}

function heapSnapshot() {
  const memory = performance.memory;
  if (!memory) return null;
  return {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    limit: memory.jsHeapSizeLimit,
  };
}

function startupTimings(editor) {
  return [...(editor.__gluestackFeatureTimings ?? [])].sort((a, b) => b.duration - a.duration);
}

export async function collectPerformanceReport(editor) {
  const resources = collectReferencedResources(editor.modelRoot);
  const canvas = canvasTextureStats(resources.textures);
  const counts = sceneCounts(editor);
  const traversal = benchmarkTraversal(editor);
  const rendererBefore = rendererSnapshot(editor);
  const heapBefore = heapSnapshot();
  const frames = await sampleFrames(90);
  const rendererAfter = rendererSnapshot(editor);
  const heapAfter = heapSnapshot();
  return {
    generatedAt: new Date().toISOString(),
    counts,
    resources: {
      geometries: resources.geometries.size,
      materials: resources.materials.size,
      textures: resources.textures.size,
      estimatedTextureBytes: [...resources.textures].reduce((sum, texture) => sum + textureBytes(texture), 0),
      canvasTextures: canvas.count,
      canvasTextureBytes: canvas.bytes,
    },
    renderer: { before: rendererBefore, after: rendererAfter },
    heap: { before: heapBefore, after: heapAfter },
    traversal,
    frames,
    startup: startupTimings(editor),
    device: {
      dpr: window.devicePixelRatio,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
    },
  };
}

function reportText(report) {
  const topFeatures = report.startup.slice(0, 8).map((item) => `${item.name} ${item.duration.toFixed(1)}ms`).join(' · ') || 'n/a';
  const heap = report.heap.after ? `${bytesLabel(report.heap.after.used)} / ${bytesLabel(report.heap.after.limit)}` : 'browser heap API unavailable';
  return [
    `Scene: ${report.counts.objects} objects · ${report.counts.meshes} meshes · ${report.counts.vertices.toLocaleString()} vertices · ${report.counts.triangles.toLocaleString()} triangles`,
    `Resources: ${report.resources.geometries} geometries · ${report.resources.materials} materials · ${report.resources.textures} textures · estimated ${bytesLabel(report.resources.estimatedTextureBytes)}`,
    `Canvas textures: ${report.resources.canvasTextures} · ${bytesLabel(report.resources.canvasTextureBytes)}`,
    `Renderer: ${report.renderer.after.calls} calls · ${report.renderer.after.triangles.toLocaleString()} triangles · GPU mem handles G${report.renderer.after.geometries}/T${report.renderer.after.textures}`,
    `Frames: ${report.frames.fps.toFixed(1)} FPS · avg ${report.frames.avg.toFixed(2)}ms · p95 ${report.frames.p95.toFixed(2)}ms · max ${report.frames.max.toFixed(2)}ms`,
    `Scene traversal: ${report.traversal.visited} nodes · avg ${report.traversal.avg.toFixed(3)}ms · p95 ${report.traversal.p95.toFixed(3)}ms`,
    `JS heap: ${heap}`,
    `Device: DPR ${report.device.dpr} · ${report.device.viewport} · CPU ${report.device.hardwareConcurrency ?? '?'} · RAM ${report.device.deviceMemoryGB ?? '?'}GB`,
    `Slowest feature installs: ${topFeatures}`,
  ].join('\n');
}

export function installPerformanceMonitor({ editor, diagnostics }) {
  if (!editor || !diagnostics || editor.performanceMonitor) return editor?.performanceMonitor ?? null;
  const menu = diagnostics.menu?.querySelector('.menu-popover');
  if (!menu) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<i data-lucide="gauge"></i><span>Performance Report</span>';
  menu.appendChild(button);

  async function run() {
    button.disabled = true;
    editor.events.onStatus('Performance Report: sampling 90 frames…');
    try {
      const report = await collectPerformanceReport(editor);
      const overlay = diagnostics.overlay;
      const container = overlay?.querySelector('[data-diagnostics-results]');
      const summary = overlay?.querySelector('[data-diagnostics-summary]');
      if (overlay && container && summary) {
        overlay.hidden = false;
        summary.textContent = `Performance · ${report.frames.fps.toFixed(1)} FPS · p95 ${report.frames.p95.toFixed(1)}ms`;
        container.replaceChildren();
        for (const line of reportText(report).split('\n')) {
          const row = document.createElement('div');
          row.className = 'diagnostics-row pass';
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'INFO';
          const name = document.createElement('strong');
          name.textContent = line.split(':')[0];
          const detail = document.createElement('span');
          detail.className = 'detail';
          detail.textContent = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : line;
          row.append(badge, name, detail);
          container.appendChild(row);
        }
      }
      console.groupCollapsed('[gluestack] Performance Report');
      console.log(report);
      console.table(report.startup);
      console.groupEnd();
      editor.events.onStatus(`Performance · ${report.frames.fps.toFixed(1)} FPS · p95 ${report.frames.p95.toFixed(1)}ms`);
      return report;
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    diagnostics.menu?.removeAttribute('open');
    run().catch((error) => {
      console.error('[gluestack] performance report failed', error);
      editor.events.onStatus(`Performance Report: ${error.message || error}`);
    });
  });

  const api = { button, run, collect: () => collectPerformanceReport(editor) };
  editor.performanceMonitor = api;
  refreshIcons();
  return api;
}
