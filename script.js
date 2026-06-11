const canvas = document.querySelector("#terrain");
const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
const portal = document.querySelector("#portal");
const loginTrigger = document.querySelector("#loginTrigger");
const loginPanel = document.querySelector("#loginPanel");
const loginBackdrop = document.querySelector("#loginBackdrop");
const closeLogin = document.querySelector("#closeLogin");
const loginForm = document.querySelector("#loginForm");
const loginFeedback = document.querySelector("#loginFeedback");
const accountInput = document.querySelector("#account");
const passwordInput = document.querySelector("#password");
const captchaInput = document.querySelector("#captchaInput");
const captchaImage = document.querySelector("#captchaImage");
const captchaCanvas = document.querySelector("#captchaCanvas");
const rememberPassword = document.querySelector("#rememberPassword");
const forgotPassword = document.querySelector("#forgotPassword");
const clock = document.querySelector("#clock");
let captchaCode = "";

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local file URLs may block storage access; login still works without persistence.
  }
}

const BLUE = [48, 111, 255];
const TAU = Math.PI * 2;
const SCENE_SCALE = 1.2;
const CAMERA_FOCAL_LENGTH = 50;
const CAMERA_SENSOR_WIDTH = 36;
const CAMERA_DISTANCE = 3.8;
let width = 0;
let height = 0;
let pixelRatio = 1;
let particles = [];
let pointer = { x: 0.65, y: 0.45 };

const quality = {
  segments: 84,
  trailLayers: 4,
};

// x/z are world-space coordinates. Rotation changes z, which drives scale and focus.
const islands = [
  {
    x: -0.72, z: -0.24, y: 0, rx: 0.2, ry: 0.18, layers: 12, peak: 0.68,
    phase: 0.4, beacon: true, stretch: 0.92, lobes: 4, roughness: 0.06, shapeAngle: -0.18,
    location: { lng: "104.0618° E", lat: "30.6712° N", altitude: "582 M" },
  },
  {
    x: -0.02, z: 0.62, y: 0, rx: 0.2, ry: 0.105, layers: 6, peak: 0.3,
    phase: 2.2, beacon: true, stretch: 1.55, lobes: 3, roughness: 0.13, shapeAngle: 0.28,
    location: { lng: "104.0594° E", lat: "30.6685° N", altitude: "518 M" },
  },
  {
    x: 0.76, z: -0.18, y: 0, rx: 0.27, ry: 0.21, layers: 9, peak: 0.48,
    phase: 4.1, beacon: true, stretch: 1.12, lobes: 6, roughness: 0.1, shapeAngle: 0.1,
    location: { lng: "104.0641° E", lat: "30.6703° N", altitude: "546 M" },
  },
];

const sceneCenter = islands.reduce(
  (center, island) => ({
    x: center.x + island.x / islands.length,
    z: center.z + island.z / islands.length,
  }),
  { x: 0, z: 0 },
);

const movers = [
  { radiusX: 0.84, radiusZ: 0.65, speed: 0.000035, phase: 0, y: 0.27, altitudeRange: 0.16, altitudeSpeed: 1.7, size: 1, route: 0 },
  { radiusX: 0.52, radiusZ: 0.82, speed: -0.000026, phase: 2.1, y: 0.42, altitudeRange: 0.12, altitudeSpeed: 2.15, size: 0.72, route: 1 },
  { radiusX: 1.03, radiusZ: 0.38, speed: 0.000021, phase: 4.25, y: 0.14, altitudeRange: 0.1, altitudeSpeed: 1.35, size: 0.82, route: 2 },
];

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const screenPixels = width * height;
  pixelRatio = Math.min(window.devicePixelRatio || 1, screenPixels > 1600000 ? 1 : 1.25);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  particles = Array.from({ length: Math.min(130, Math.floor((width * height) / 10500)) }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random(),
    speed: 0.04 + Math.random() * 0.11,
    alpha: 0.04 + Math.random() * 0.2,
  }));
}

function projectWorld(x, z, y, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centeredX = x - sceneCenter.x;
  const centeredZ = z - sceneCenter.z;
  const rotatedX = centeredX * cos - centeredZ * sin;
  const rotatedZ = centeredX * sin + centeredZ * cos;
  const focalPixels = width * (CAMERA_FOCAL_LENGTH / CAMERA_SENSOR_WIDTH);
  const pointDistance = Math.max(1.8, CAMERA_DISTANCE - rotatedZ);
  const perspective = focalPixels / pointDistance;
  const basePerspective = focalPixels / CAMERA_DISTANCE;
  const depthScale = perspective / basePerspective;
  const farDepth = Math.max(0, -rotatedZ);
  const focusStart = 0.28;
  const focusEnd = 1.12;
  const focusProgress = Math.max(0, Math.min(1, (farDepth - focusStart) / (focusEnd - focusStart)));
  const smoothFocus = focusProgress * focusProgress * (3 - 2 * focusProgress);
  const blur = smoothFocus * 3;

  return {
    x: width * 0.52 + rotatedX * perspective * SCENE_SCALE,
    y: height * 0.52 + (rotatedZ * 0.46 - y * 0.34) * perspective * SCENE_SCALE,
    z: rotatedZ,
    scale: depthScale,
    blur,
    alpha: 1 - smoothFocus * 0.28,
  };
}

function islandState(island, rotation) {
  return { ...projectWorld(island.x, island.z, island.y, rotation), island };
}

function terrainPath(state, layer, time, rotation) {
  const { island } = state;
  const path = new Path2D();
  const inset = layer / island.layers;
  const radiusX = island.rx * island.stretch * (1 - inset * 0.78);
  const radiusZ = island.ry * 1.85 * (1 - inset * 0.72);
  const lift = inset * island.peak;
  const segments = quality.segments;
  const shapeRotation = island.phase * 0.08 + island.shapeAngle;

  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * TAU;
    const rotatedAngle = angle + shapeRotation;
    const organic =
      1 +
      Math.sin(angle * island.lobes + island.phase + layer * 0.25) * island.roughness +
      Math.cos(angle * (island.lobes + 2) - island.phase * 1.5) * island.roughness * 0.55 +
      Math.sin(angle * 9 + time * 0.00012) * 0.01;
    const worldX = island.x + Math.cos(rotatedAngle) * radiusX * organic;
    const worldZ = island.z + Math.sin(rotatedAngle) * radiusZ * organic;
    const worldY = island.y + lift + Math.cos(angle * 2 + island.phase) * 0.007;
    const point = projectWorld(worldX, worldZ, worldY, rotation);

    if (i === 0) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
  }
  path.closePath();
  return path;
}

function setDepthStyle(state, extraBlur = 0) {
  ctx.globalAlpha = state.alpha;
  const blur = Math.max(0, state.blur + extraBlur);
  ctx.filter = blur >= 0.15 ? `blur(${blur.toFixed(1)}px)` : "none";
}

function drawFog(states, time) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  states.forEach((state, index) => {
    const wobble = Math.sin(time * 0.00022 + index * 2) * width * 0.018;
    const radius = state.island.rx * width * 1.4 * state.scale;
    const gradient = ctx.createRadialGradient(state.x + wobble, state.y, 0, state.x, state.y, radius);
    const alpha = 0.13 * state.alpha;
    gradient.addColorStop(0, `rgba(${BLUE.join(",")}, ${alpha})`);
    gradient.addColorStop(0.3, `rgba(${BLUE.join(",")}, ${alpha * 0.22})`);
    gradient.addColorStop(1, `rgba(${BLUE.join(",")}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  });
  ctx.restore();
}

function drawFlowTrail(path, state, depth, islandIndex, layer, time) {
  const segmentLength = Math.max(34, width * 0.052);
  const gapLength = Math.max(210, width * 0.31);
  const baseOffset = -(time * (0.026 + islandIndex * 0.006) + layer * 31);
  const tailLayers = quality.trailLayers;

  for (let tail = tailLayers - 1; tail >= 0; tail -= 1) {
    const progress = tail / (tailLayers - 1);
    ctx.save();
    setDepthStyle(state, state.z > 0.62 ? 1 : 0);
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = `rgba(${BLUE.join(",")}, ${(0.12 + (1 - progress) * 0.72) * state.alpha})`;
    ctx.lineWidth = 1.35 + (1 - progress) * (1.5 + depth);
    ctx.setLineDash([segmentLength * (0.7 + (1 - progress) * 0.35), gapLength]);
    ctx.lineDashOffset = baseOffset + tail * segmentLength * 0.66;
    ctx.shadowBlur = 3 + (1 - progress) * 9;
    ctx.shadowColor = `rgba(${BLUE.join(",")}, ${0.25 + (1 - progress) * 0.65})`;
    ctx.stroke(path);
    ctx.restore();
  }
}

function drawIslands(states, time, rotation) {
  [...states]
    .sort((a, b) => a.z - b.z)
    .forEach((state, islandIndex) => {
      for (let layer = 0; layer < state.island.layers; layer += 1) {
        const path = terrainPath(state, layer, time, rotation);
        const depth = layer / state.island.layers;

        ctx.save();
        setDepthStyle(state);
        ctx.strokeStyle = `rgba(170, 193, 240, ${0.24 + depth * 0.22})`;
        ctx.lineWidth = 0.72 + depth * 0.42;
        ctx.shadowBlur = 0;
        ctx.stroke(path);
        ctx.restore();

        if ((layer + islandIndex) % 3 === 0) {
          drawFlowTrail(path, state, depth, islandIndex, layer, time);
        }
      }
    });
}

function drawRing(x, y, rx, ry, alpha = 0.8) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.strokeStyle = `rgba(207, 221, 255, ${alpha})`;
  ctx.lineWidth = 0.8;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(48, 111, 255, .75)";
  ctx.stroke();
}

function drawBeaconLabel(state, x, y) {
  const data = state.island.location;
  if (!data) return;

  const scale = Math.max(0.82, Math.min(1.12, state.scale));
  const lineStart = x + 22 * scale;
  const lineEnd = lineStart + 24 * scale;
  const textX = lineEnd + 7;

  ctx.save();
  ctx.globalAlpha = state.alpha * 0.78;
  ctx.filter = state.blur >= 0.15 ? `blur(${state.blur.toFixed(1)}px)` : "none";
  ctx.globalCompositeOperation = "screen";

  ctx.beginPath();
  ctx.moveTo(lineStart, y);
  ctx.lineTo(lineEnd, y);
  ctx.strokeStyle = "rgba(130, 169, 255, .55)";
  ctx.lineWidth = 0.65;
  ctx.stroke();

  ctx.fillStyle = "rgba(188, 208, 255, .72)";
  ctx.font = `${Math.round(8 * scale)}px "Barlow Condensed", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`LNG  ${data.lng}`, textX, y - 9 * scale);
  ctx.fillText(`LAT   ${data.lat}`, textX, y);
  ctx.fillText(`ALT   ${data.altitude}`, textX, y + 9 * scale);
  ctx.restore();
}

function drawBeacon(state, time) {
  if (!state.island.beacon) return;
  const summit = projectWorld(state.island.x, state.island.z, state.island.y + state.island.peak, time * 0.000012);
  const baseY = summit.y;
  const poleHeight = (40 + state.scale * 18) * state.scale;
  const ringY = baseY - poleHeight;
  const pulse = 1 + Math.sin(time * 0.002 + state.island.phase) * 0.1;

  ctx.save();
  setDepthStyle(state);
  ctx.globalCompositeOperation = "screen";
  ctx.beginPath();
  ctx.moveTo(summit.x, baseY);
  ctx.lineTo(summit.x, ringY);
  ctx.strokeStyle = "rgba(213, 225, 255, .72)";
  ctx.lineWidth = 0.8;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(48, 111, 255, .8)";
  ctx.stroke();
  drawRing(summit.x, ringY, 19 * state.scale * pulse, 6 * state.scale * pulse);

  ctx.beginPath();
  ctx.moveTo(summit.x, ringY);
  ctx.lineTo(summit.x + 22 * state.scale, ringY - 1);
  ctx.strokeStyle = "rgba(48, 111, 255, .5)";
  ctx.stroke();
  ctx.restore();

  drawBeaconLabel(state, summit.x, ringY);
}

function moverPosition(mover, time, rotation) {
  const phase = time * mover.speed + mover.phase;
  const x = Math.cos(phase) * mover.radiusX;
  const z = Math.sin(phase) * mover.radiusZ;
  const altitude = mover.y + Math.sin(phase * mover.altitudeSpeed + mover.phase) * mover.altitudeRange;
  return {
    ...projectWorld(x, z, altitude, rotation),
    phase,
    mover,
    ground: projectWorld(x, z, 0, rotation),
  };
}

function drawMoverAndRoutes(mover, states, time, rotation, cachedPosition) {
  const drone = cachedPosition || moverPosition(mover, time, rotation);
  const beaconStates = states.filter((state) => state.island.beacon);
  const routeTargets = mover.route === 1 ? states.slice(0, 2) : mover.route === 2 ? states.slice(1) : beaconStates;

  ctx.save();
  setDepthStyle(drone, drone.z > 0.5 ? 1.2 : 0);
  ctx.globalCompositeOperation = "screen";
  routeTargets.forEach((state, index) => {
    const summit = projectWorld(state.island.x, state.island.z, state.island.y + state.island.peak, rotation);
    const peakY = summit.y - (state.island.beacon ? 28 : 0);
    ctx.beginPath();
    ctx.moveTo(drone.x, drone.y);
    ctx.lineTo(summit.x, peakY);
    ctx.setLineDash(mover.route === 2 ? [2, 8] : [3, 5]);
    ctx.lineDashOffset = -(time * (0.018 + mover.size * 0.009) + index * 8);
    ctx.strokeStyle = `rgba(168, 194, 255, ${0.36 * Math.min(drone.alpha, state.alpha)})`;
    ctx.lineWidth = 0.65;
    ctx.stroke();
  });

  ctx.setLineDash([]);
  const bodyScale = drone.scale * 0.9 * mover.size;
  ctx.beginPath();
  ctx.moveTo(drone.x - 8 * bodyScale, drone.y);
  ctx.lineTo(drone.x + 8 * bodyScale, drone.y);
  ctx.moveTo(drone.x, drone.y - 4 * bodyScale);
  ctx.lineTo(drone.x, drone.y + 7 * bodyScale);
  ctx.strokeStyle = "rgba(228, 236, 255, .78)";
  ctx.lineWidth = 1;
  ctx.shadowBlur = 11;
  ctx.shadowColor = "rgba(48, 111, 255, .95)";
  ctx.stroke();
  drawRing(drone.x, drone.y, 15 * bodyScale, 5 * bodyScale, 0.58);

  const ground = drone.ground;
  const groundRingScale = Math.max(0.55, ground.scale * mover.size);
  ctx.beginPath();
  ctx.moveTo(drone.x, drone.y + 6 * bodyScale);
  ctx.lineTo(ground.x, ground.y);
  ctx.strokeStyle = "rgba(168, 194, 255, .38)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  drawRing(ground.x, ground.y, 7 * groundRingScale, 2.3 * groundRingScale, 0.38);
  ctx.restore();
}

function drawMovers(states, time, rotation) {
  movers
    .map((mover) => ({ mover, position: moverPosition(mover, time, rotation) }))
    .sort((a, b) => a.position.z - b.position.z)
    .forEach(({ mover, position }) => drawMoverAndRoutes(mover, states, time, rotation, position));
}

function drawParticles(time) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  particles.forEach((point, index) => {
    point.x += point.speed;
    point.y += Math.sin(time * 0.0004 + index) * 0.025;
    if (point.x > width + 5) point.x = -5;
    const twinkle = 0.5 + Math.sin(time * 0.0016 + index * 1.9) * 0.5;
    ctx.fillStyle = `rgba(${index % 13 === 0 ? BLUE.join(",") : "174, 196, 235"}, ${point.alpha * twinkle})`;
    ctx.fillRect(point.x, point.y, point.z * 1.4 + 0.3, point.z * 1.4 + 0.3);
  });
  ctx.restore();
}

function drawPointerGlow() {
  const gradient = ctx.createRadialGradient(pointer.x * width, pointer.y * height, 0, pointer.x * width, pointer.y * height, width * 0.16);
  gradient.addColorStop(0, "rgba(48, 111, 255, .045)");
  gradient.addColorStop(1, "rgba(48, 111, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function animate(time = 0) {
  ctx.clearRect(0, 0, width, height);
  const rotation = time * 0.000012;
  const states = islands.map((island) => islandState(island, rotation));
  drawFog(states, time);
  drawIslands(states, time, rotation);
  states.forEach((state) => drawBeacon(state, time));
  drawMovers(states, time, rotation);
  drawParticles(time);
  drawPointerGlow();
  requestAnimationFrame(animate);
}

function setPanel(open) {
  portal.classList.toggle("login-open", open);
  loginBackdrop.setAttribute("aria-hidden", String(!open));
  if (open) {
    drawCaptcha();
    window.setTimeout(() => accountInput.focus(), 350);
  }
  else loginTrigger.focus();
}

loginTrigger.addEventListener("click", () => setPanel(true));
closeLogin.addEventListener("click", () => setPanel(false));
loginBackdrop.addEventListener("click", (event) => {
  if (event.target === loginBackdrop) setPanel(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setPanel(false);
});

function drawCaptcha() {
  const captchaCtx = captchaCanvas.getContext("2d");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  captchaCode = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  captchaCtx.clearRect(0, 0, captchaCanvas.width, captchaCanvas.height);
  captchaCtx.fillStyle = "#eef2f5";
  captchaCtx.fillRect(0, 0, captchaCanvas.width, captchaCanvas.height);

  for (let i = 0; i < 5; i += 1) {
    captchaCtx.beginPath();
    captchaCtx.moveTo(Math.random() * 150, Math.random() * 44);
    captchaCtx.lineTo(Math.random() * 150, Math.random() * 44);
    captchaCtx.strokeStyle = `hsla(${Math.random() * 360}, 65%, 42%, .45)`;
    captchaCtx.lineWidth = 1;
    captchaCtx.stroke();
  }

  [...captchaCode].forEach((char, index) => {
    captchaCtx.save();
    captchaCtx.translate(22 + index * 34, 29 + Math.random() * 4);
    captchaCtx.rotate((Math.random() - 0.5) * 0.36);
    captchaCtx.fillStyle = `hsl(${Math.random() * 360}, 68%, 38%)`;
    captchaCtx.font = `600 ${24 + Math.random() * 4}px sans-serif`;
    captchaCtx.fillText(char, 0, 0);
    captchaCtx.restore();
  });
  captchaInput.value = "";
}

captchaImage.addEventListener("click", drawCaptcha);
captchaInput.addEventListener("input", () => {
  captchaInput.value = captchaInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4);
});

forgotPassword.addEventListener("click", () => {
  loginFeedback.textContent = "请联系平台管理员重置密码";
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!accountInput.value || !passwordInput.value) {
    loginFeedback.textContent = "请输入账号和密码";
    return;
  }
  if (captchaInput.value.toUpperCase() !== captchaCode) {
    loginFeedback.textContent = "图片验证码不正确，请重新输入";
    drawCaptcha();
    captchaInput.focus();
    return;
  }
  if (rememberPassword.checked) {
    storageSet("rememberedLogin", JSON.stringify({ account: accountInput.value, password: passwordInput.value }));
  } else {
    storageRemove("rememberedLogin");
  }
  loginFeedback.textContent = "正在验证账号登录信息…";
});

try {
  const rememberedLogin = JSON.parse(storageGet("rememberedLogin"));
  if (rememberedLogin?.account && rememberedLogin?.password) {
    accountInput.value = rememberedLogin.account;
    passwordInput.value = rememberedLogin.password;
    rememberPassword.checked = true;
  }
} catch {
  storageRemove("rememberedLogin");
}

document.addEventListener("pointermove", (event) => {
  pointer = { x: event.clientX / width, y: event.clientY / height };
});

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

window.addEventListener("resize", resize);
resize();
updateClock();
window.setInterval(updateClock, 1000);
requestAnimationFrame(animate);
