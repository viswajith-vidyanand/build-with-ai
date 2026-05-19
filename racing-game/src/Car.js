import * as THREE from 'three';

// ─── Materials used across all cars (created once, reused everywhere) ─────────
// We create these at module level so we don't recreate identical materials on every spawn.
const MAT = {
  white:   new THREE.MeshToonMaterial({ color: 0xeeeeee }),
  black:   new THREE.MeshToonMaterial({ color: 0x111111 }),
  darkGrey:new THREE.MeshToonMaterial({ color: 0x222222 }),
  red:     new THREE.MeshToonMaterial({ color: 0xcc0000 }),
  lamp:    new THREE.MeshToonMaterial({ color: 0xffffaa }),
  rubber:  new THREE.MeshToonMaterial({ color: 0x1a1a1a }),
  alloy:   new THREE.MeshToonMaterial({ color: 0xaaaaaa }),
  blue:    new THREE.MeshToonMaterial({ color: 0x1a3aff }),
  yellow:  new THREE.MeshToonMaterial({ color: 0xffee00 }),
  spoiler: new THREE.MeshToonMaterial({ color: 0x555555 }),
};

export class Car {
  constructor(scene) {
    this.scene = scene;

    // Physics defaults — overwritten on spawn()
    this.speed         = 0;
    this.maxSpeed      = 30.0;
    this.acceleration  = 15.0;
    this.friction      = 5.0;      // Drag when coasting
    this.brakeForce    = 25.0;     // Braking deceleration
    this.steeringAngle = 0;
    this.maxSteerAngle = 0.5;
    this.steerSpeed    = 2.0;

    this.mesh    = new THREE.Group();
    this.wheels  = [];             // Store wheel meshes for spin animation
    this.carType = '86';
  }

  // ── Spawn / Re-spawn ────────────────────────────────────────────────────────
  spawn(carType) {
    // Clear previous car pieces
    while (this.mesh.children.length > 0) {
      this.mesh.remove(this.mesh.children[0]);
    }
    this.wheels  = [];
    this.carType = carType;
    this.speed   = 0;

    if (carType === '86') {
      this.maxSpeed      = 35.0;
      this.acceleration  = 18.0;
      this.maxSteerAngle = 0.6;
      this.build86Car();
    } else if (carType === 'truck') {
      this.maxSpeed      = 20.0;
      this.acceleration  = 8.0;
      this.maxSteerAngle = 0.35;
      this.buildTruck();
    } else if (carType === 'speedster') {
      this.maxSpeed      = 45.0;
      this.acceleration  = 25.0;
      this.maxSteerAngle = 0.7;
      this.buildSpeedster();
    }

    if (!this.scene.children.includes(this.mesh)) {
      this.scene.add(this.mesh);
    }
  }

  // ── Helper: add a wheel at a local position ──────────────────────────────────
  // Wheels are CylinderGeometry rotated 90° so they roll on Z.
  // frontLeft/Right steer visually by being separate groups.
  addWheel(x, y, z, radius = 0.35, width = 0.3) {
    const wheelGroup = new THREE.Group();

    // Tyre (rubber outer ring)
    const tyreGeo  = new THREE.CylinderGeometry(radius, radius, width, 24); // 24 segments = smooth circle
    const tyre     = new THREE.Mesh(tyreGeo, MAT.rubber);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    wheelGroup.add(tyre);

    // Alloy rim (smaller disc inside)
    const rimGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 16); // 16 segments = round rim
    const rim    = new THREE.Mesh(rimGeo, MAT.alloy);
    rim.rotation.z = Math.PI / 2;
    wheelGroup.add(rim);

    wheelGroup.position.set(x, y, z);
    this.mesh.add(wheelGroup);
    this.wheels.push(wheelGroup); // remember for rotation animation
    return wheelGroup;
  }

  // ── AE86 Low-Poly Model ─────────────────────────────────────────────────────
  build86Car() {
    // All measurements are in Three.js units.
    // Car sits so its wheel bottoms touch Y=0, body height is ~1.22 units.

    // ── Body panels ──────────────────────────────────────────────────────────

    // Lower sill / floor slab — black panda lower body
    const sillGeo = new THREE.BoxGeometry(1.82, 0.25, 4.0);
    const sill    = new THREE.Mesh(sillGeo, MAT.black);
    sill.position.set(0, 0.48, 0);
    sill.castShadow = true;
    this.mesh.add(sill);

    // Main hood + trunk panel — white upper body (slightly narrower for fender flare look)
    const bodyGeo = new THREE.BoxGeometry(1.76, 0.38, 4.0);
    const body    = new THREE.Mesh(bodyGeo, MAT.white);
    body.position.set(0, 0.73, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);

    // Windscreen pillar / lower greenhouse — tapers at front
    const pillarsGeo = new THREE.BoxGeometry(1.70, 0.45, 1.95);
    const pillars    = new THREE.Mesh(pillarsGeo, MAT.white);
    pillars.position.set(0, 0.955, 0.15); // slightly rearward (hatchback)
    pillars.castShadow = true;
    this.mesh.add(pillars);

    // Roof — tall enough for hatchback look
    const roofGeo = new THREE.BoxGeometry(1.60, 0.28, 1.68);
    const roof    = new THREE.Mesh(roofGeo, MAT.white);
    roof.position.set(0, 1.29, 0.22);
    this.mesh.add(roof);

    // Glass (dark tinted panels sitting inside the greenhouse)
    const windshieldGeo = new THREE.BoxGeometry(1.55, 0.38, 0.08);
    const windshield    = new THREE.Mesh(windshieldGeo, MAT.darkGrey);
    windshield.position.set(0, 1.08, -0.77); // front screen
    this.mesh.add(windshield);

    const rearScreenGeo = new THREE.BoxGeometry(1.50, 0.32, 0.08);
    const rearScreen    = new THREE.Mesh(rearScreenGeo, MAT.darkGrey);
    rearScreen.position.set(0, 1.10, 1.03); // rear hatch screen
    this.mesh.add(rearScreen);

    // Rear hatch slope — angled panel (we fake slope with a squashed box) 
    // This gives the signature notchback fastback shape.
    const hatchGeo = new THREE.BoxGeometry(1.70, 0.22, 0.55);
    const hatch    = new THREE.Mesh(hatchGeo, MAT.white);
    hatch.rotation.x = 0.35; // tilt it slightly down rearward
    hatch.position.set(0, 1.14, 1.18);
    this.mesh.add(hatch);

    // ── Front Details ────────────────────────────────────────────────────────

    // Nose cone / front bumper (black lower, white upper)
    const bumpGeo  = new THREE.BoxGeometry(1.78, 0.22, 0.18);
    const frontBump = new THREE.Mesh(bumpGeo, MAT.black);
    frontBump.position.set(0, 0.42, -2.07);
    this.mesh.add(frontBump);

    const noseGeo  = new THREE.BoxGeometry(1.72, 0.18, 0.18);
    const nose     = new THREE.Mesh(noseGeo, MAT.white);
    nose.position.set(0, 0.68, -2.07);
    this.mesh.add(nose);

    // Iconic pop-up headlight housings (raised position — "open")
    const hlHousingGeo = new THREE.BoxGeometry(0.38, 0.2, 0.22);

    const llHousing = new THREE.Mesh(hlHousingGeo, MAT.black);
    llHousing.position.set(-0.60, 0.84, -1.98);
    this.mesh.add(llHousing);

    const rlHousing = new THREE.Mesh(hlHousingGeo, MAT.black);
    rlHousing.position.set(0.60, 0.84, -1.98);
    this.mesh.add(rlHousing);

    // Lamp bulbs
    const bulbGeo = new THREE.BoxGeometry(0.30, 0.12, 0.06);
    const lBulb   = new THREE.Mesh(bulbGeo, MAT.lamp);
    lBulb.position.set(-0.60, 0.84, -2.10);
    this.mesh.add(lBulb);
    const rBulb   = new THREE.Mesh(bulbGeo, MAT.lamp);
    rBulb.position.set(0.60, 0.84, -2.10);
    this.mesh.add(rBulb);

    // Grille strip between headlights
    const grilleGeo  = new THREE.BoxGeometry(0.62, 0.12, 0.10);
    const grille     = new THREE.Mesh(grilleGeo, MAT.black);
    grille.position.set(0, 0.68, -2.07);
    this.mesh.add(grille);

    // ── Rear Details ─────────────────────────────────────────────────────────

    // Rear tail-light strip — iconic full width red bar
    const tailGeo  = new THREE.BoxGeometry(1.68, 0.18, 0.10);
    const tail     = new THREE.Mesh(tailGeo, MAT.red);
    tail.position.set(0, 0.72, 2.04);
    this.mesh.add(tail);

    const rearBumpGeo = new THREE.BoxGeometry(1.78, 0.22, 0.16);
    const rearBump    = new THREE.Mesh(rearBumpGeo, MAT.black);
    rearBump.position.set(0, 0.44, 2.05);
    this.mesh.add(rearBump);

    // ── Wheels ────────────────────────────────────────────────────────────────
    // Position: (x=±side, y=hub height, z=front/rear)
    // Wheel hub centre at y=0.36 (just above ground at y=0)
    const W = 1.05; // half-track width
    const Y = 0.36;
    this.addWheel(-W,  Y, -1.20); // front-left
    this.addWheel( W,  Y, -1.20); // front-right
    this.addWheel(-W,  Y,  1.20); // rear-left
    this.addWheel( W,  Y,  1.20); // rear-right
  }

  // ── Truck ────────────────────────────────────────────────────────────────────
  buildTruck() {
    const chassisGeo = new THREE.BoxGeometry(2.2, 0.8, 5.0);
    const chassis    = new THREE.Mesh(chassisGeo, MAT.blue);
    chassis.position.y = 0.85;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.mesh.add(chassis);

    const cabinGeo = new THREE.BoxGeometry(2.05, 1.2, 1.6);
    const cabin    = new THREE.Mesh(cabinGeo, MAT.darkGrey);
    cabin.position.set(0, 1.6, -1.6);
    cabin.castShadow = true;
    this.mesh.add(cabin);

    // Big truck wheels
    const W = 1.15, Y = 0.48;
    this.addWheel(-W, Y, -1.5, 0.48, 0.45);
    this.addWheel( W, Y, -1.5, 0.48, 0.45);
    this.addWheel(-W, Y,  1.5, 0.48, 0.45);
    this.addWheel( W, Y,  1.5, 0.48, 0.45);
  }

  // ── Speedster ────────────────────────────────────────────────────────────────
  buildSpeedster() {
    const chassisGeo = new THREE.BoxGeometry(1.60, 0.35, 3.6);
    const chassis    = new THREE.Mesh(chassisGeo, MAT.yellow);
    chassis.position.y = 0.40;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.mesh.add(chassis);

    const rearGeo  = new THREE.BoxGeometry(1.62, 0.22, 0.5);
    const spoiler  = new THREE.Mesh(rearGeo, MAT.spoiler);
    spoiler.position.set(0, 0.85, 1.6);
    this.mesh.add(spoiler);

    // Low, wide stance wheels
    const W = 1.0, Y = 0.30;
    this.addWheel(-W, Y, -1.1, 0.30, 0.28);
    this.addWheel( W, Y, -1.1, 0.30, 0.28);
    this.addWheel(-W, Y,  1.1, 0.30, 0.28);
    this.addWheel( W, Y,  1.1, 0.30, 0.28);
  }

  // ── Physics Update ───────────────────────────────────────────────────────────
  update(deltaTime, inputs) {
    if (this.mesh.children.length === 0) return;

    // Engine force
    let force = 0;
    if (inputs.forward)  force =  this.acceleration;
    if (inputs.backward) force = -this.brakeForce;

    // Friction regardless of input
    if (this.speed > 0) {
      this.speed -= this.friction * deltaTime;
      if (this.speed < 0 && !inputs.backward) this.speed = 0;
    } else if (this.speed < 0) {
      this.speed += this.friction * deltaTime;
      if (this.speed > 0 && !inputs.forward) this.speed = 0;
    }

    this.speed += force * deltaTime;
    this.speed  = Math.max(Math.min(this.speed, this.maxSpeed), -this.maxSpeed / 2);

    // Steering
    let steerDir = 0;
    if (inputs.left)  steerDir =  1;
    if (inputs.right) steerDir = -1;
    const reverse = this.speed < -0.1 ? -1 : 1;

    if (Math.abs(this.speed) > 0.1) {
      const target = steerDir * this.maxSteerAngle;
      this.steeringAngle += (target - this.steeringAngle) * this.steerSpeed * deltaTime;
      this.mesh.rotation.y += this.steeringAngle * this.speed * deltaTime * 0.2 * reverse;
    } else {
      this.steeringAngle *= 0.85;
    }

    // Movement
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
    this.mesh.position.addScaledVector(dir, this.speed * deltaTime);

    // Wheel spin animation:
    // The tyre/rim cylinders have rotation.z = PI/2, so their axle runs along world X.
    // To ROLL forward, we spin around world X — which for a Z-rotated child means rotation.x.
    const spinRate = (this.speed / (this.maxSpeed * 0.5)) * deltaTime * 8;
    this.wheels.forEach(w => {
      w.children[0].rotation.x += spinRate; // tyre rolls
      w.children[1].rotation.x += spinRate; // rim rolls
    });
  }
}
