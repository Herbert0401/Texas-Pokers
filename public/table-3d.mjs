import * as THREE from './vendor/three.module.js';
import { tableView, chipValues, wagerChanges, seatLayout } from './table-model.mjs';
import createIcon from './vendor/lucide/createElement.js';
import BookOpen from './vendor/lucide/icons/book-open.js';
import LogOut from './vendor/lucide/icons/log-out.js';
import Play from './vendor/lucide/icons/play.js';
import ArrowRight from './vendor/lucide/icons/arrow-right.js';
import RotateCcw from './vendor/lucide/icons/rotate-ccw.js';
import X from './vendor/lucide/icons/x.js';
import { playWagerSound } from './table-sound.mjs';

for (const [selector, icon] of [
  ['#rulesButton', BookOpen], ['#exitButton', LogOut], ['#startButton', Play],
  ['#nextHandButton', ArrowRight], ['#restartButton', RotateCcw],
  ['#resultNextHand', ArrowRight], ['#resultRestart', RotateCcw], ['#joinForm button', ArrowRight]
]) {
  document.querySelector(selector).prepend(createIcon(icon, { width: 15, height: 15, 'aria-hidden': 'true' }));
}
document.querySelector('#closeRules').replaceChildren(createIcon(X, { width: 20, height: 20, 'aria-hidden': 'true' }));

const landing = document.querySelector('#landingScene');
const table = document.querySelector('#tableScene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const textures = new Map();
const suitStyles = {
  spades: ['♠', '#080e18'], hearts: ['♥', '#b00028'],
  diamonds: ['♦', '#003fa8'], clubs: ['♣', '#005c2c']
};
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  document.body.classList.add('no-webgl');
}

if (renderer) init();

function init() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
  const ambient = new THREE.HemisphereLight(0xe4f3ff, 0x34302c, 2.4);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2d9, 4.2);
  key.position.set(-3, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7 });
  key.shadow.bias = -0.001;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7dd8d2, 1.6);
  fill.position.set(7, 3, -4);
  scene.add(fill);
  const world = new THREE.Group();
  scene.add(world);
  const tableImprint = buildTable(world);
  const pieces = new THREE.Group();
  world.add(pieces);
  let host = landing;
  let snapshot = null;
  let signature = '';
  let dirty = true;
  let animationUntil = 0;
  let lastTime = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  let hovered = null;
  let potLedger = [];
  const bankroll = document.querySelector('#heroBankroll');

  function positionPanels() {
    if (snapshot?.players.length <= 2 || host !== table) return;
    const hostRect = host.getBoundingClientRect();
    const feltRect = host.parentElement.getBoundingClientRect();
    snapshot.players.forEach((player, index) => {
      const panel = document.querySelector(`.player-panel[data-player-id="${player.id}"]`);
      if (!panel) return;
      const { x, z } = seatLayout(index, snapshot.players.length);
      const point = new THREE.Vector3(z > 1.5 ? x - 2.65 : x, 0.3, z > 1.5 ? z : z - 0.8).project(camera);
      const px = (point.x + 1) / 2 * hostRect.width + hostRect.left - feltRect.left;
      const py = (1 - point.y) / 2 * hostRect.height + hostRect.top - feltRect.top;
      panel.style.left = `${Math.max(panel.offsetWidth / 2 + 4, Math.min(feltRect.width - panel.offsetWidth / 2 - 4, px))}px`;
      const top = z > 1.5 ? py - panel.offsetHeight / 2 : py - panel.offsetHeight - 4;
      panel.style.top = `${Math.max(4, Math.min(feltRect.height - panel.offsetHeight - 4, top))}px`;
    });
  }

  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const mobile = width < 650;
    const distance = Math.max(12.7, 18 / camera.aspect);
    camera.position.set(0, distance, mobile ? distance * 0.30 : distance * 0.53);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    queueMicrotask(positionPanels);
    dirty = true;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(landing);
  observer.observe(table);
  function update(state) {
    const next = tableView(state);
    const wagers = wagerChanges(snapshot, next);
    if (!snapshot || snapshot.hand !== next.hand || snapshot.preview !== next.preview || next.pot < snapshot.pot) {
      potLedger = chipValues(next.pot).map((value) => ({ value, born: 0 }));
    } else {
      for (const wager of wagers) {
        chipValues(wager.amount).forEach((value, i) => potLedger.push({
          value, player: wager.player, born: performance.now(), delay: Math.min(i * 35, 650)
        }));
      }
      if (potLedger.reduce((sum, chip) => sum + chip.value, 0) !== next.pot || potLedger.length > 144) {
        potLedger = chipValues(next.pot).map((value) => ({ value, born: 0 }));
      }
    }
    if (wagers.length && !document.hidden) playWagerSound(wagers.reduce((sum, wager) => sum + wager.amount, 0));
    const newHand = snapshot?.hand !== next.hand;
    snapshot = next;
    tableImprint.visible = snapshot.preview;
    bankroll.textContent = `筹码 ${snapshot.hero.chips}`;
    bankroll.classList.toggle('hidden', !state?.game || snapshot.players.length > 2);
    const nextHost = state ? table : landing;
    if (nextHost !== host || !renderer.domElement.parentElement) {
      host = nextHost;
      host.append(renderer.domElement);
    }
    const nextSignature = JSON.stringify(snapshot);
    if (nextSignature !== signature) {
      signature = nextSignature;
      hovered = null;
      pieces.userData.births = new Map(pieces.children.filter((piece) => piece.userData.card && !newHand)
        .map((piece) => [piece.userData.key, piece.userData.born]));
      clearPieces(pieces);
      buildPieces(pieces, snapshot, potLedger);
      animationUntil = performance.now() + 2200;
    }
    world.rotation.y = snapshot.preview ? -0.12 : 0;
    resize();
    dirty = true;
  }
  window.addEventListener('poker:state', (event) => update(event.detail));
  table.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = table.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pieces.children, true).find((item) => item.object.userData.card);
    const next = hit?.object || null;
    if (next !== hovered) { hovered = next; animationUntil = Math.max(animationUntil, performance.now() + 300); }
  });
  table.addEventListener('pointerleave', () => { hovered = null; animationUntil = Math.max(animationUntil, performance.now() + 300); });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    document.body.classList.remove('three-ready');
    document.body.classList.add('no-webgl');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    dirty = true;
    document.body.classList.remove('no-webgl');
    document.body.classList.add('three-ready');
  });
  update(window.pokerPresentationState || null);
  renderer.render(scene, camera);
  document.body.classList.add('three-ready');
  renderer.setAnimationLoop((time) => {
    if (document.hidden || time - lastTime < 32) return;
    const moving = !reducedMotion.matches && (snapshot.preview || time < animationUntil);
    if (!dirty && !moving) return;
    lastTime = time;
    if (snapshot.preview && !reducedMotion.matches) {
      world.rotation.y = -0.12 + Math.sin(time * 0.00022) * 0.045;
    }
    pieces.children.forEach((piece) => {
      if (piece.userData.motion) {
        const motion = piece.userData.motion;
        const progress = reducedMotion.matches ? 1 : THREE.MathUtils.clamp((time - motion.born - motion.delay) / 900, 0, 1);
        const eased = 1 - (1 - progress) ** 3;
        piece.position.lerpVectors(motion.from, motion.to, eased);
        piece.position.y += Math.sin(progress * Math.PI) * 0.35;
      }
      if (!piece.userData.card) return;
      const elapsed = Math.max(0, time - piece.userData.born - piece.userData.delay);
      const progress = reducedMotion.matches ? 1 : Math.min(1, elapsed / 650);
      const lift = piece === hovered ? 0.28 : 0;
      piece.position.y = 0.29 + (1 - progress) ** 3 * 1.3 + lift;
      piece.rotation.y = Math.PI * (1 - progress) ** 2;
    });
    renderer.render(scene, camera);
    dirty = false;
  });
}

function oval(radius, height, color, sx, sz, y, roughness = 0.6) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 96),
    new THREE.MeshStandardMaterial({ color, roughness, metalness: roughness < 0.4 ? 0.65 : 0.05 }));
  mesh.scale.set(sx, 1, sz);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function buildTable(group) {
  group.add(oval(1, 0.38, '#121718', 6.55, 4.35, -0.30));
  group.add(oval(1, 0.07, '#c5a368', 6.50, 4.30, -0.065, 0.3));
  group.add(oval(1, 0.28, '#251d20', 6.39, 4.19, 0.02));
  const felt = oval(1, 0.08, '#155841', 5.94, 3.74, 0.16);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#367b71'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 3) {
    ctx.fillStyle = i % 2 ? '#397d74' : '#32786e';
    ctx.fillRect(i, 0, 1, 256); ctx.fillRect(0, i, 256, 1);
  }
  const grain = new THREE.CanvasTexture(canvas);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(7, 7);
  felt.material.map = grain;
  felt.material.roughness = 1;
  group.add(felt);
  const points = Array.from({ length: 129 }, (_, i) => {
    const a = i / 128 * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 5.40, 0.211, Math.sin(a) * 3.23);
  });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: '#d4bc80', transparent: true, opacity: 0.45 })));

  const stitches = [];
  for (let i = 0; i < 180; i++) {
    for (const step of [i, i + 0.48]) {
      const a = step / 180 * Math.PI * 2;
      stitches.push(new THREE.Vector3(Math.cos(a) * 6.16, 0.166, Math.sin(a) * 3.98));
    }
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stitches),
    new THREE.LineBasicMaterial({ color: '#bd9d73', transparent: true, opacity: 0.7 })));

  const print = document.createElement('canvas');
  print.width = 1024; print.height = 192;
  const ink = print.getContext('2d');
  ink.fillStyle = '#ddc99a'; ink.textAlign = 'center';
  ink.font = 'bold 90px Georgia, serif'; ink.fillText('SHORT DECK', 512, 96);
  ink.font = '36px Georgia, serif'; ink.fillText('♠    ♥    ♦    ♣', 512, 158);
  ink.fillRect(200, 145, 130, 2); ink.fillRect(694, 145, 130, 2);
  const map = new THREE.CanvasTexture(print);
  map.colorSpace = THREE.SRGBColorSpace;
  const imprint = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.72),
    new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.8, depthWrite: false }));
  imprint.rotation.x = -Math.PI / 2;
  imprint.position.set(0, 0.215, 1.65);
  group.add(imprint);
  return imprint;
}

function cardTexture(card) {
  const key = card ? `${card.rank}-${card.suit}` : 'back';
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 368;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = card ? '#fffdf7' : '#482635'; ctx.fillRect(0, 0, 256, 368);
  if (card) {
    const [symbol, color] = suitStyles[card.suit] || suitStyles.spades;
    const rank = card.rank === 'T' ? '10' : card.rank;
    ctx.fillStyle = color;
    ctx.font = '900 96px Arial'; ctx.fillText(rank, 16, 92);
    ctx.font = 'bold 56px Arial'; ctx.fillText(symbol, 20, 145);
    ctx.font = 'bold 142px Arial'; ctx.textAlign = 'center'; ctx.fillText(symbol, 128, 267);
    ctx.save(); ctx.translate(256, 368); ctx.rotate(Math.PI);
    ctx.textAlign = 'left'; ctx.font = 'bold 60px Arial'; ctx.fillText(rank, 18, 65);
    ctx.restore();
  } else {
    ctx.strokeStyle = '#d9bc89'; ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 232, 344);
    ctx.strokeRect(20, 20, 216, 328);
    ctx.save(); ctx.beginPath(); ctx.rect(25, 25, 206, 318); ctx.clip();
    ctx.strokeStyle = '#80505a'; ctx.lineWidth = 2;
    for (let i = -368; i < 650; i += 22) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 368, 368); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 368); ctx.lineTo(i + 368, 0); ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(128, 104); ctx.lineTo(182, 184); ctx.lineTo(128, 264); ctx.lineTo(74, 184); ctx.closePath();
    ctx.fillStyle = '#482635'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#efd69e'; ctx.textAlign = 'center'; ctx.font = '72px Georgia'; ctx.fillText('♠', 128, 206);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  textures.set(key, texture);
  return texture;
}

function addCard(group, card, x, z, index, angle = 0) {
  const edge = new THREE.MeshStandardMaterial({ color: '#e8e4d9', roughness: 0.65 });
  const front = new THREE.MeshBasicMaterial({ map: cardTexture(card), toneMapped: false });
  const back = new THREE.MeshBasicMaterial({ map: cardTexture(null), toneMapped: false });
  const outline = new THREE.Shape();
  outline.moveTo(-0.40, -0.655);
  outline.lineTo(0.40, -0.655); outline.quadraticCurveTo(0.455, -0.655, 0.455, -0.60);
  outline.lineTo(0.455, 0.60); outline.quadraticCurveTo(0.455, 0.655, 0.40, 0.655);
  outline.lineTo(-0.40, 0.655); outline.quadraticCurveTo(-0.455, 0.655, -0.455, 0.60);
  outline.lineTo(-0.455, -0.60); outline.quadraticCurveTo(-0.455, -0.655, -0.40, -0.655);
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.035, bevelEnabled: false, steps: 1, curveSegments: 4 });
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + 0.455) / 0.91, (positions.getY(i) + 0.655) / 1.31);
  geometry.clearGroups();
  let start = 0;
  let materialIndex = -1;
  for (let i = 0; i < positions.count; i += 3) {
    const nz = geometry.attributes.normal.getZ(i);
    const next = nz > 0.5 ? 0 : nz < -0.5 ? 2 : 1;
    if (next !== materialIndex) {
      if (i > start) geometry.addGroup(start, i - start, materialIndex);
      start = i; materialIndex = next;
    }
  }
  geometry.addGroup(start, positions.count - start, materialIndex);
  const mesh = new THREE.Mesh(geometry, [front, edge, back]);
  mesh.rotation.set(-Math.PI / 2, 0, angle);
  mesh.scale.set(1.08, 1.08, 1);
  mesh.position.set(x, 0.29, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const key = `${x}:${z}:${card?.rank}:${card?.suit}`;
  mesh.userData = { card: true, key, born: group.userData.births?.get(key) ?? performance.now(), delay: index * 65 };
  group.add(mesh);
}

function chipTexture(value, color) {
  const key = `chip-${value}-${color}`;
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#fff2db'; ctx.lineWidth = 8;
  ctx.setLineDash([13, 16]); ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(64, 64, 38, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff2db'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(value, 64, 65);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, texture); return texture;
}

function addStack(group, count, x, z, color, value) {
  if (!count) return;
  const side = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  const face = new THREE.MeshStandardMaterial({ map: chipTexture(value, color), roughness: 0.5 });
  const geometry = new THREE.CylinderGeometry(0.245, 0.245, 0.075, 32);
  for (let i = 0; i < count; i++) {
    const chip = new THREE.Mesh(geometry, [side, face, face]);
    chip.position.set(x + Math.sin(i * 2) * 0.015, 0.26 + i * 0.08, z);
    chip.rotation.y = i * 0.3; chip.castShadow = true; chip.receiveShadow = true;
    group.add(chip);
  }
}

function addPile(group, amount, x, z) {
  const values = chipValues(amount, true);
  let column = 0;
  for (const [value, color] of [[100, '#b12f49'], [50, '#246aa0'], [10, '#c7a45d'], [1, '#437767']]) {
    let count = values.filter((chip) => chip === value).length;
    while (count > 0 && column < 6) {
      const height = Math.min(12, count);
      addStack(group, height, x + column * 0.53, z, color, String(value));
      count -= height;
      column++;
    }
  }
}

function buildPieces(group, view, potLedger) {
  view.board.forEach((card, i) => {
    if (card) addCard(group, card, (i - 2) * 1.03, 0.05, i);
    else {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.91, 0.012, 1.31),
        new THREE.MeshStandardMaterial({ color: '#2b746a', roughness: 1 }));
      slot.position.set((i - 2) * 1.03, 0.218, 0.05); group.add(slot);
    }
  });
  if (!view.preview && view.players.length > 2) {
    view.players.forEach((player, index) => {
      const { x, z } = seatLayout(index, view.players.length);
      player.cards.forEach((card, i) => {
        addCard(group, card, x + (i - 0.5) * 0.75, z, i, i ? -0.06 : 0.06);
        group.children.at(-1).scale.set(0.88, 0.88, 1);
      });
      const pile = new THREE.Group();
      addPile(pile, player.chips, 0, 0);
      pile.scale.setScalar(0.6);
      pile.position.set(x - 0.7, 0.12, z + (z > 0 ? -0.8 : 0.8));
      group.add(pile);
    });
  } else for (const [player, z] of [[view.hero, 2.25], [view.opponent, -2.15]]) {
    if (!view.preview) player.cards.forEach((card, i) => addCard(group, card, 1.25 + i * 0.94, z, i, i ? -0.08 : 0.08));
    addPile(group, view.preview ? 850 : player.chips, 3.0, z + (z > 0 ? -0.6 : 0.6));
    if (player.dealer || view.preview && z > 0) {
      const dealer = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 32),
        new THREE.MeshStandardMaterial({ map: chipTexture('D', '#a58343'), roughness: 0.35 }));
      dealer.position.set(-1.5, 0.29, z); dealer.castShadow = true; group.add(dealer);
    }
  }
  const chips = view.preview ? chipValues(670, true).map((value) => ({ value, born: 0 })) : potLedger;
  chips.forEach((entry, index) => {
    const column = Math.floor(index / 14);
    const x = -1.2 + (column % 4) * 0.55;
    const z = -1.1 - Math.floor(column / 4) * 0.53;
    const color = { 100: '#b12f49', 50: '#246aa0', 10: '#c7a45d', 1: '#437767' }[entry.value];
    addStack(group, 1, x, z, color, String(entry.value));
    const chip = group.children[group.children.length - 1];
    chip.position.y += index % 14 * 0.08;
    const to = chip.position.clone();
    const playerIndex = view.players.findIndex(player => player.id === entry.player);
    const origin = view.players.length > 2 && playerIndex >= 0 ? seatLayout(playerIndex, view.players.length)
      : { x: 3.1, z: entry.player === view.hero.id || entry.player === 'hero' ? 3.0 : -2.75 };
    chip.userData.motion = {
      from: new THREE.Vector3(origin.x, 0.4, origin.z),
      to, born: entry.born, delay: entry.delay || 0
    };
    if (!entry.born) chip.userData.motion = null;
  });
}

function clearPieces(group) {
  const geometries = new Set(); const materials = new Set();
  group.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    const list = Array.isArray(node.material) ? node.material : [node.material];
    list.filter(Boolean).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}
