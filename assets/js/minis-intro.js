'use strict';
// ============================================================
//  🪐 SEGA SATURN INTRO — FIXED shatter (proper world-space baking)
// ============================================================
(function(){
  const intro = document.getElementById("saturnIntro");
  const introCanvas = document.getElementById("introCanvas");
  const audio = document.getElementById("saturnBoot");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const cam = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 1000);
  cam.position.z = 14;

  const r = new THREE.WebGLRenderer({ canvas: introCanvas, antialias: true });
  r.setSize(innerWidth, innerHeight);
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setClearColor(0x000000, 1);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const keyL = new THREE.DirectionalLight(0xffffff, 1.5);
  keyL.position.set(5, 8, 10);
  scene.add(keyL);
  const rimL = new THREE.PointLight(0x66ccff, 2, 30);
  rimL.position.set(0, 0, 8);
  scene.add(rimL);

  const flashEl = document.createElement('div');
  flashEl.style.cssText = `position:fixed;inset:0;z-index:2;background:#fff;opacity:0;pointer-events:none;`;
  intro.appendChild(flashEl);

  const textEl = document.createElement('div');
  textEl.style.cssText = `
    position:fixed;left:0;right:0;bottom:18%;z-index:3;text-align:center;
    font-family:'Courier New',monospace;color:#fff;pointer-events:none;
    opacity:0;transform:translateY(20px);transition:opacity .6s ease, transform .6s ease;
    text-shadow:0 0 20px #66ccff, 0 0 40px #0066ff;
  `;
  textEl.innerHTML = `
    <div style="font-size:clamp(2rem,6vw,4rem);letter-spacing:.4em;font-weight:bold;color:#e8f4ff;">
      EGORNETWORK
    </div>
    <div style="font-size:clamp(.8rem,2vw,1.2rem);letter-spacing:.6em;color:#88ccff;margin-top:8px;">
      ENTERTAINMENT SYSTEM
    </div>
    <div style="font-size:.7rem;letter-spacing:.3em;color:#4488aa;margin-top:18px;opacity:.7;">
      PRODUCED BY EGORNETWORK 1995
    </div>
  `;
  intro.appendChild(textEl);

  const scanEl = document.createElement('div');
  scanEl.style.cssText = `
    position:fixed;inset:0;z-index:4;pointer-events:none;
    background:repeating-linear-gradient(to bottom,transparent 0,transparent 2px,rgba(0,0,0,.25) 2px,rgba(0,0,0,.25) 4px);
    opacity:.6;
  `;
  intro.appendChild(scanEl);

  let introEnding = false;
  let fragments = [];
  let assemblyStartTime = 0;
  const ASSEMBLY_DURATION = 3400;
  const FLASH_AT = 3300;
  const TEXT_AT = 3600;
  const TOTAL_DURATION = 5200;
  const CLUSTER_COUNT = 22;

  const sparksGeo = new THREE.BufferGeometry();
  const SPARK_COUNT = 200;
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkVelocities = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    sparkPositions[i*3] = 0; sparkPositions[i*3+1] = 0; sparkPositions[i*3+2] = -999;
    sparkVelocities.push({ vx:0, vy:0, vz:0, life:0 });
  }
  sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparksMat = new THREE.PointsMaterial({
    color: 0x88ddff, size: 0.12, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const sparks = new THREE.Points(sparksGeo, sparksMat);
  scene.add(sparks);

  // ============================================================
  //  🔪 ИСПРАВЛЕННЫЙ ШРЕДДЕР: всё в мировых координатах
  // ============================================================
  function shatterMesh(sourceMesh, clusterCount) {
    const geo = sourceMesh.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;

    // Мировая матрица меша + normalMatrix для корректного вращения нормалей
    const worldMatrix = sourceMesh.matrixWorld.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);

    // 1. Собираем треугольники СРАЗУ В МИРОВЫХ КООРДИНАТАХ
    const tris = [];
    const centers = [];
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
    const tmpN = new THREE.Vector3();

    for (let t = 0; t < triCount; t++) {
      let i0, i1, i2;
      if (idx) {
        i0 = idx.getX(t*3); i1 = idx.getX(t*3+1); i2 = idx.getX(t*3+2);
      } else {
        i0 = t*3; i1 = t*3+1; i2 = t*3+2;
      }
      // Локальные → мировые
      tmpA.fromBufferAttribute(pos, i0).applyMatrix4(worldMatrix);
      tmpB.fromBufferAttribute(pos, i1).applyMatrix4(worldMatrix);
      tmpC.fromBufferAttribute(pos, i2).applyMatrix4(worldMatrix);

      const a = tmpA.clone(), b = tmpB.clone(), c = tmpC.clone();

      // Нормали (только вращение, без scale/translate)
      let na = null, nb = null, nc = null;
      if (nrm) {
        na = tmpN.fromBufferAttribute(nrm, i0).applyMatrix3(normalMatrix).normalize().clone();
        nb = tmpN.fromBufferAttribute(nrm, i1).applyMatrix3(normalMatrix).normalize().clone();
        nc = tmpN.fromBufferAttribute(nrm, i2).applyMatrix3(normalMatrix).normalize().clone();
      }

      tris.push({ a, b, c, na, nb, nc });
      centers.push([
        (a.x + b.x + c.x) / 3,
        (a.y + b.y + c.y) / 3,
        (a.z + b.z + c.z) / 3,
      ]);
    }

    // 2. K-means
    const k = Math.min(clusterCount, triCount);
    const centroids = [];
    const used = new Set();
    while (centroids.length < k) {
      const rr = Math.floor(Math.random() * triCount);
      if (!used.has(rr)) { used.add(rr); centroids.push([...centers[rr]]); }
    }

    const assignments = new Array(triCount).fill(0);
    for (let iter = 0; iter < 15; iter++) {
      for (let t = 0; t < triCount; t++) {
        let best = 0, bestD = Infinity;
        const cc = centers[t];
        for (let i = 0; i < k; i++) {
          const dx = cc[0]-centroids[i][0], dy = cc[1]-centroids[i][1], dz = cc[2]-centroids[i][2];
          const d = dx*dx + dy*dy + dz*dz;
          if (d < bestD) { bestD = d; best = i; }
        }
        assignments[t] = best;
      }
      const sums = centroids.map(() => [0,0,0,0]);
      for (let t = 0; t < triCount; t++) {
        const a = assignments[t];
        sums[a][0] += centers[t][0]; sums[a][1] += centers[t][1];
        sums[a][2] += centers[t][2]; sums[a][3] += 1;
      }
      for (let i = 0; i < k; i++) {
        if (sums[i][3] > 0) {
          centroids[i][0] = sums[i][0] / sums[i][3];
          centroids[i][1] = sums[i][1] / sums[i][3];
          centroids[i][2] = sums[i][2] / sums[i][3];
        }
      }
    }

    // 3. Группируем
    const groups = Array.from({length: k}, () => []);
    for (let t = 0; t < triCount; t++) groups[assignments[t]].push(tris[t]);

    // 4. Создаём shard-меши (ПОЛНОСТЬЮ В МИРОВЫХ КООРДИНАТАХ)
    const shards = [];
    const srcMat = sourceMesh.material;

    for (let g = 0; g < k; g++) {
      if (groups[g].length === 0) continue;
      const newGeo = new THREE.BufferGeometry();
      const newPositions = [];
      const newNormals = [];
      const pivot = new THREE.Vector3(centroids[g][0], centroids[g][1], centroids[g][2]);

      for (const tri of groups[g]) {
        // Смещаем мировые вершины относительно pivot
        newPositions.push(
          tri.a.x - pivot.x, tri.a.y - pivot.y, tri.a.z - pivot.z,
          tri.b.x - pivot.x, tri.b.y - pivot.y, tri.b.z - pivot.z,
          tri.c.x - pivot.x, tri.c.y - pivot.y, tri.c.z - pivot.z
        );
        if (tri.na) {
          newNormals.push(
            tri.na.x, tri.na.y, tri.na.z,
            tri.nb.x, tri.nb.y, tri.nb.z,
            tri.nc.x, tri.nc.y, tri.nc.z
          );
        }
      }

      newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      if (newNormals.length) newGeo.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
      newGeo.computeBoundingSphere();

      const mat = srcMat.clone();
      mat.side = THREE.DoubleSide;
      mat.emissive = new THREE.Color(0x66ccff);
      mat.emissiveIntensity = 0.5;
      mat.transparent = true;
      mat.opacity = 1;

      const shardMesh = new THREE.Mesh(newGeo, mat);
      // ✅ Позиция в мировых координатах = pivot
      shardMesh.position.copy(pivot);
      // ✅ Вращение НОЛЬ — всё уже запечено в вершины!
      shardMesh.rotation.set(0, 0, 0);

      shards.push(shardMesh);
    }
    return shards;
  }

  const loader = new THREE.GLTFLoader();
  loader.load(
    "assets/models/EgorNetwork.glb",
    function(gltf){
      const logo = gltf.scene;
      logo.scale.set(1, 1, 1);
      logo.position.set(0, 0, 0);
      // Поворот "лицом к камере" — будет запечён в вершины shards
      logo.rotation.set(Math.PI / 2, 0, 0);
      scene.add(logo);

      // ОБЯЗАТЕЛЬНО: обновляем мировые матрицы ВСЕЙ иерархии ПЕРЕД shatter
      logo.updateMatrixWorld(true);

      const meshesToProcess = [];
      logo.traverse(obj => { if (obj.isMesh) meshesToProcess.push(obj); });

      // Делаем shatter для каждого меша
      const shardsGroup = new THREE.Group();
      scene.add(shardsGroup);

      for (const m of meshesToProcess) {
        m.updateMatrixWorld(true);
        const shards = shatterMesh(m, CLUSTER_COUNT);
        for (const s of shards) {
          // ✅ Целевая позиция = текущая мировая позиция shard (уже правильная)
          s.userData.targetPos = s.position.clone();
          // ✅ Целевое вращение = (0,0,0), потому что вершины уже повёрнуты правильно
          s.userData.targetRot = new THREE.Euler(0, 0, 0);

          // Случайная стартовая позиция далеко
          const radius = 28 + Math.random() * 18;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          s.userData.startPos = new THREE.Vector3(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta),
            radius * Math.cos(phi) - 10
          );
          s.userData.startRot = new THREE.Euler(
            (Math.random() - 0.5) * Math.PI * 4,
            (Math.random() - 0.5) * Math.PI * 4,
            (Math.random() - 0.5) * Math.PI * 4
          );
          s.userData.delay = Math.random() * 250;

          // Ставим в начальную позицию для анимации
          s.position.copy(s.userData.startPos);
          s.rotation.copy(s.userData.startRot);
          shardsGroup.add(s);
          fragments.push(s);
        }
      }

      // Убираем оригинальный logo (мы его уже разбили на shards)
      scene.remove(logo);
      logo.traverse(o => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(mm => mm.dispose());
            else o.material.dispose();
          }
        }
      });

      assemblyStartTime = Date.now() + 400;
      audio.play().catch(()=>{});
      animate();
    },
    undefined,
    function(err){
      console.error('Model load error:', err);
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
      setTimeout(endSaturnIntro, 2000);
    }
  );

  function spawnSpark(x, y, z) {
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (sparkVelocities[i].life <= 0) {
        sparkPositions[i*3] = x + (Math.random()-0.5)*0.3;
        sparkPositions[i*3+1] = y + (Math.random()-0.5)*0.3;
        sparkPositions[i*3+2] = z + (Math.random()-0.5)*0.3;
        sparkVelocities[i].vx = (Math.random()-0.5) * 0.08;
        sparkVelocities[i].vy = (Math.random()-0.5) * 0.08;
        sparkVelocities[i].vz = (Math.random()-0.5) * 0.08;
        sparkVelocities[i].life = 0.8 + Math.random() * 0.4;
        break;
      }
    }
  }

  let flashTriggered = false, textTriggered = false, endTriggered = false;

  function animate(){
    if (introEnding) return;
    requestAnimationFrame(animate);

    const now = Date.now();
    const elapsed = now - assemblyStartTime;

    // Анимируем каждый shard
    for (const m of fragments) {
      const t = Math.max(0, elapsed - m.userData.delay);
      const p = Math.min(t / ASSEMBLY_DURATION, 1);
      if (p <= 0) continue;
      // ease-out-cubic
      const e = 1 - Math.pow(1 - p, 3);

      m.position.lerpVectors(m.userData.startPos, m.userData.targetPos, e);
      m.rotation.x = m.userData.startRot.x + (m.userData.targetRot.x - m.userData.startRot.x) * e;
      m.rotation.y = m.userData.startRot.y + (m.userData.targetRot.y - m.userData.startRot.y) * e;
      m.rotation.z = m.userData.startRot.z + (m.userData.targetRot.z - m.userData.startRot.z) * e;

      // Искры
      if (p > 0.05 && p < 0.95 && Math.random() < 0.4) {
        spawnSpark(m.position.x, m.position.y, m.position.z);
      }
    }

    // Частицы искр
    const posAttr = sparksGeo.attributes.position;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (sparkVelocities[i].life > 0) {
        sparkVelocities[i].life -= 0.03;
        posAttr.array[i*3]   += sparkVelocities[i].vx;
        posAttr.array[i*3+1] += sparkVelocities[i].vy;
        posAttr.array[i*3+2] += sparkVelocities[i].vz;
        sparkVelocities[i].vx *= 0.96;
        sparkVelocities[i].vy *= 0.96;
        sparkVelocities[i].vz *= 0.96;
      } else {
        posAttr.array[i*3+2] = -999;
      }
    }
    posAttr.needsUpdate = true;

    // ── ВСПЫШКА ──
    if (!flashTriggered && elapsed >= FLASH_AT) {
      flashTriggered = true;
      flashEl.style.transition = 'opacity .05s ease-out';
      flashEl.style.opacity = '1';
      rimL.intensity = 8; keyL.intensity = 4;
      setTimeout(() => {
        flashEl.style.transition = 'opacity .9s ease-in';
        flashEl.style.opacity = '0';
        rimL.intensity = 2; keyL.intensity = 1.5;
      }, 80);
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.6);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.start(); osc.stop(ctx.currentTime + 0.8);
      } catch(e){}
    }

    if (!textTriggered && elapsed >= TEXT_AT) {
      textTriggered = true;
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
    }

    if (elapsed >= TOTAL_DURATION - 200 && !endTriggered) {
      endTriggered = true;
      textEl.style.transition = 'opacity 1s ease';
      textEl.style.opacity = '0';
    }

    if (elapsed >= TOTAL_DURATION) { endSaturnIntro(); return; }

    r.render(scene, cam);
  }

  window.addEventListener('resize', () => {
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    r.setSize(innerWidth, innerHeight);
  });

  window.endSaturnIntro = function(){
    if (introEnding || !intro) return;
    introEnding = true;
    intro.classList.add('is-ending');
    intro.style.pointerEvents = 'none';
    setTimeout(() => intro.remove(), 600);
  };
})();
