import * as THREE from 'three';

const ORANGE = new THREE.Color(0xff9500);
const VERTEX_IDLE = new THREE.Color(0xb8b8b8);
const EDGE_IDLE = new THREE.Color(0x707070);

function isLogicalEdge(edge, triangleToFaceGroup) {
  if (!edge?.triangles?.length) return false;
  if (edge.triangles.length !== 2) return true;
  const [a, b] = edge.triangles;
  return triangleToFaceGroup?.[a] !== triangleToFaceGroup?.[b];
}

export class EditOverlay {
  constructor(editor) {
    this.editor = editor;
    this.group = null;
    this.points = null;
    this.lines = null;
    this.edgeKeys = [];
  }

  mount(mesh) {
    this.dispose();
    mesh.updateWorldMatrix(true, false);
    this.group = new THREE.Group();
    this.group.name = '__gluestack_edit_overlay';
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(mesh.matrixWorld);
    this.editor.scene.add(this.group);
  }

  dispose() {
    if (!this.group) return;
    this.editor.scene.remove(this.group);
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.group = null;
    this.points = null;
    this.lines = null;
    this.edgeKeys = [];
  }

  refresh({ vertices, edges, triangles, triangleToFaceGroup, selectionMode, selectedVertices, selectedEdges, selectedTriangles }) {
    if (!this.group) return;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const pointPositions = [];
    const pointColors = [];
    vertices.forEach((vertex, index) => {
      pointPositions.push(vertex.position.x, vertex.position.y, vertex.position.z);
      const color = selectedVertices.has(index) ? ORANGE : VERTEX_IDLE;
      pointColors.push(color.r, color.g, color.b);
    });
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3));
    this.points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({
      size: selectionMode === 'vertex' ? 9 : 5,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
    }));
    this.points.renderOrder = 102;
    this.group.add(this.points);

    const edgePositions = [];
    const edgeColors = [];
    this.edgeKeys = [];
    edges.forEach((edge) => {
      if (!isLogicalEdge(edge, triangleToFaceGroup)) return;

      const a = vertices[edge.a].position;
      const b = vertices[edge.b].position;
      edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      this.edgeKeys.push(edge.key);
      const faceSelected = edge.triangles.some((triangleIndex) => selectedTriangles.has(triangleIndex));
      const vertexSelected = selectedVertices.has(edge.a) && selectedVertices.has(edge.b);
      const selected = selectionMode === 'edge'
        ? selectedEdges.has(edge.key)
        : selectionMode === 'face' ? faceSelected : vertexSelected;
      const color = selected ? ORANGE : EDGE_IDLE;
      edgeColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    });
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    edgeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
    this.lines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: selectionMode === 'edge' ? 1 : 0.72,
    }));
    this.lines.renderOrder = 101;
    this.group.add(this.lines);

    if (selectedTriangles.size) {
      const positions = [];
      for (const triangleIndex of selectedTriangles) {
        const triangle = triangles[triangleIndex];
        for (const vertexId of triangle.v) {
          const p = vertices[vertexId].position;
          positions.push(p.x, p.y, p.z);
        }
      }
      const faceGeometry = new THREE.BufferGeometry();
      faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const faces = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({
        color: ORANGE,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthTest: false,
      }));
      faces.renderOrder = 100;
      this.group.add(faces);
    }
  }
}
