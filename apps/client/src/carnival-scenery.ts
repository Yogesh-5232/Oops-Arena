import * as pc from 'playcanvas';
import { PLAZA_BOOTH, PLAZA_PLANTERS, PLAZA_RAIL_X, PLAZA_PORTALS } from '@chaos/shared';

const portalTints = {
  dash: [0.03, 0.45, 1.0],
  dodge: [0.66, 0.17, 1.0],
  lava: [1.0, 0.30, 0.03],
  team: [0.38, 0.88, 0.07],
};

const portalPaint = { dash: '#2669bc', dodge: '#8f42bb', lava: '#c33933', team: '#438a36' };

const archSegments = 24;
const springHeight = 1.82;
const archHalfWidth = 1.08;
const archRise = 0.68;

function archOutline(border: number): [number, number][] {
  const width = archHalfWidth + border;
  return [
    [width, 0],
    ...Array.from({ length: archSegments + 1 }, (_, index): [number, number] => {
      const angle = index * Math.PI / archSegments;
      return [width * Math.cos(angle), springHeight + (archRise + border) * Math.sin(angle)];
    }),
    [-width, 0],
  ];
}

/** The same outline defines the opaque field, gold trim, and painted wooden shell. */
function archMesh(device: pc.GraphicsDevice, innerBorder?: number, outerBorder = 0, depth = 0): pc.Mesh {
  const outside = archOutline(outerBorder);
  const inside = innerBorder === undefined ? undefined : archOutline(innerBorder);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = (point: [number, number], z: number, normal: number[]) => {
    const index = positions.length / 3;
    positions.push(...point, z);
    normals.push(...normal);
    uvs.push(point[0] / (2 * archHalfWidth) + 0.5, point[1] / (springHeight + archRise));
    return index;
  };

  if (inside) {
    for (let index = 0; index < outside.length - 1; index++) {
      const a = outside[index]!;
      const b = outside[index + 1]!;
      const i = vertex(a, 0, [0, 0, 1]);
      vertex(b, 0, [0, 0, 1]);
      vertex(inside[index + 1]!, 0, [0, 0, 1]);
      vertex(inside[index]!, 0, [0, 0, 1]);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      const edge = new pc.Vec3(b[1] - a[1], a[0] - b[0], 0).normalize();
      const normal = [edge.x, edge.y, 0];
      const j = vertex(a, 0, normal);
      vertex(a, -depth, normal);
      vertex(b, -depth, normal);
      vertex(b, 0, normal);
      indices.push(j, j + 1, j + 2, j, j + 2, j + 3);
    }
  } else {
    const center = vertex([0, springHeight / 2], 0, [0, 0, 1]);
    for (const point of outside) vertex(point, 0, [0, 0, 1]);
    for (let index = 1; index <= outside.length; index++) {
      indices.push(center, index, index % outside.length + 1);
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

const portalIcons = {
  dash: 'M6 22h10M3 29h10M21 16l8 3 6 8 10 1M29 19l-6 13 8 7-3 9M23 32l-9 7H7M34 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
  dodge: 'M5 24h13M3 32h12M9 40h9M22 27a12 12 0 1 0 24 0 12 12 0 1 0-24 0',
  lava: 'M24 45C8 41 11 28 20 19c-1 9 5 9 6 6 4-8 3-12 2-17 14 10 19 23 12 32-3 4-8 6-16 5z',
  team: 'M26 8 43 17v19l-17 9-17-9V17zM9 17l17 9 17-9M26 26v19',
};

function portalBadge(device: pc.GraphicsDevice, preset: keyof typeof portalIcons): pc.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(64, 64);
  ctx.scale(2.1, 2.1);
  ctx.translate(-26, -26);
  ctx.strokeStyle = '#fff4d8';
  ctx.lineWidth = 3.7;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(portalIcons[preset]));
  const texture = new pc.Texture(device, { width: 128, height: 128, format: pc.PIXELFORMAT_RGBA8 });
  texture.setSource(canvas);
  return texture;
}

export function mountPortalEffects(app: pc.Application, root: pc.Entity): void {
  const device = app.graphicsDevice;
  const field = archMesh(device);
  const frame = archMesh(device, 0, 0.38, 0.66);
  const trim = archMesh(device, 0, 0.075, 0.1);
  const resources: (pc.Material | pc.Texture)[] = [];
  const gold = new pc.StandardMaterial();
  gold.diffuse.fromString('#f9ae31');
  gold.update();
  resources.push(gold);
  const addMesh = (parent: pc.Entity, name: string, mesh: pc.Mesh, material: pc.Material, z: number) => {
    const entity = new pc.Entity(name);
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material, entity)] });
    entity.setLocalPosition(0, 0, z);
    parent.addChild(entity);
  };
  const materials = PLAZA_PORTALS.map(portal => {
    const material = new pc.ShaderMaterial({
      uniqueName: 'CarnivalPortal',
      attributes: { aPosition: pc.SEMANTIC_POSITION, aUv: pc.SEMANTIC_TEXCOORD0 },
      vertexGLSL: `
        attribute vec3 aPosition;
        attribute vec2 aUv;
        uniform mat4 matrix_model;
        uniform mat4 matrix_viewProjection;
        varying vec2 vUv;
        void main(void) {
          vUv = aUv;
          gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
        }`,
      fragmentGLSL: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uTint;
        void main(void) {
          vec2 p = vUv * 2.0 - 1.0;
          float radius = length(p);
          float angle = atan(p.y, p.x + 0.00001);
          float spiral = 0.5 + 0.5 * cos(3.0 * angle - 14.0 * radius + uTime * 1.6);
          float arm = pow(spiral, 4.0) * exp(-radius * 1.7);
          float core = exp(-radius * 11.0);
          float rim = smoothstep(0.86, 1.0, max(abs(p.x), abs(p.y)));
          vec3 color = uTint * (0.27 + 1.55 * arm + 0.57 * rim);
          color = mix(color, vec3(1.0, 0.96, 0.82), core * 0.9);
          gl_FragColor = vec4(color, 1.0);
        }`,
    });
    material.setParameter('uTime', 0);
    material.setParameter('uTint', portalTints[portal.preset]);
    const arch = new pc.Entity(`${portal.preset} portal`);
    arch.setLocalPosition(portal.x, 0, portal.z);
    arch.setLocalEulerAngles(0, portal.yaw * pc.math.RAD_TO_DEG, 0);
    root.addChild(arch);
    const paintedWood = new pc.StandardMaterial();
    paintedWood.diffuse.fromString(portalPaint[portal.preset]);
    paintedWood.update();
    addMesh(arch, 'Opaque portal field', field, material, 0.29);
    addMesh(arch, 'Painted arch', frame, paintedWood, 0.30);
    addMesh(arch, 'Gold inner trim', trim, gold, 0.32);

    const badge = new pc.Entity('Mode medallion');
    badge.addComponent('render', { type: 'cylinder', material: paintedWood });
    badge.setLocalPosition(0, 2.9, 0.35);
    badge.setLocalEulerAngles(90, 0, 0);
    badge.setLocalScale(1.14, 0.26, 1.14);
    arch.addChild(badge);

    const texture = portalBadge(device, portal.preset);
    const iconMaterial = new pc.StandardMaterial();
    iconMaterial.emissiveMap = texture;
    iconMaterial.emissive.set(1, 1, 1);
    iconMaterial.opacityMap = texture;
    iconMaterial.opacityMapChannel = 'a';
    iconMaterial.alphaTest = 0.45;
    iconMaterial.useLighting = false;
    iconMaterial.update();
    const icon = new pc.Entity('Mode pictogram');
    icon.addComponent('render', { type: 'plane', material: iconMaterial, castShadows: false });
    icon.setLocalPosition(0, 2.9, 0.49);
    icon.setLocalEulerAngles(90, 0, 0);
    icon.setLocalScale(0.86, 1, 0.86);
    arch.addChild(icon);
    resources.push(paintedWood, iconMaterial, texture, material);
    return material;
  });

  let time = 0;
  const animate = (dt: number) => {
    time = (time + dt) % (Math.PI * 20 / 1.6);
    for (const material of materials) material.setParameter('uTime', time);
  };
  app.on('update', animate);
  root.once('destroy', () => {
    app.off('update', animate);
    for (const resource of resources) resource.destroy();
  });
}

/** Mount the hub landmarks and set dressing using shared materials. */
export function mountCarnivalScenery(device: pc.GraphicsDevice, root: pc.Entity): void {
  const materials: pc.StandardMaterial[] = [];
  const paint = (hex: string) => {
    const material = new pc.StandardMaterial();
    material.diffuse.fromString(hex);
    material.update();
    materials.push(material);
    return material;
  };
  const piece = (
    parent: pc.Entity, name: string, type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus',
    material: pc.StandardMaterial, x: number, y: number, z: number,
    width: number, height: number, depth: number,
  ) => {
    const entity = new pc.Entity(name);
    entity.addComponent('render', { type, material });
    entity.setLocalPosition(x, y, z);
    entity.setLocalScale(width, height, depth);
    parent.addChild(entity);
    return entity;
  };

  const red = paint('#ce4542');
  const cream = paint('#ffe0a4');
  const gold = paint('#f5b629');
  const wood = paint('#ad5938');
  const green = paint('#70a347');
  const darkGreen = paint('#4e843d');
  const pink = paint('#ed8ab5');
  const blue = paint('#538fca');
  const skyBlue = paint('#aecfeb');
  const deckRed = paint('#dc6859');
  const deckBlue = paint('#5c8abf');
  const plank = paint('#eab479');
  const plankShade = paint('#dfaa72');
  const bulb = paint('#ffd48d');
  bulb.emissive.fromString('#ffc65a');
  bulb.emissiveIntensity = 0.5;
  bulb.update();

  // Cover the original medallion with the reference's blue rim, red field, and gold star.
  piece(root, 'Blue medallion rim', 'cylinder', deckBlue, 0, 0.027, 0, 7.05, 0.015, 7.05);
  piece(root, 'Red medallion field', 'cylinder', deckRed, 0, 0.038, 0, 5.76, 0.013, 5.76);
  const starMesh = new pc.Mesh(device);
  const starPositions = [0, 0.048, 0];
  const starNormals = [0, 1, 0];
  const starIndices: number[] = [];
  for (let index = 0; index < 10; index++) {
    const angle = Math.PI / 2 - index * Math.PI / 5;
    const radius = index % 2 === 0 ? 2.22 : 0.97;
    starPositions.push(Math.cos(angle) * radius, 0.048, Math.sin(angle) * radius);
    starNormals.push(0, 1, 0);
    starIndices.push(0, index + 1, (index + 1) % 10 + 1);
  }
  starMesh.setPositions(starPositions);
  starMesh.setNormals(starNormals);
  starMesh.setIndices(starIndices);
  starMesh.update();
  const star = new pc.Entity('Gold star inlay');
  star.addComponent('render', { meshInstances: [new pc.MeshInstance(starMesh, gold, star)], castShadows: false });
  root.addChild(star);

  const deckPositions: number[] = [];
  const deckNormals: number[] = [];
  const woodColors = [plank, plankShade, deckRed, deckBlue];
  const boards: number[][] = woodColors.map(() => []);
  const addBoard = (angle: number, nextAngle: number, inner: number, outer: number, color: number) => {
    const first = deckPositions.length / 3;
    for (const [a, radius] of [[angle, inner], [angle, outer], [nextAngle, outer], [nextAngle, inner]] as const) {
      deckPositions.push(Math.cos(a) * radius, 0.022, Math.sin(a) * radius);
      deckNormals.push(0, 1, 0);
    }
    boards[color]!.push(first, first + 2, first + 1, first, first + 3, first + 2);
  };
  for (let index = 0; index < 80; index++) {
    const angle = index * Math.PI / 40;
    const end = angle + Math.PI / 40 - 0.002;
    addBoard(angle, end, 3.45, 6.15, index % 5 === 0 ? 1 : 0);
    addBoard(angle, end, 6.17, 6.51, index % 20 < 4 ? 3 : 2);
  }
  const deckOverlay = new pc.Entity('Radial plaza decking');
  const boardMeshes = boards.map((indices, index) => {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(deckPositions);
    mesh.setNormals(deckNormals);
    mesh.setIndices(indices);
    mesh.update();
    return new pc.MeshInstance(mesh, woodColors[index]!, deckOverlay);
  });
  deckOverlay.addComponent('render', { meshInstances: boardMeshes, castShadows: false });
  root.addChild(deckOverlay);
  const cloud = paint('#fff4ea');
  cloud.useLighting = false;
  cloud.update();

  const booth = new pc.Entity('Wind-up booth');
  booth.setLocalPosition(PLAZA_BOOTH.x, 0, PLAZA_BOOTH.z);
  root.addChild(booth);
  piece(booth, 'Booth body', 'box', red, 0, 0.56, 0, PLAZA_BOOTH.width, 1.12, PLAZA_BOOTH.depth);
  piece(booth, 'Counter', 'box', gold, 0, 1.2, 1.26, 3.4, 0.16, 0.46);
  piece(booth, 'Booth back', 'box', wood, 0, 1.79, -1.16, 3.7, 1.12, 0.24);
  for (const side of [-1, 1]) {
    piece(booth, 'Canopy post', 'cylinder', red, side * 1.72, 1.77, 1.06, 0.22, 1.28, 0.22);
    piece(booth, 'Wind-up key loop', 'torus', gold, side * 0.43, 4.48, 0, 0.96, 0.6, 0.86)
      .setLocalEulerAngles(90, 0, 0);
    piece(booth, 'Announcement horn', 'cone', gold, side * 2.02, 2.05, 1.24, 0.63, 0.62, 0.63)
      .setLocalEulerAngles(0, 0, side * 90);
  }
  const roofPositions: number[] = [];
  const roofNormals: number[] = [];
  const roofIndices: number[] = [];
  for (let index = 0; index < 16; index += 2) {
    const point = (angle: number) => new pc.Vec3(Math.cos(angle) * 2.21, 2.44, Math.sin(angle) * 1.72);
    const first = index * Math.PI / 8;
    for (const offset of [0, Math.PI / 8]) {
      const a = point(first + offset);
      const b = point(first + offset + Math.PI / 8);
      const peak = new pc.Vec3(0, 3.86, 0);
      const normal = new pc.Vec3().cross(peak.clone().sub(a), b.clone().sub(a)).normalize();
      const start = roofPositions.length / 3;
      roofPositions.push(a.x, a.y, a.z, peak.x, peak.y, peak.z, b.x, b.y, b.z);
      roofNormals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
      roofIndices.push(start, start + 1, start + 2);
    }
  }
  const roofEntries = [];
  for (const [index, material] of [red, cream].entries()) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(roofPositions);
    mesh.setNormals(roofNormals);
    mesh.setIndices(roofIndices.filter((_, vertex) => Math.floor(vertex / 3) % 2 === index));
    mesh.update();
    roofEntries.push(new pc.MeshInstance(mesh, material, booth));
  }
  booth.addComponent('render', { meshInstances: roofEntries });
  piece(booth, 'Key bridge', 'box', gold, 0, 4.48, 0, 0.65, 0.18, 0.22);
  piece(booth, 'Marquee', 'box', red, 0, 2.36, 1.4, 3.7, 0.35, 0.32);
  for (let index = 0; index < 9; index++) {
    piece(booth, 'Marquee bulb', 'sphere', bulb, (index - 4) * 0.4, 2.36, 1.58, 0.16, 0.16, 0.12);
  }
  piece(booth, 'Wind-up key shaft', 'cylinder', gold, 0, 3.99, 0, 0.24, 0.73, 0.24);

  // Keep the furniture outside the routes from the star to each threshold.
  for (const side of [-1, 1]) {
    for (let flag = 0; flag < 6; flag++) {
      const fraction = (flag + 1) / 7;
      const x = side * (2.3 + fraction * 3.95);
      const y = 3.62 - Math.sin(fraction * Math.PI) * 0.32;
      piece(root, 'Bunting pennant', 'cone', [deckRed, gold, deckBlue][flag % 3]!, x, y, -8.6,
        0.30, 0.34, 0.055).setLocalEulerAngles(0, 0, 180);
    }
  }
  for (const [x, z] of PLAZA_PLANTERS) {
    piece(root, 'Planter', 'box', wood, x, 0.29, z, 1.28, 0.58, 1.06);
    piece(root, 'Planter rim', 'box', cream, x, 0.56, z, 1.39, 0.16, 1.17);
    for (const offset of [-0.35, 0, 0.35]) {
      piece(root, 'Topiary', 'sphere', offset === 0 ? green : darkGreen, x + offset, 0.78, z, 0.68, 0.67, 0.84);
      piece(root, 'Flower', 'sphere', gold, x + offset, 0.99 + 0.1 * Math.abs(offset), z + 0.33, 0.18, 0.18, 0.13);
    }
  }
  for (const x of [-PLAZA_RAIL_X, PLAZA_RAIL_X]) {
    for (const z of [-10, -6, -2, 2, 6]) {
      piece(root, 'Deck edge post', 'box', wood, x, 0.54, z, 0.34, 1.08, 0.34);
      piece(root, 'Deck edge post cap', 'box', gold, x, 1.1, z, 0.43, 0.19, 0.43);
      if (z < 6) piece(root, 'Deck edge rail', 'box', wood, x, 0.69, z + 2, 0.17, 0.16, 4);
    }
  }

  const wheelX = 11;
  const wheelY = 6.4;
  const wheelZ = -28;
  for (let section = 0; section < 24; section++) {
    const angle = (section + 0.5) * Math.PI / 12;
    piece(root, 'Ferris wheel rim', 'box', gold, wheelX + Math.cos(angle) * 3.63, wheelY + Math.sin(angle) * 3.63,
      wheelZ, 0.98, 0.16, 0.24).setLocalEulerAngles(0, 0, angle * pc.math.RAD_TO_DEG + 90);
  }
  for (let seat = 0; seat < 8; seat++) {
    const angle = seat * Math.PI / 4;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    piece(root, 'Ferris wheel spoke', 'box', cream, wheelX + x * 1.8, wheelY + y * 1.8, wheelZ, 3.6, 0.13, 0.13)
      .setLocalEulerAngles(0, 0, angle * pc.math.RAD_TO_DEG);
    piece(root, 'Ferris wheel gondola', 'box', seat % 2 ? pink : blue, wheelX + x * 3.65, wheelY + y * 3.65 - 0.2, wheelZ + 0.2, 1.0, 0.68, 0.69);
  }
  piece(root, 'Ferris wheel hub', 'sphere', red, wheelX, wheelY, wheelZ + 0.16, 1.54, 1.54, 0.58);
  for (const x of [-1.4, 1.4]) {
    piece(root, 'Ferris wheel support', 'box', blue, wheelX + x, 3.5, wheelZ - 0.24, 0.36, 8.6, 0.44)
      .setLocalEulerAngles(0, 0, Math.sign(x) * 18);
  }
  for (const [x, z] of [[-22, -31], [-17, -35], [22, -32], [27, -36]] as const) {
    piece(root, 'Toy rooftop house', 'box', cream, x, 1.1, z, 3.2, 4.3, 3.2);
    piece(root, 'Toy rooftop', 'cone', skyBlue, x, 4.0, z, 4.7, 2.6, 4.7);
  }

  for (const x of [-16, -11, -7, 7, 11, 16]) {
    const z = -16 - Math.abs(x) * 0.35;
    piece(root, 'Distant toy tree trunk', 'cylinder', wood, x, -0.65, z, 0.55, 3.4, 0.55);
    piece(root, 'Distant toy tree crown', 'sphere', x % 2 ? green : darkGreen, x, 1.7, z, 3.6, 4.7, 3.6);
  }
  for (const [x, y, z] of [[-21, 12, -34], [-6, 15, -41], [16, 11, -36], [25, 16, -44]]) {
    piece(root, 'Cloud body', 'sphere', cloud, x!, y! - 3, z!, 8, 2.4, 2);
    piece(root, 'Cloud crest', 'sphere', cloud, x! - 1, y! - 2.1, z!, 3.8, 2.6, 2.2);
  }
  piece(root, 'Balloon envelope', 'sphere', pink, -10, 9, -26, 2.6, 3.4, 2.6);
  piece(root, 'Balloon basket', 'box', wood, -10, 6.9, -26, 0.66, 0.55, 0.66);

  root.once('destroy', () => {
    for (const material of materials) material.destroy();
  });
}
