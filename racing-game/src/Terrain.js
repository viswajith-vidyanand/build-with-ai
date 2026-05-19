import * as THREE from 'three';

// ─── World Constants ──────────────────────────────────────────────────────────
const CHUNK_SIZE       = 100;
const VIEW_DISTANCE    = 2;
const CHUNK_SEGMENTS   = 30;    // ground hill resolution
const ROAD_WIDTH       = 11;    // asphalt lane
const ROAD_SEG_LEN     = 3;     // length of each oriented road quad (smaller = smoother curve)

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.activeChunks = new Map();

    // ── Texture Loader ──────────────────────────────────────────────────────
    const loader = new THREE.TextureLoader();

    // Helper to load and tile a texture
    const loadTex = (url, repeatX, repeatY) => {
      const tex = loader.load(url);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 4; // sharpens texture at grazing angles without heavy cost
      return tex;
    };

    // Grass tiles every 8 units
    this.grassTex   = loadTex('/textures/grass.jpg',   CHUNK_SIZE / 8, CHUNK_SIZE / 8);
    // Asphalt: 1 tile across the road width, repeating along driving direction every 6 units
    this.asphaltTex = loadTex('/textures/asphalt.jpg', 1, ROAD_SEG_LEN / 5);

    // ── Materials ───────────────────────────────────────────────────────────
    this.grassMat = new THREE.MeshStandardMaterial({
      map:       this.grassTex,
      roughness: 0.95,
    });

    // Road: pure MeshStandardMaterial with asphalt texture. Completely separate from grass.
    this.roadMat = new THREE.MeshStandardMaterial({
      map:       this.asphaltTex,
      roughness: 0.75,
      metalness: 0.02,
    });

    // White marking paint
    this.markingMat = new THREE.MeshStandardMaterial({
      color:     0xffffff,
      roughness: 0.6,
    });

    // Road edge kerb (yellow/white stripe)
    this.kerbMat = new THREE.MeshStandardMaterial({ color: 0xdddd00 });

    // ── Shared base geometries for road segments ─────────────────────────────
    // Each segment is a small flat rectangle — no warping, so UVs stay crisp!
    // These are cloned per chunk so they can be positioned/rotated independently.
    this.roadSegGeo  = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_SEG_LEN);
    this.roadSegGeo.rotateX(-Math.PI / 2);

    this.dashGeo = new THREE.PlaneGeometry(0.3, ROAD_SEG_LEN * 0.45);
    this.dashGeo.rotateX(-Math.PI / 2);

    this.kerbGeo = new THREE.PlaneGeometry(0.5, ROAD_SEG_LEN);
    this.kerbGeo.rotateX(-Math.PI / 2);

    // ── Instanced tree geometry ──────────────────────────────────────────────
    this.trunkGeo  = new THREE.CylinderGeometry(0.35, 0.55, 2.5, 6);
    this.trunkMat  = new THREE.MeshToonMaterial({ color: 0x4E342E });
    this.leavesGeo = new THREE.ConeGeometry(2.8, 4.5, 6);
    this.leavesMat = new THREE.MeshToonMaterial({ color: 0x2E7D32 });
  }

  // ── Road centre X at any world Z ───────────────────────────────────────────
  getRoadCenter(z) {
    return Math.sin(z * 0.012) * 22 + Math.sin(z * 0.005) * 35;
  }

  // ── Terrain height at any world X/Z ────────────────────────────────────────
  getHeight(x, z) {
    const cx = this.getRoadCenter(z);
    const dist = Math.abs(x - cx);

    let y = Math.sin(x * 0.018) * Math.cos(z * 0.018) * 7.0;
    y    += Math.sin(x * 0.05  + z * 0.07) * 2.5;

    // Flatten near the road so it sits evenly
    const flatRadius  = ROAD_WIDTH / 2 + 1;
    const blendRadius = flatRadius + 6;
    if (dist < blendRadius) {
      const t = dist < flatRadius ? 0 : (dist - flatRadius) / (blendRadius - flatRadius);
      y *= t * t; // smooth quadratic fade to flat
    }
    return y;
  }

  // ── Road tangent direction at world Z ──────────────────────────────────────
  // Returns the yaw angle (in radians) the road faces at this Z position.
  getRoadYaw(z) {
    const dz   = 0.5; // small step for finite difference derivative
    const cx0  = this.getRoadCenter(z);
    const cx1  = this.getRoadCenter(z + dz);
    return Math.atan2(cx1 - cx0, dz); // arc tangent gives the forward angle
  }

  // ── Chunk Manager ───────────────────────────────────────────────────────────
  update(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const needed = new Set();

    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++)
      for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++)
        needed.add(`${pcx + dx},${pcz + dz}`);

    needed.forEach(k  => { if (!this.activeChunks.has(k)) this.generateChunk(k); });
    this.activeChunks.forEach((_, k) => { if (!needed.has(k)) this.removeChunk(k); });
  }

  // ── Chunk Generator ─────────────────────────────────────────────────────────
  generateChunk(key) {
    const [cxi, czi] = key.split(',').map(Number);
    const ox = cxi * CHUNK_SIZE;
    const oz = czi * CHUNK_SIZE;

    // ─ 1. GRASS GROUND ──────────────────────────────────────────────────────
    // A textured plane deformed into rolling hills. Uses vertex displacement.
    const geoG = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
    geoG.rotateX(-Math.PI / 2);
    const posG = geoG.attributes.position;
    for (let i = 0; i < posG.count; i++) {
      posG.setY(i, this.getHeight(posG.getX(i) + ox, posG.getZ(i) + oz));
    }
    geoG.computeVertexNormals();

    const groundMesh = new THREE.Mesh(geoG, this.grassMat);
    groundMesh.position.set(ox, 0, oz);
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // ─ 2. ROAD SEGMENTS ─────────────────────────────────────────────────────
    // Key insight: instead of one warped plane (which distorts the texture),
    // we lay down many small flat quads, each ROTATED to follow the curve.
    // Each quad is undeformed, so its UV grid stays perfectly square → straight lines!
    const roadGroup    = new THREE.Group();
    const dashGroup    = new THREE.Group();
    const kerbLGroup   = new THREE.Group();
    const kerbRGroup   = new THREE.Group();

    const numSegs = Math.ceil(CHUNK_SIZE / ROAD_SEG_LEN) + 1;

    for (let i = 0; i < numSegs; i++) {
      // World Z at the centre of this segment
      const wz    = oz - CHUNK_SIZE / 2 + i * ROAD_SEG_LEN;
      const cx    = this.getRoadCenter(wz);
      const yaw   = this.getRoadYaw(wz);
      const y     = this.getHeight(cx, wz) + 0.05; // sit just above the grass

      // Road surface quad (clone geometry so each mesh has its own matrix)
      const roadSeg = new THREE.Mesh(this.roadSegGeo, this.roadMat);
      roadSeg.position.set(cx, y, wz);
      roadSeg.rotation.y = yaw; // rotate to face the road direction
      roadGroup.add(roadSeg);

      // Dashed centre line (every other segment gets a dash)
      if (i % 2 === 0) {
        const dash = new THREE.Mesh(this.dashGeo, this.markingMat);
        dash.position.set(cx, y + 0.01, wz); // tiny offset above road to prevent z-fighting
        dash.rotation.y = yaw;
        dashGroup.add(dash);
      }

      // Yellow kerb strips on both road edges
      const halfW = ROAD_WIDTH / 2 + 0.25;
      // Offset the kerb left/right in the road's local frame
      const leftKerb  = new THREE.Mesh(this.kerbGeo, this.kerbMat);
      const ox_l = cx - Math.cos(yaw + Math.PI / 2) * halfW; // perpendicular offset
      const oz_l = wz - Math.sin(yaw + Math.PI / 2) * halfW;
      leftKerb.position.set(ox_l, y + 0.01, oz_l);
      leftKerb.rotation.y = yaw;
      kerbLGroup.add(leftKerb);

      const rightKerb = new THREE.Mesh(this.kerbGeo, this.kerbMat);
      const ox_r = cx + Math.cos(yaw + Math.PI / 2) * halfW;
      const oz_r = wz + Math.sin(yaw + Math.PI / 2) * halfW;
      rightKerb.position.set(ox_r, y + 0.01, oz_r);
      rightKerb.rotation.y = yaw;
      kerbRGroup.add(rightKerb);
    }

    this.scene.add(roadGroup);
    this.scene.add(dashGroup);
    this.scene.add(kerbLGroup);
    this.scene.add(kerbRGroup);

    // ─ 3. TREES ─────────────────────────────────────────────────────────────
    const treeGroup = this.scatterInstancedTrees(ox, oz);
    if (treeGroup) {
      this.scene.add(treeGroup.trunks);
      this.scene.add(treeGroup.leaves);
    }

    this.activeChunks.set(key, { groundMesh, roadGroup, dashGroup, kerbLGroup, kerbRGroup, treeGroup });
  }

  // ── Chunk Remover ───────────────────────────────────────────────────────────
  removeChunk(key) {
    const c = this.activeChunks.get(key);
    this.scene.remove(c.groundMesh);   c.groundMesh.geometry.dispose();
    this.scene.remove(c.roadGroup);
    this.scene.remove(c.dashGroup);
    this.scene.remove(c.kerbLGroup);
    this.scene.remove(c.kerbRGroup);
    if (c.treeGroup) {
      this.scene.remove(c.treeGroup.trunks);
      this.scene.remove(c.treeGroup.leaves);
      c.treeGroup.trunks.dispose();
      c.treeGroup.leaves.dispose();
    }
    this.activeChunks.delete(key);
  }

  // ── Deterministic seed-based random ────────────────────────────────────────
  pseudoRandom(x, z, i) {
    return Math.abs(Math.sin(x * 12.9898 + z * 78.233 + i * 45.123) * 43758.5453) % 1;
  }

  // ── Instanced Trees ─────────────────────────────────────────────────────────
  scatterInstancedTrees(ox, oz) {
    const count = Math.floor(this.pseudoRandom(ox, oz, 0) * 8) + 5;
    const positions = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const rx = ox + (this.pseudoRandom(ox, oz, i * 2 + 1) - 0.5) * CHUNK_SIZE;
      const rz = oz + (this.pseudoRandom(ox, oz, i * 2 + 2) - 0.5) * CHUNK_SIZE;
      const dist = Math.abs(rx - this.getRoadCenter(rz));
      if (dist > ROAD_WIDTH / 2 + 5) {
        positions.push(new THREE.Vector3(rx, this.getHeight(rx, rz), rz));
      }
    }
    if (!positions.length) return null;

    const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, positions.length);
    const leaves = new THREE.InstancedMesh(this.leavesGeo, this.leavesMat, positions.length);
    trunks.castShadow = true; leaves.castShadow = true;

    positions.forEach((p, i) => {
      const rot   = this.pseudoRandom(p.x, p.z, 5) * Math.PI;
      const scale = 0.8 + this.pseudoRandom(p.x, p.z, 6) * 0.45;
      dummy.position.set(p.x, p.y + scale, p.z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.y + 3.2 * scale, p.z);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    });
    return { trunks, leaves };
  }
}
