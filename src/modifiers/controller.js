import * as THREE from 'three';
import { interpolateTuple } from '../edit/attributes.js';
import {
  buildTopology,
  cloneTriangle,
  edgeKey,
  makeTriangle,
  readMeshTopology,
  rebuildMeshGeometry,
  triangleNormal,
} from '../edit/topology.js';

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ position: vertex.position.clone(), sources: [] }));
}

function reorderTriangleCorners(triangle, order, mappedVertices) {
  const attrs = {};
  for (const [name, corners] of Object.entries(triangle.attrs ?? {})) {
    attrs[name] = order.map((corner) => [...corners[corner]]);
  }
  return makeTriangle(
    order.map((corner) => mappedVertices[triangle.v[corner]]),
    triangle.materialIndex ?? 0,
    order.map((corner) => [triangle.uv[corner].x, triangle.uv[corner].y]),
    attrs,
  );
}

function midpointCornerData(triangle, aCorner, bCorner) {
  const uv = triangle.uv[aCorner].clone().lerp(triangle.uv[bCorner], 0.5);
  const attrs = {};
  for (const [name, corners] of Object.entries(triangle.attrs ?? {})) {
    attrs[name] = interpolateTuple(corners[aCorner], corners[bCorner], 0.5);
  }
  return { uv, attrs };
}

export class ModifierController {
  constructor(editor, onStatus = null) {
    this.editor = editor;
    this.onStatus = onStatus ?? ((message) => editor.events.onStatus(message));
  }

  getMesh() {
    const mesh = this.editor.selected;
    if (!mesh?.isMesh || mesh.isSkinnedMesh || !mesh.geometry?.getAttribute('position')) {
      this.onStatus('Modifier: выберите обычный Mesh');
      return null;
    }
    return mesh;
  }

  commit(mesh, vertices, triangles, attributeState, label) {
    rebuildMeshGeometry(mesh, vertices, triangles, attributeState);
    this.editor.refreshSelectionVisuals();
    this.editor.events.onTransform(mesh);
    this.editor.events.onStructure();
    this.onStatus(label);
    return true;
  }

  applyMirror(axis = 'x') {
    const mesh = this.getMesh();
    if (!mesh || !['x', 'y', 'z'].includes(axis)) return false;
    const topology = readMeshTopology(mesh);
    this.editor.checkpoint(`Mirror ${axis.toUpperCase()}`);
    const vertices = cloneVertices(topology.vertices);
    const mirrorMap = new Map();
    topology.vertices.forEach((vertex, id) => {
      const nextId = vertices.length;
      const position = vertex.position.clone();
      position[axis] *= -1;
      vertices.push({ position, sources: [] });
      mirrorMap.set(id, nextId);
    });
    const triangles = topology.triangles.map(cloneTriangle);
    for (const triangle of topology.triangles) {
      const mapped = Object.fromEntries(triangle.v.map((id) => [id, mirrorMap.get(id)]));
      triangles.push(reorderTriangleCorners(triangle, [0, 2, 1], mapped));
    }
    return this.commit(mesh, vertices, triangles, topology.attributeState, `Mirror ${axis.toUpperCase()} применён`);
  }

  applyArray(count = 2, offset = new THREE.Vector3(2, 0, 0)) {
    const mesh = this.getMesh();
    count = Math.max(2, Math.min(100, Math.floor(count)));
    if (!mesh || !Number.isFinite(count) || !Number.isFinite(offset.x + offset.y + offset.z)) return false;
    const topology = readMeshTopology(mesh);
    this.editor.checkpoint('Array');
    const vertices = [];
    const triangles = [];
    for (let copy = 0; copy < count; copy += 1) {
      const base = vertices.length;
      const delta = offset.clone().multiplyScalar(copy);
      topology.vertices.forEach((vertex) => {
        vertices.push({ position: vertex.position.clone().add(delta), sources: [] });
      });
      for (const triangle of topology.triangles) {
        const next = cloneTriangle(triangle);
        next.v = next.v.map((id) => base + id);
        triangles.push(next);
      }
    }
    return this.commit(mesh, vertices, triangles, topology.attributeState, `Array ×${count} применён`);
  }

  applySolidify(thickness = 0.1) {
    const mesh = this.getMesh();
    if (!mesh || !Number.isFinite(thickness) || Math.abs(thickness) < 1e-6) return false;
    const topology = readMeshTopology(mesh);
    this.editor.checkpoint('Solidify');

    const vertexNormals = topology.vertices.map(() => new THREE.Vector3());
    for (const triangle of topology.triangles) {
      const normal = triangleNormal(triangle, topology.vertices);
      triangle.v.forEach((id) => vertexNormals[id].add(normal));
    }
    vertexNormals.forEach((normal) => {
      if (normal.lengthSq() < 1e-10) normal.set(0, 1, 0);
      else normal.normalize();
    });

    const vertices = cloneVertices(topology.vertices);
    const backMap = new Map();
    topology.vertices.forEach((vertex, id) => {
      backMap.set(id, vertices.length);
      vertices.push({
        position: vertex.position.clone().addScaledVector(vertexNormals[id], -thickness),
        sources: [],
      });
    });

    const triangles = topology.triangles.map(cloneTriangle);
    for (const triangle of topology.triangles) {
      const mapped = Object.fromEntries(triangle.v.map((id) => [id, backMap.get(id)]));
      triangles.push(reorderTriangleCorners(triangle, [0, 2, 1], mapped));
    }

    for (const edge of topology.edges.filter((item) => item.triangles.length === 1)) {
      const a = edge.a;
      const b = edge.b;
      const ba = backMap.get(a);
      const bb = backMap.get(b);
      const source = topology.triangles[edge.triangles[0]];
      const aCorner = source.v.indexOf(a);
      const bCorner = source.v.indexOf(b);
      const attrsA = {};
      const attrsB = {};
      for (const [name, corners] of Object.entries(source.attrs ?? {})) {
        attrsA[name] = corners[aCorner] ? [...corners[aCorner]] : [];
        attrsB[name] = corners[bCorner] ? [...corners[bCorner]] : [];
      }
      const attrs1 = {};
      const attrs2 = {};
      for (const name of new Set([...Object.keys(attrsA), ...Object.keys(attrsB)])) {
        attrs1[name] = [[...(attrsA[name] ?? [])], [...(attrsB[name] ?? [])], [...(attrsB[name] ?? [])]];
        attrs2[name] = [[...(attrsA[name] ?? [])], [...(attrsB[name] ?? [])], [...(attrsA[name] ?? [])]];
      }
      triangles.push(makeTriangle([a, b, bb], source.materialIndex ?? 0, [[0, 0], [1, 0], [1, 1]], attrs1));
      triangles.push(makeTriangle([a, bb, ba], source.materialIndex ?? 0, [[0, 0], [1, 1], [0, 1]], attrs2));
    }

    return this.commit(mesh, vertices, triangles, topology.attributeState, `Solidify ${thickness}`);
  }

  applySubdivision(levels = 1) {
    const mesh = this.getMesh();
    levels = Math.max(1, Math.min(3, Math.floor(levels)));
    if (!mesh || !Number.isFinite(levels)) return false;
    this.editor.checkpoint('Subdivision');
    let topology = readMeshTopology(mesh);
    let vertices = cloneVertices(topology.vertices);
    let triangles = topology.triangles.map(cloneTriangle);
    const attributeState = topology.attributeState;

    for (let level = 0; level < levels; level += 1) {
      const built = buildTopology(vertices, triangles);
      const neighbors = vertices.map(() => new Set());
      const boundaryNeighbors = vertices.map(() => new Set());
      for (const edge of built.edges) {
        neighbors[edge.a].add(edge.b);
        neighbors[edge.b].add(edge.a);
        if (edge.triangles.length === 1) {
          boundaryNeighbors[edge.a].add(edge.b);
          boundaryNeighbors[edge.b].add(edge.a);
        }
      }

      const smoothed = vertices.map((vertex, id) => {
        const boundary = [...boundaryNeighbors[id]];
        if (boundary.length >= 2) {
          return vertex.position.clone().multiplyScalar(0.75)
            .add(vertices[boundary[0]].position.clone().multiplyScalar(0.125))
            .add(vertices[boundary[1]].position.clone().multiplyScalar(0.125));
        }
        const around = [...neighbors[id]];
        const n = around.length;
        if (n < 3) return vertex.position.clone();
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        const next = vertex.position.clone().multiplyScalar(1 - n * beta);
        around.forEach((neighbor) => next.add(vertices[neighbor].position.clone().multiplyScalar(beta)));
        return next;
      });

      const edgePointIds = new Map();
      const nextVertices = smoothed.map((position) => ({ position, sources: [] }));
      for (const edge of built.edges) {
        let position;
        if (edge.triangles.length === 2) {
          const opposite = edge.triangles.map((triangleId) => (
            triangles[triangleId].v.find((id) => id !== edge.a && id !== edge.b)
          ));
          position = vertices[edge.a].position.clone().multiplyScalar(3 / 8)
            .add(vertices[edge.b].position.clone().multiplyScalar(3 / 8))
            .add(vertices[opposite[0]].position.clone().multiplyScalar(1 / 8))
            .add(vertices[opposite[1]].position.clone().multiplyScalar(1 / 8));
        } else {
          position = vertices[edge.a].position.clone().lerp(vertices[edge.b].position, 0.5);
        }
        edgePointIds.set(edge.key, nextVertices.length);
        nextVertices.push({ position, sources: [] });
      }

      const nextTriangles = [];
      for (const triangle of triangles) {
        const [a, b, c] = triangle.v;
        const ab = edgePointIds.get(edgeKey(a, b));
        const bc = edgePointIds.get(edgeKey(b, c));
        const ca = edgePointIds.get(edgeKey(c, a));
        const uvA = triangle.uv[0];
        const uvB = triangle.uv[1];
        const uvC = triangle.uv[2];
        const abData = midpointCornerData(triangle, 0, 1);
        const bcData = midpointCornerData(triangle, 1, 2);
        const caData = midpointCornerData(triangle, 2, 0);
        const cornerAttrs = (corner) => Object.fromEntries(Object.entries(triangle.attrs ?? {}).map(([name, values]) => [name, [...values[corner]]]));
        const makeAttrs = (items) => {
          const result = {};
          const names = new Set(items.flatMap((item) => Object.keys(item)));
          for (const name of names) result[name] = items.map((item) => [...(item[name] ?? [])]);
          return result;
        };
        const aAttrs = cornerAttrs(0);
        const bAttrs = cornerAttrs(1);
        const cAttrs = cornerAttrs(2);
        nextTriangles.push(makeTriangle([a, ab, ca], triangle.materialIndex, [[uvA.x, uvA.y], [abData.uv.x, abData.uv.y], [caData.uv.x, caData.uv.y]], makeAttrs([aAttrs, abData.attrs, caData.attrs])));
        nextTriangles.push(makeTriangle([ab, b, bc], triangle.materialIndex, [[abData.uv.x, abData.uv.y], [uvB.x, uvB.y], [bcData.uv.x, bcData.uv.y]], makeAttrs([abData.attrs, bAttrs, bcData.attrs])));
        nextTriangles.push(makeTriangle([ca, bc, c], triangle.materialIndex, [[caData.uv.x, caData.uv.y], [bcData.uv.x, bcData.uv.y], [uvC.x, uvC.y]], makeAttrs([caData.attrs, bcData.attrs, cAttrs])));
        nextTriangles.push(makeTriangle([ab, bc, ca], triangle.materialIndex, [[abData.uv.x, abData.uv.y], [bcData.uv.x, bcData.uv.y], [caData.uv.x, caData.uv.y]], makeAttrs([abData.attrs, bcData.attrs, caData.attrs])));
      }
      vertices = nextVertices;
      triangles = nextTriangles;
    }

    return this.commit(mesh, vertices, triangles, attributeState, `Subdivision ×${levels} применён`);
  }
}
