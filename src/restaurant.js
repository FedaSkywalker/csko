// Client-side decor for the Turkish Kebab restaurant: sign, awning, döner spit, tables, menu board
// and a warm lamp. The entrance faces -X. Collision (counter, tables) lives in the map layout.
import * as THREE from 'three';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture() {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#b3121b');
    g.addColorStop(1, '#6d070c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd35a';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    // little döner icon
    ctx.fillStyle = '#8a4b1f';
    ctx.beginPath();
    ctx.moveTo(80, 50); ctx.lineTo(130, 50); ctx.lineTo(118, 200); ctx.lineTo(92, 200); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(102, 30, 6, 200);
    for (let y = 60; y < 200; y += 18) { ctx.fillStyle = 'rgba(255,190,120,0.5)'; ctx.fillRect(86, y, 40, 5); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 118px Impact, "Arial Black", sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('TURKISH KEBAB', w / 2 + 50, 108);
    ctx.fillStyle = '#ffe27a';
    ctx.fillText('TURKISH KEBAB', w / 2 + 50, 108);
    ctx.font = 'bold 42px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Kebab · Vyprážaný syr · Hranolky · Tatarka', w / 2 + 50, 200);
  });
}

function stripeTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#f4f1e8' : '#c41a22';
      ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  });
}

function meatTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a3f17';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) {
      ctx.fillStyle = `rgba(${150 + Math.random() * 60},${80 + Math.random() * 40},${30 + Math.random() * 20},0.8)`;
      ctx.fillRect(0, y, w, 3 + Math.random() * 3);
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(60,25,8,${0.3 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 2);
    }
  });
}

function counterTexture(length) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a8141c';
    ctx.fillRect(0, 0, w, h);
    const tiles = Math.max(4, Math.round(length * 4));
    const tw = w / tiles;
    for (let i = 0; i < tiles; i++) {
      ctx.fillStyle = i % 2 ? '#f2efe8' : '#e4e0d6';
      ctx.fillRect(i * tw + 2, 28, tw - 4, 60);
    }
    ctx.fillStyle = '#6e0c11';
    ctx.fillRect(0, 0, w, 10);
    ctx.fillRect(0, h - 14, w, 14);
  });
}

function menuTexture() {
  return canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#1d1a17';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c9a44a';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#ffe27a';
    ctx.font = 'bold 46px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MENU', w / 2, 60);
    ctx.textAlign = 'left';
    ctx.font = '30px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#f2efe6';
    const rows = [['Kebab v chlebe', '4,50 €'], ['Vyprážaný syr + hranolky', '6,90 €'], ['Tatarka navyše', '0,80 €'], ['Kofola 0,5', '1,90 €']];
    rows.forEach(([n, p], i) => {
      ctx.fillText(n, 30, 120 + i * 48);
      ctx.textAlign = 'right';
      ctx.fillText(p, w - 30, 120 + i * 48);
      ctx.textAlign = 'left';
    });
  });
}

export function buildRestaurant(game) {
  const R = game.layout.restaurant;
  if (!R) return null;
  const Y = R.baseY || 0; // floor height of the dining room
  const group = new THREE.Group();
  group.name = 'restaurant';

  // Sign above the entrance, facing mid (-X).
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(R.sign.w, R.sign.h),
    new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }),
  );
  sign.position.set(R.sign.x, R.sign.y, R.sign.z);
  sign.rotation.y = -Math.PI / 2;
  group.add(sign);

  // Striped awning over the door.
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.05, R.sign.w + 0.2),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.9 }),
  );
  awning.position.set(R.sign.x - 0.5, R.sign.y - R.sign.h / 2 - 0.2, R.sign.z);
  awning.rotation.z = -0.35;
  awning.castShadow = true;
  group.add(awning);

  // Counter: red-painted wooden front with white tiles, stainless steel top.
  const C = R.counter;
  const cw = C.x1 - C.x0, cd = C.z1 - C.z0;
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(cw, C.h - 0.04, cd),
    new THREE.MeshStandardMaterial({ map: counterTexture(cd), roughness: 0.6 }),
  );
  front.position.set((C.x0 + C.x1) / 2, Y + (C.h - 0.04) / 2, (C.z0 + C.z1) / 2);
  front.castShadow = true;
  front.receiveShadow = true;
  group.add(front);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(cw + 0.06, 0.04, cd + 0.04),
    new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.25, metalness: 0.85 }),
  );
  top.position.set((C.x0 + C.x1) / 2, Y + C.h - 0.02, (C.z0 + C.z1) / 2);
  top.receiveShadow = true;
  group.add(top);

  // Döner spit on the counter, slowly turning, with a glowing grill behind it.
  const spit = new THREE.Group();
  spit.position.set(R.spit.x, R.spit.y, R.spit.z);
  const meat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.19, 0.72, 16),
    new THREE.MeshStandardMaterial({ map: meatTexture(), roughness: 0.6 }),
  );
  meat.position.y = 0.46;
  spit.add(meat);
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8), steel);
  rod.position.y = 0.5;
  spit.add(rod);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), steel);
  plate.position.y = 0.06;
  spit.add(plate);
  group.add(spit);
  const grill = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.8, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x3a1a0a, emissive: 0xff5a14, emissiveIntensity: 1.6, roughness: 0.8 }),
  );
  grill.position.set(R.spit.x + 0.45, R.spit.y + 0.48, R.spit.z);
  group.add(grill);

  // Tables with stools.
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 });
  for (const [x0, z0] of R.tables) {
    const t = new THREE.Group();
    t.position.set(x0 + 0.5, Y, z0 + 0.5);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 1), wood);
    top.position.y = 0.74;
    top.castShadow = true;
    top.receiveShadow = true;
    t.add(top);
    const tc = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.01, 0.7), cloth);
    tc.position.y = 0.77;
    t.add(tc);
    for (const [lx, lz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), wood);
      leg.position.set(lx, 0.36, lz);
      t.add(leg);
    }
    for (const [sx, sz] of [[0, -0.8], [0.75, 0]]) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.45, 12), wood);
      stool.position.set(sx, 0.225, sz);
      stool.castShadow = true;
      t.add(stool);
    }
    group.add(t);
  }

  // Menu board behind the counter.
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 1.1),
    new THREE.MeshBasicMaterial({ map: menuTexture(), toneMapped: false }),
  );
  board.position.set(R.board.x, R.board.y, R.board.z);
  board.rotation.y = -Math.PI / 2;
  group.add(board);

  // Warm lamp inside (the room is roofed, so the sun doesn't reach it).
  const lamp = new THREE.PointLight(0xffc27a, 9, 11, 1.6);
  lamp.position.set(R.light.x, R.light.y, R.light.z);
  group.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false }));
  bulb.position.copy(lamp.position);
  group.add(bulb);

  game.scene.add(group);
  return { group, spit };
}

// Fried cheese on a plate with fries and tartar sauce.
export function buildCheeseMesh() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.35 }));
  plate.position.y = 0.01;
  g.add(plate);
  const crust = new THREE.MeshStandardMaterial({ color: 0xd9962b, roughness: 0.75 });
  for (const [x, z, r] of [[-0.03, 0.02, 0.2], [0.05, -0.04, -0.35]]) {
    const cheese = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.1), crust);
    cheese.position.set(x, 0.04 + (r < 0 ? 0.02 : 0), z);
    cheese.rotation.y = r;
    cheese.castShadow = true;
    g.add(cheese);
  }
  const fry = new THREE.MeshStandardMaterial({ color: 0xf1c75b, roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.085), fry);
    f.position.set(0.02 + Math.random() * 0.1, 0.03 + Math.random() * 0.02, 0.05 + Math.random() * 0.06);
    f.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, 0);
    g.add(f);
  }
  const tartar = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf5f3e6, roughness: 0.4 }));
  tartar.scale.y = 0.55;
  tartar.position.set(-0.1, 0.03, -0.07);
  g.add(tartar);
  return g;
}
