const EPS = 1e-8;

function boundsForIsland(island, uv) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const corner of island.corners) {
    const x = uv.getX(corner);
    const y = uv.getY(corner);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    island,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(EPS, maxX - minX),
    height: Math.max(EPS, maxY - minY),
  };
}

function orientationOptions(rect, scale, padding, allowRotate) {
  const result = [{
    rotated: false,
    contentWidth: rect.width * scale,
    contentHeight: rect.height * scale,
  }];
  if (allowRotate && Math.abs(rect.width - rect.height) > EPS) {
    result.push({
      rotated: true,
      contentWidth: rect.height * scale,
      contentHeight: rect.width * scale,
    });
  }
  return result.map((item) => ({
    ...item,
    width: item.contentWidth + padding * 2,
    height: item.contentHeight + padding * 2,
  }));
}

function tryPack(rects, scale, padding, allowRotate) {
  const sorted = [...rects].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));
  const placements = new Map();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let usedWidth = 0;
  let usedHeight = 0;

  for (const rect of sorted) {
    const options = orientationOptions(rect, scale, padding, allowRotate);
    const candidates = [];
    for (const option of options) {
      if (option.width <= 1 + EPS && option.height <= 1 + EPS) {
        if (x + option.width <= 1 + EPS && y + option.height <= 1 + EPS) {
          candidates.push({ option, newRow: false, x, y, score: Math.max(usedHeight, y + Math.max(rowHeight, option.height)) });
        }
        const nextY = y + rowHeight;
        if (rowHeight > 0 && option.width <= 1 + EPS && nextY + option.height <= 1 + EPS) {
          candidates.push({ option, newRow: true, x: 0, y: nextY, score: Math.max(usedHeight, nextY + option.height) });
        }
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score || a.option.height - b.option.height || a.option.width - b.option.width);
    const chosen = candidates[0];
    if (chosen.newRow) {
      x = 0;
      y = chosen.y;
      rowHeight = 0;
    }

    placements.set(rect.island.id, {
      ...chosen.option,
      x: chosen.x + padding,
      y: chosen.y + padding,
      rect,
    });
    x = chosen.x + chosen.option.width;
    rowHeight = Math.max(rowHeight, chosen.option.height);
    usedWidth = Math.max(usedWidth, x);
    usedHeight = Math.max(usedHeight, y + rowHeight);
  }

  return { placements, usedWidth, usedHeight, scale };
}

export function packUVIslands(islands, uv, {
  paddingPx = 8,
  textureResolution = 1024,
  allowRotate = true,
} = {}) {
  const selected = islands.filter((island) => island?.corners?.size);
  if (!selected.length) return null;
  const padding = Math.max(0, Number(paddingPx) || 0) / Math.max(1, Number(textureResolution) || 1024);
  if (padding * 2 >= 1) throw new Error('UV padding слишком большой для выбранного texture resolution');

  const rects = selected.map((island) => boundsForIsland(island, uv));
  let low = 0;
  let high = 1;
  let best = tryPack(rects, high, padding, allowRotate);
  let guard = 0;
  while (best && high < 4096 && guard < 16) {
    low = high;
    high *= 2;
    const next = tryPack(rects, high, padding, allowRotate);
    if (!next) break;
    best = next;
    guard += 1;
  }
  if (!best) {
    high = Math.max(high, 1);
    low = 0;
  }

  for (let iteration = 0; iteration < 28; iteration += 1) {
    const mid = (low + high) * 0.5;
    const packed = tryPack(rects, mid, padding, allowRotate);
    if (packed) {
      best = packed;
      low = mid;
    } else high = mid;
  }
  if (!best) throw new Error('Не удалось упаковать UV islands');

  for (const rect of rects) {
    const placement = best.placements.get(rect.island.id);
    if (!placement) continue;
    for (const corner of rect.island.corners) {
      const localX = uv.getX(corner) - rect.minX;
      const localY = uv.getY(corner) - rect.minY;
      if (placement.rotated) {
        uv.setXY(
          corner,
          placement.x + localY * best.scale,
          placement.y + (rect.width - localX) * best.scale,
        );
      } else {
        uv.setXY(
          corner,
          placement.x + localX * best.scale,
          placement.y + localY * best.scale,
        );
      }
    }
  }
  uv.needsUpdate = true;
  return {
    scale: best.scale,
    paddingUv: padding,
    usedWidth: best.usedWidth,
    usedHeight: best.usedHeight,
    rotated: [...best.placements.values()].filter((item) => item.rotated).length,
    count: rects.length,
  };
}
