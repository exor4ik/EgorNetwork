    import * as THREE from '../vendor/three/three.module.js';
    import { PointerLockControls } from '../vendor/three/PointerLockControls.js';

    const menu = document.getElementById('menu');
    const startBtn = document.getElementById('startBtn');
    const helpBtn = document.getElementById('helpBtn');
    const archiveBtn = document.getElementById('archiveBtn');
    const helpPanel = document.getElementById('helpPanel');
    const archivePanel = document.getElementById('archivePanel');

    const hud = document.getElementById('hud');
    const message = document.getElementById('message');
    const timestampEl = document.getElementById('timestamp');

    const vhsModeEl = document.getElementById('vhsMode');
    const vhsTapeEl = document.getElementById('vhsTape');
    const btnPlay = document.getElementById('btnPlay');
    const btnPause = document.getElementById('btnPause');
    const btnStop = document.getElementById('btnStop');
    const btnRew = document.getElementById('btnRew');
    const btnFF = document.getElementById('btnFF');
    const btnEject = document.getElementById('btnEject');

    const blackout = document.getElementById('blackout');
    const blackoutText = document.getElementById('blackoutText');
    const rewindOverlay = document.getElementById('rewindOverlay');
    const glitchOverlay = document.getElementById('glitchOverlay');
    const noiseCanvas = document.getElementById('noiseCanvas');
    const noiseCtx = noiseCanvas.getContext('2d');
    const scanlinesEl = document.getElementById('scanlines');

    let scene, camera, renderer, controls, clock;
    let moveForward = false;
    let moveBackward = false;
    let moveLeft = false;
    let moveRight = false;
    let sprint = false;

    let flashlight;
    let flashlightOn = true;
    let flashBase = 90;
    let flashOffUntil = -1;
    let redLight;
    let exitSign = null;

    let wallColliders = [];
    let lights = [];
    let dust;
    let apparition;
    let apparitionParts = null;
    let apparitionTimer = 0;
    let breathTimer = 0;
    let knockedEnd = false;
    let crawler = null;
    let crawlerState = null;
    let dripTimer = 8;

    let eventTimer = 4;
    let messageTimeout = null;
    let glitchTimeout = null;
    let cameraGlitch = 0;

    let audioCtx = null;
    let masterGain = null;
    let humGain = null;
    let stepSide = 1;
    let humTimer = 0;

    let fakeTime = new Date(1997, 2, 14, 2, 47, 13);

    let loop = 0;
    let velocity = new THREE.Vector3();
    let headBobTime = 0;
    let stepTimer = 0;

    let currentVhsMode = 'STOP';
    let unlockMode = 'PAUSE';
    let tapeSeconds = 0;
    let lastTapeTick = -1;

    let history = [];
    let historyTimer = 0;
    const HISTORY_INTERVAL = 0.05;
    const MAX_HISTORY = 850;

    const rewind = {
      active: false,
      time: 0,
      duration: 1.0,
      targetIndex: -1,
      fromPos: new THREE.Vector3(),
      fromQuat: new THREE.Quaternion(),
      toPos: new THREE.Vector3(),
      toQuat: new THREE.Quaternion()
    };

    const falseEnd = {
      active: false,
      time: 0,
      phase: 0
    };

    let rewindCooldown = 0;
    let ffCooldown = 0;
    let endCooldown = 0;

    const CELL_SIZE = 4;
    const WALL_HEIGHT = 3;
    const WALL_THICKNESS = 0.25;
    const PLAYER_RADIUS = 0.35;

    const DIRS = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ];

    let cells = [];
    let cellMap = new Map();
    let turnIndices = [];
    let firstDir = 0;
    let endDir = 0;

    let startPos = new THREE.Vector3();
    let startLook = new THREE.Vector3();
    let endTarget = new THREE.Vector3();

    const tempObject = new THREE.Object3D();

    let pipeMat = null;
    let pipeGeoBig = null;
    let pipeGeoSmall = null;
    let fixtureMat = null;
    let frameMat = null;
    let doorTexture = null;

    const PIPE_LAT = 1.78;
    const PIPE_GEO_LEN = CELL_SIZE / 2 + 0.08;

    const wallWritings = [
      'ВЫХОДА НЕТ',
      'НЕ ОБОРАЧИВАЙСЯ',
      'ОН СЛЫШИТ ТЕБЯ',
      'ТИШЕ',
      'ЭТО НЕ КОНЕЦ',
      'ВЕРНИ КАССЕТУ',
      'НЕ ХОДИ ДАЛЬШЕ',
      '|||| |||| |||| ||'
    ];

    const scaryMessages = [
      'ЗАПИСЬ ПОВРЕЖДЕНА',
      'ОНО ЕСТЬ НА ПЛЁНКЕ',
      'НЕ СМОТРИ В КОНЕЦ',
      'ТЫ УЖЕ В КАДРЕ',
      'ЭТО НЕ КОРИДОР',
      'ПОВТОРНЫЙ ПРОСМОТР',
      'ОНО ПОМНИТ ТЕБЯ',
      'НЕ ВЫКЛЮЧАЙ ПЛЕЕР',
      'ЗАПИСЬ НЕ ЗАКОНЧИЛАСЬ',
      'ПЕРЕМОТКА НЕ ПОМОЖЕТ',
      'ОНО ЗА ТОБОЙ',
      'НЕ БЕГИ',
      'ТЫ ЗДЕСЬ УЖЕ БЫЛ',
      'КАССЕТА ПОМНИТ ТЕБЯ',
      'ТЫ СЛЫШИШЬ ЭТО ТОЖЕ?',
      'НЕ ОГЛЯДЫВАЙСЯ'
    ];

    init();
    animate();

    function init() {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x010101);
      scene.fog = new THREE.FogExp2(0x010101, 0.09);

      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 220);
      camera.rotation.order = 'YXZ';

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.85;
      renderer.domElement.id = 'scene';
      document.body.appendChild(renderer.domElement);

      controls = new PointerLockControls(camera, document.body);

      controls.addEventListener('lock', () => {
        menu.style.display = 'none';
        cancelRewind(true);
        cancelFalseEnd(true);
        blackout.style.opacity = 0;
        rewindOverlay.style.opacity = 0;
        setVhsMode('PLAY');
      });

      controls.addEventListener('unlock', () => {
        moveForward = false;
        moveBackward = false;
        moveLeft = false;
        moveRight = false;
        sprint = false;

        cancelRewind(true);
        cancelFalseEnd(true);

        blackout.style.opacity = 0;
        rewindOverlay.style.opacity = 0;

        menu.style.display = 'flex';
        startBtn.textContent = 'ПРОДОЛЖИТЬ ПРОСМОТР';

        setVhsMode(unlockMode);
        unlockMode = 'PAUSE';
      });

      startBtn.addEventListener('click', playTape);
      btnPlay.addEventListener('click', playTape);

      btnPause.addEventListener('click', () => {
        initAudio();
        playClick();
        pauseTape();
      });

      btnStop.addEventListener('click', () => {
        initAudio();
        playClick();
        stopTape();
      });

      btnRew.addEventListener('click', () => {
        initAudio();
        playClick();
        startRewind();
      });

      btnFF.addEventListener('click', () => {
        initAudio();
        playClick();
        fastForward();
      });

      btnEject.addEventListener('click', () => {
        initAudio();
        playClick();
        ejectTape();
      });

      helpBtn.addEventListener('click', () => {
        initAudio();
        playClick();
        togglePanel(helpPanel);
      });

      archiveBtn.addEventListener('click', () => {
        initAudio();
        playClick();
        togglePanel(archivePanel);
      });

      document.addEventListener('pointerlockerror', () => {
        showMessage('БРАУЗЕР НЕ ДАЁТ ЗАХВАТИТЬ МЫШЬ', 2500);
      });

      scene.add(camera);

      const ambient = new THREE.AmbientLight(0x14141d, 0.42);
      scene.add(ambient);

      flashlight = new THREE.SpotLight(0xfff0cf, flashBase, 38, Math.PI / 5.2, 0.65, 1.7);
      flashlight.map = makeFlashlightCookie();
      flashlight.position.set(0, 0, 0.05);
      flashlight.castShadow = true;
      flashlight.shadow.mapSize.set(1024, 1024);
      flashlight.target.position.set(0, 0, -1);
      camera.add(flashlight);
      camera.add(flashlight.target);

      generateCorridor();
      computeTurnIndices();
      buildCorridor();
      setupStartEnd();

      camera.position.copy(startPos);
      camera.lookAt(startLook);

      const app = createApparition();
      apparition = app.group;
      apparitionParts = app.parts;
      apparition.visible = false;
      scene.add(apparition);

      crawler = createCrawler();
      crawler.visible = false;
      scene.add(crawler);

      crawlerState = {
        active: false,
        t: 0,
        dur: 0.8,
        from: new THREE.Vector3(),
        to: new THREE.Vector3()
      };

      window.addEventListener('resize', onWindowResize);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);

      clock = new THREE.Clock();

      startNoise();
      startFakeClock();
      updateVhsTape();
    }

    function togglePanel(panel) {
      const isHidden = panel.style.display === 'none' || panel.style.display === '';

      helpPanel.style.display = 'none';
      archivePanel.style.display = 'none';

      if (isHidden) {
        panel.style.display = 'block';
      }
    }

    function setVhsMode(mode) {
      currentVhsMode = mode;
      vhsModeEl.textContent = mode;
      vhsModeEl.className = 'vhs-screen mode-' + mode.toLowerCase();
    }

    function updateVhsTape() {
      const totalSeconds = Math.max(0, Math.floor(tapeSeconds));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      vhsTapeEl.textContent = `SP 0:${pad(minutes)}:${pad(seconds)}`;
    }

    function playTape() {
      initAudio();
      playClick();
      playWhirr();

      if (!controls.isLocked) {
        controls.lock();
      }
    }

    function pauseTape() {
      if (!controls.isLocked) return;
      unlockMode = 'PAUSE';
      controls.unlock();
    }

    function stopTape() {
      resetToStart();
      unlockMode = 'STOP';

      if (controls.isLocked) {
        controls.unlock();
      } else {
        setVhsMode('STOP');
      }
    }

    function ejectTape() {
      resetToStart();
      unlockMode = 'EJECT';

      hardGlitch(220);
      playStaticBurst();

      if (controls.isLocked) {
        controls.unlock();
      } else {
        setVhsMode('EJECT');
      }
    }

    function resetToStart() {
      camera.position.copy(startPos);
      camera.lookAt(startLook);

      velocity.set(0, 0, 0);
      headBobTime = 0;
      stepTimer = 0;

      history = [];
      historyTimer = 0;

      apparition.visible = false;
      apparitionTimer = 0;
      breathTimer = 0;
      knockedEnd = false;

      if (crawlerState) {
        crawlerState.active = false;
      }

      if (crawler) {
        crawler.visible = false;
      }

      endCooldown = 2;
    }

    function setInputEnabled(enabled) {
      if (!controls) return;

      if ('enabled' in controls) {
        controls.enabled = enabled;
      }

      if ('pointerSpeed' in controls) {
        controls.pointerSpeed = enabled ? 1 : 0;
      }
    }

    function key(x, z) {
      return x + ',' + z;
    }

    function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }

    function addCell(x, z) {
      const cell = {
        x,
        z,
        index: cells.length,
        neighbors: [false, false, false, false]
      };

      cells.push(cell);
      cellMap.set(key(x, z), cell);
      return cell;
    }

    function generateCorridor() {
      for (let attempt = 0; attempt < 30; attempt++) {
        cells = [];
        cellMap.clear();
        firstDir = 0;
        endDir = 0;

        let x = 0;
        let z = 0;
        let dir = 0;
        let moved = 0;

        addCell(x, z);

        for (let i = 0; i < 48; i++) {
          const candidates = [
            dir,
            dir,
            dir,
            (dir + 3) % 4,
            (dir + 1) % 4
          ];

          shuffleArray(candidates);

          let nextDir = null;

          for (const d of candidates) {
            const nx = x + DIRS[d][0];
            const nz = z + DIRS[d][1];

            if (!cellMap.has(key(nx, nz))) {
              nextDir = d;
              break;
            }
          }

          if (nextDir === null) break;

          if (moved === 0) firstDir = nextDir;

          const prev = cellMap.get(key(x, z));

          x += DIRS[nextDir][0];
          z += DIRS[nextDir][1];

          const cell = addCell(x, z);

          prev.neighbors[nextDir] = true;
          cell.neighbors[(nextDir + 2) % 4] = true;

          dir = nextDir;
          moved++;
        }

        if (cells.length >= 30) {
          endDir = dir;
          return;
        }
      }

      cells = [];
      cellMap.clear();
      firstDir = 0;
      endDir = 0;

      let prev = addCell(0, 0);

      for (let i = 1; i < 36; i++) {
        const cell = addCell(0, -i);
        prev.neighbors[0] = true;
        cell.neighbors[2] = true;
        prev = cell;
      }
    }

    function getDirBetween(from, to) {
      if (to.x === from.x + 1) return 1;
      if (to.x === from.x - 1) return 3;
      if (to.z === from.z - 1) return 0;
      if (to.z === from.z + 1) return 2;
      return -1;
    }

    function computeTurnIndices() {
      turnIndices = [];

      for (let i = 1; i < cells.length - 1; i++) {
        const prev = cells[i - 1];
        const current = cells[i];
        const next = cells[i + 1];

        const dirPrev = getDirBetween(current, prev);
        const dirNext = getDirBetween(current, next);

        if (dirPrev !== -1 && dirNext !== -1 && (dirPrev + 2) % 4 !== dirNext) {
          turnIndices.push(i);
        }
      }
    }

    function buildCorridor() {
      const floorTexture = makeFloorTexture();
      const floorBump = makeFloorBumpTexture();
      const wallTexture = makeWallTexture();
      const wallBump = makeWallBumpTexture();
      const ceilingTexture = makeCeilingTexture();

      floorTexture.repeat.set(2, 2);
      floorBump.repeat.set(2, 2);
      wallTexture.repeat.set(2, 1);
      wallBump.repeat.set(2, 1);
      ceilingTexture.repeat.set(2, 2);

      const floorMaterial = new THREE.MeshStandardMaterial({
        map: floorTexture,
        bumpMap: floorBump,
        bumpScale: 0.5,
        roughness: 0.9,
        metalness: 0.05
      });

      const wallMaterial = new THREE.MeshStandardMaterial({
        map: wallTexture,
        bumpMap: wallBump,
        bumpScale: 0.4,
        roughness: 0.88,
        metalness: 0.03
      });

      const ceilingMaterial = new THREE.MeshStandardMaterial({
        map: ceilingTexture,
        roughness: 0.96,
        metalness: 0.01
      });

      const floorGeometry = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
      const ceilingGeometry = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);

      pipeMat = new THREE.MeshStandardMaterial({ color: 0x1d1d21, roughness: 0.45, metalness: 0.75 });
      pipeGeoBig = new THREE.CylinderGeometry(0.07, 0.07, PIPE_GEO_LEN, 8);
      pipeGeoSmall = new THREE.CylinderGeometry(0.045, 0.045, PIPE_GEO_LEN, 8);
      fixtureMat = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.5, metalness: 0.6 });
      frameMat = new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 0.7, metalness: 0.2 });
      doorTexture = makeDoorTexture();

      for (const cell of cells) {
        const cx = cell.x * CELL_SIZE;
        const cz = cell.z * CELL_SIZE;

        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(cx, 0, cz);
        floor.receiveShadow = true;
        scene.add(floor);

        const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(cx, WALL_HEIGHT, cz);
        scene.add(ceiling);

        for (let side = 0; side < 4; side++) {
          if (!cell.neighbors[side]) {
            addWall(cell, side, wallMaterial);
          }
        }

        addPipesForCell(cell, cx, cz);

        if (cell.index % 5 === 2) {
          tryAddDoor(cell, cx, cz);
        }

        if (cell.index % 6 === 4) {
          tryAddWriting(cell, cx, cz);
        }

        if (cell.index % 9 === 5) {
          tryAddSectorPlate(cell, cx, cz);
        }

        if (cell.index % 11 === 4 && cell.index < cells.length - 1) {
          tryAddFloorArrow(cell, cx, cz);
        }

        if (cell.index % 4 === 1) {
          addCeilingLight(cx, cz);
        }
      }

      addDust();
    }

    function addPipesForCell(cell, cx, cz) {
      const openSides = [];

      for (let side = 0; side < 4; side++) {
        if (cell.neighbors[side]) openSides.push(side);
      }

      if (openSides.length === 1) {
        const d = DIRS[openSides[0]];
        addPipeSegment(cx, cz, d, PIPE_LAT, true, 'full');
        addPipeSegment(cx, cz, d, -PIPE_LAT, false, 'full');
        return;
      }

      const hasSide = {};
      for (const side of openSides) hasSide[side] = true;

      const bigCorner = hasSide[1] && hasSide[2];
      const smallCorner = hasSide[0] && hasSide[3];

      for (const side of openSides) {
        const d = DIRS[side];
        addPipeSegment(cx, cz, d, PIPE_LAT, true, bigCorner ? 'corner' : 'half');
        addPipeSegment(cx, cz, d, -PIPE_LAT, false, smallCorner ? 'corner' : 'half');
      }

      if (openSides.length === 2) {
        const a = DIRS[openSides[0]];
        const b = DIRS[openSides[1]];

        if (a[0] + b[0] !== 0 || a[1] + b[1] !== 0) {
          if (!bigCorner) addPipeDiagonal(cx, cz, 2.84, 0.07);
          if (!smallCorner) addPipeDiagonal(cx, cz, 2.66, 0.045);
        }
      }
    }

    function addPipeSegment(cx, cz, d, lateral, big, mode) {
      const geo = big ? pipeGeoBig : pipeGeoSmall;
      const height = big ? 2.84 : 2.66;

      const mesh = new THREE.Mesh(geo, pipeMat);

      const rScale = 0.99 + Math.random() * 0.02;
      let lengthScale = 1;
      let px = cx;
      let pz = cz;

      if (mode === 'full') {
        lengthScale = (CELL_SIZE + 0.2) / PIPE_GEO_LEN;
      } else {
        const shiftSign = Math.sign(d[0] !== 0 ? d[0] : d[1]);

        if (mode === 'corner') {
          lengthScale = (CELL_SIZE / 2 - Math.abs(lateral) + 0.08) / PIPE_GEO_LEN;
          const shift = shiftSign * (CELL_SIZE / 2 + Math.abs(lateral)) / 2;
          if (d[0] !== 0) px += shift; else pz += shift;
        } else {
          const shift = shiftSign * CELL_SIZE / 4;
          if (d[0] !== 0) px += shift; else pz += shift;
        }
      }

      mesh.scale.set(rScale, lengthScale, rScale);

      if (d[0] !== 0) {
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(px, height, cz + lateral);
      } else {
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(cx + lateral, height, pz);
      }

      scene.add(mesh);
    }

    function addPipeDiagonal(cx, cz, height, radius) {
      const from = new THREE.Vector3(cx + PIPE_LAT, height, cz);
      const to = new THREE.Vector3(cx, height, cz + PIPE_LAT);
      const dir = to.clone().sub(from);
      const length = dir.length();

      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 8),
        pipeMat
      );

      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize()
      );

      scene.add(mesh);
    }

    function pickSolidSide(cell) {
      const solid = [];

      for (let side = 0; side < 4; side++) {
        if (!cell.neighbors[side]) solid.push(side);
      }

      if (solid.length === 0) return -1;
      return solid[Math.floor(Math.random() * solid.length)];
    }

    function tryAddDoor(cell, cx, cz) {
      const side = pickSolidSide(cell);
      if (side === -1) return;

      const d = DIRS[side];
      const group = new THREE.Group();

      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.56, 0.05), frameMat);
      frame.position.set(0, 1.28, 0);
      group.add(frame);

      const leaf = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 2.42),
        new THREE.MeshStandardMaterial({ map: doorTexture, roughness: 0.72, metalness: 0.12 })
      );
      leaf.position.set(0, 1.24, 0.03);
      group.add(leaf);

      group.position.set(
        cx + d[0] * (CELL_SIZE / 2 - 0.005),
        0,
        cz + d[1] * (CELL_SIZE / 2 - 0.005)
      );

      if (side === 0) group.rotation.y = 0;
      else if (side === 2) group.rotation.y = Math.PI;
      else if (side === 3) group.rotation.y = Math.PI / 2;
      else group.rotation.y = -Math.PI / 2;

      scene.add(group);
    }

    function tryAddWriting(cell, cx, cz) {
      const side = pickSolidSide(cell);
      if (side === -1) return;

      const d = DIRS[side];
      const text = wallWritings[Math.floor(Math.random() * wallWritings.length)];

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 1.0),
        new THREE.MeshStandardMaterial({
          map: makeWritingTexture(text),
          transparent: true,
          roughness: 1,
          metalness: 0,
          depthWrite: false
        })
      );

      sign.position.set(
        cx + d[0] * (CELL_SIZE / 2 - 0.02) + (d[1] !== 0 ? THREE.MathUtils.randFloatSpread(0.5) : 0),
        1.55,
        cz + d[1] * (CELL_SIZE / 2 - 0.02) + (d[0] !== 0 ? THREE.MathUtils.randFloatSpread(0.5) : 0)
      );

      if (side === 0) sign.rotation.y = 0;
      else if (side === 2) sign.rotation.y = Math.PI;
      else if (side === 3) sign.rotation.y = Math.PI / 2;
      else sign.rotation.y = -Math.PI / 2;

      sign.rotation.z = THREE.MathUtils.randFloatSpread(0.08);

      scene.add(sign);
    }

    function tryAddSectorPlate(cell, cx, cz) {
      const side = pickSolidSide(cell);
      if (side === -1) return;

      const d = DIRS[side];
      const num = String(100 + cell.index * 7).slice(-3);

      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.75),
        new THREE.MeshStandardMaterial({
          map: makeStencilTexture(num),
          transparent: true,
          roughness: 1,
          metalness: 0,
          depthWrite: false
        })
      );

      plate.position.set(
        cx + d[0] * (CELL_SIZE / 2 - 0.02) + (d[1] !== 0 ? THREE.MathUtils.randFloatSpread(0.6) : 0),
        2.15,
        cz + d[1] * (CELL_SIZE / 2 - 0.02) + (d[0] !== 0 ? THREE.MathUtils.randFloatSpread(0.6) : 0)
      );

      if (side === 0) plate.rotation.y = 0;
      else if (side === 2) plate.rotation.y = Math.PI;
      else if (side === 3) plate.rotation.y = Math.PI / 2;
      else plate.rotation.y = -Math.PI / 2;

      plate.rotation.z = THREE.MathUtils.randFloatSpread(0.04);

      scene.add(plate);
    }

    function tryAddFloorArrow(cell, cx, cz) {
      const next = cells[cell.index + 1];
      if (!next) return;

      const dx = next.x - cell.x;
      const dz = next.z - cell.z;
      let yaw = Math.atan2(-dz, dx);

      if (Math.random() < 0.45) {
        yaw += Math.PI;
      }

      const geo = new THREE.PlaneGeometry(1.6, 0.8);
      geo.rotateX(-Math.PI / 2);

      const arrow = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          map: makeArrowTexture(Math.random() < 0.6 ? 'ВЫХОД' : 'НЕ ТУДА'),
          transparent: true,
          roughness: 1,
          metalness: 0,
          depthWrite: false
        })
      );

      arrow.rotation.y = yaw;
      arrow.position.set(cx, 0.015, cz);

      scene.add(arrow);
    }

    function addWall(cell, side, material) {
      const cx = cell.x * CELL_SIZE;
      const cz = cell.z * CELL_SIZE;
      const len = CELL_SIZE + WALL_THICKNESS;

      let geometry;
      let px = cx;
      let pz = cz;

      if (side === 0) {
        geometry = new THREE.BoxGeometry(len, WALL_HEIGHT, WALL_THICKNESS);
        pz = cz - CELL_SIZE / 2 - WALL_THICKNESS / 2;
      } else if (side === 2) {
        geometry = new THREE.BoxGeometry(len, WALL_HEIGHT, WALL_THICKNESS);
        pz = cz + CELL_SIZE / 2 + WALL_THICKNESS / 2;
      } else if (side === 3) {
        geometry = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, len);
        px = cx - CELL_SIZE / 2 - WALL_THICKNESS / 2;
      } else {
        geometry = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, len);
        px = cx + CELL_SIZE / 2 + WALL_THICKNESS / 2;
      }

      const wall = new THREE.Mesh(geometry, material);
      wall.position.set(px, WALL_HEIGHT / 2, pz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);

      const halfX = (side === 0 || side === 2) ? len / 2 : WALL_THICKNESS / 2;
      const halfZ = (side === 0 || side === 2) ? WALL_THICKNESS / 2 : len / 2;

      wallColliders.push({
        minX: px - halfX,
        maxX: px + halfX,
        minZ: pz - halfZ,
        maxZ: pz + halfZ
      });
    }

    function addCeilingLight(cx, cz) {
      const broken = Math.random() < 0.16;
      const base = 11 + Math.random() * 6;

      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.42), fixtureMat);
      housing.position.set(cx, WALL_HEIGHT - 0.06, cz);
      scene.add(housing);

      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.05, 0.24),
        new THREE.MeshBasicMaterial({ color: broken ? 0x161616 : 0xffeecc })
      );
      tube.position.set(cx, WALL_HEIGHT - 0.13, cz);

      if (broken) {
        tube.rotation.z = 0.16;
        tube.position.y -= 0.05;
      }

      scene.add(tube);

      const light = new THREE.PointLight(0xffd9a6, broken ? 0 : base, 15, 2);
      light.position.set(cx, WALL_HEIGHT - 0.35, cz);
      scene.add(light);

      lights.push({
        light,
        bulb: tube,
        base,
        flickerUntil: 0,
        offUntil: 0,
        broken
      });
    }

    function addDust() {
      const count = 620;
      const positions = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const cell = cells[Math.floor(Math.random() * cells.length)];
        const cx = cell.x * CELL_SIZE;
        const cz = cell.z * CELL_SIZE;

        positions[i * 3 + 0] = cx + (Math.random() - 0.5) * CELL_SIZE * 0.85;
        positions[i * 3 + 1] = Math.random() * WALL_HEIGHT;
        positions[i * 3 + 2] = cz + (Math.random() - 0.5) * CELL_SIZE * 0.85;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.PointsMaterial({
        color: 0xa8a8a8,
        size: 0.045,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      });

      dust = new THREE.Points(geometry, material);
      scene.add(dust);
    }

    function setupStartEnd() {
      const start = cells[0];
      const scx = start.x * CELL_SIZE;
      const scz = start.z * CELL_SIZE;
      const dv = DIRS[firstDir];

      startPos.set(
        scx - dv[0] * 1.3,
        1.7,
        scz - dv[1] * 1.3
      );

      startLook.set(
        scx + dv[0] * 3,
        1.5,
        scz + dv[1] * 3
      );

      const end = cells[cells.length - 1];
      let doorSide = endDir;

      if (end.neighbors[doorSide]) {
        const missing = end.neighbors.findIndex((hasNeighbor) => !hasNeighbor);
        if (missing !== -1) doorSide = missing;
      }

      const ecx = end.x * CELL_SIZE;
      const ecz = end.z * CELL_SIZE;
      const inward = DIRS[(doorSide + 2) % 4];

      endTarget.set(
        ecx + inward[0] * 1.0,
        1.7,
        ecz + inward[1] * 1.0
      );

      addEndDoor(end, doorSide);

      redLight = new THREE.PointLight(0xff0000, 60, 30, 2);
      redLight.position.set(
        ecx + inward[0] * 1.5,
        2.2,
        ecz + inward[1] * 1.5
      );
      scene.add(redLight);
    }

    function addEndDoor(cell, side) {
      const cx = cell.x * CELL_SIZE;
      const cz = cell.z * CELL_SIZE;

      const doorGroup = new THREE.Group();

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.95, 2.85, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x0d0b0a, roughness: 0.6, metalness: 0.4 })
      );
      frame.position.set(0, 1.42, 0.06);
      doorGroup.add(frame);

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.68, 2.66, 0.1),
        new THREE.MeshStandardMaterial({
          color: 0x241014,
          roughness: 0.32,
          metalness: 0.7,
          emissive: 0x160004,
          emissiveIntensity: 0.6
        })
      );
      door.position.set(0, 1.35, 0.09);
      doorGroup.add(door);

      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a1414, roughness: 0.3, metalness: 0.85 })
      );
      handle.position.set(0.62, 1.3, 0.16);
      doorGroup.add(handle);

      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xff2020 })
      );
      bulb.position.set(0, 2.94, 0.12);
      doorGroup.add(bulb);

      exitSign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.42),
        new THREE.MeshBasicMaterial({ map: makeExitSignTexture() })
      );
      exitSign.position.set(0, 2.72, 0.1);
      doorGroup.add(exitSign);

      doorGroup.position.set(cx, 0, cz);

      if (side === 0) {
        doorGroup.position.z -= CELL_SIZE / 2 + 0.06;
      } else if (side === 2) {
        doorGroup.position.z += CELL_SIZE / 2 + 0.06;
        doorGroup.rotation.y = Math.PI;
      } else if (side === 3) {
        doorGroup.position.x -= CELL_SIZE / 2 + 0.06;
        doorGroup.rotation.y = Math.PI / 2;
      } else {
        doorGroup.position.x += CELL_SIZE / 2 + 0.06;
        doorGroup.rotation.y = -Math.PI / 2;
      }

      scene.add(doorGroup);
    }

    function makeCanvasTexture(canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      return texture;
    }

    function speckle(ctx, count, alpha, sizeMax, w = 512, h = 512) {
      for (let i = 0; i < count; i++) {
        const light = Math.random() > 0.5;
        ctx.fillStyle = light
          ? `rgba(255,255,255,${Math.random() * alpha})`
          : `rgba(0,0,0,${Math.random() * alpha})`;
        ctx.fillRect(
          Math.random() * w,
          Math.random() * h,
          Math.random() * sizeMax + 1,
          Math.random() * sizeMax + 1
        );
      }
    }

    function makeFloorTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#16130e';
      ctx.fillRect(0, 0, 512, 512);

      const tile = 128;

      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const shade = 16 + Math.floor(Math.random() * 14);
          ctx.fillStyle = `rgb(${shade + 4},${shade + 1},${Math.max(0, shade - 4)})`;
          ctx.fillRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
        }
      }

      ctx.globalAlpha = 0.14;

      for (let i = 0; i < 7; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 30 + Math.random() * 110;
        const g = ctx.createRadialGradient(x, y, 2, x, y, r);
        g.addColorStop(0, 'rgba(6,4,2,0.55)');
        g.addColorStop(1, 'rgba(6,4,2,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      ctx.globalAlpha = 1;

      speckle(ctx, 9000, 0.1, 2.5);

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;

      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * tile, 0);
        ctx.lineTo(i * tile, 512);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * tile);
        ctx.lineTo(512, i * tile);
        ctx.stroke();
      }

      return makeCanvasTexture(canvas);
    }

    function makeFloorBumpTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#7d7d7d';
      ctx.fillRect(0, 0, 512, 512);

      const tile = 128;

      for (let ty = 0; ty < 4; ty++) {
        for (let tx = 0; tx < 4; tx++) {
          const shade = 118 + Math.floor(Math.random() * 22);
          ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
          ctx.fillRect(tx * tile + 3, ty * tile + 3, tile - 6, tile - 6);
        }
      }

      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 4;

      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * tile, 0);
        ctx.lineTo(i * tile, 512);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * tile);
        ctx.lineTo(512, i * tile);
        ctx.stroke();
      }

      speckle(ctx, 5000, 0.25, 2.5);

      return makeCanvasTexture(canvas);
    }

    function makeWallTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#1a1712';
      ctx.fillRect(0, 0, 512, 512);

      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = Math.random() > 0.5
          ? `rgba(255,246,230,${Math.random() * 0.05})`
          : `rgba(0,0,0,${Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * 512, 0, 20 + Math.random() * 80, 512);
      }

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, 4, 512);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(4, 0, 2, 512);

      const grime = ctx.createLinearGradient(0, 0, 0, 512);
      grime.addColorStop(0, 'rgba(0,0,0,0.38)');
      grime.addColorStop(0.35, 'rgba(0,0,0,0.05)');
      grime.addColorStop(0.8, 'rgba(0,0,0,0.12)');
      grime.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = grime;
      ctx.fillRect(0, 0, 512, 512);

      for (let i = 0; i < 16; i++) {
        const x = Math.random() * 512;
        const w = 4 + Math.random() * 22;
        const h = 60 + Math.random() * 300;
        const y0 = Math.random() * 200;
        const streak = ctx.createLinearGradient(0, y0, 0, y0 + h);
        streak.addColorStop(0, 'rgba(8,6,3,0.4)');
        streak.addColorStop(1, 'rgba(8,6,3,0)');
        ctx.fillStyle = streak;
        ctx.fillRect(x, y0, w, h);
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.2;

      for (let i = 0; i < 5; i++) {
        let x = Math.random() * 512;
        let y = Math.random() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);

        for (let s = 0; s < 7; s++) {
          x += (Math.random() - 0.5) * 60;
          y += Math.random() * 50;
          ctx.lineTo(x, y);
        }

        ctx.stroke();
      }

      speckle(ctx, 6500, 0.09, 2);

      ctx.fillStyle = '#0b0a08';
      ctx.fillRect(0, 466, 512, 46);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 466, 512, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 462, 512, 4);

      return makeCanvasTexture(canvas);
    }

    function makeWallBumpTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#8c8c8c';
      ctx.fillRect(0, 0, 512, 512);

      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(0, 0, 4, 512);

      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = 'rgba(70,70,70,0.3)';
        ctx.fillRect(Math.random() * 512, Math.random() * 200, 4 + Math.random() * 20, 60 + Math.random() * 250);
      }

      speckle(ctx, 4500, 0.22, 2);

      ctx.fillStyle = '#a4a4a4';
      ctx.fillRect(0, 466, 512, 46);
      ctx.fillStyle = '#555555';
      ctx.fillRect(0, 462, 512, 4);

      return makeCanvasTexture(canvas);
    }

    function makeCeilingTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#0c0c0d';
      ctx.fillRect(0, 0, 512, 512);

      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;

      for (let i = 0; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 256, 0);
        ctx.lineTo(i * 256, 512);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * 256);
        ctx.lineTo(512, i * 256);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.35;

      for (let i = 0; i < 6; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 60 + Math.random() * 150;
        const g = ctx.createRadialGradient(x, y, 4, x, y, r);
        g.addColorStop(0, 'rgba(30,22,10,0.6)');
        g.addColorStop(1, 'rgba(30,22,10,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      ctx.globalAlpha = 1;

      speckle(ctx, 4000, 0.08, 2);

      return makeCanvasTexture(canvas);
    }

    function makeDoorTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#171009';
      ctx.fillRect(0, 0, 256, 512);

      const bottom = ctx.createLinearGradient(0, 300, 0, 512);
      bottom.addColorStop(0, 'rgba(0,0,0,0)');
      bottom.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = bottom;
      ctx.fillRect(0, 300, 256, 212);

      for (const y0 of [40, 250]) {
        ctx.strokeStyle = '#090604';
        ctx.lineWidth = 5;
        ctx.strokeRect(30, y0, 196, 180);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        ctx.strokeRect(34, y0 + 4, 188, 172);
      }

      ctx.fillStyle = '#3c3c40';
      ctx.beginPath();
      ctx.arc(214, 300, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(210, 296, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;

      for (let i = 0; i < 10; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 30);
        ctx.stroke();
      }

      speckle(ctx, 1500, 0.1, 2, 256, 512);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }

    function makeWritingTexture(text) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      ctx.translate(256, 128);
      ctx.rotate(THREE.MathUtils.randFloatSpread(0.05));

      let fontSize = 84;
      ctx.font = `700 ${fontSize}px Consolas, monospace`;

      while (ctx.measureText(text).width > 460 && fontSize > 28) {
        fontSize -= 4;
        ctx.font = `700 ${fontSize}px Consolas, monospace`;
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = `rgba(80, 12, 12, ${0.28 + i * 0.22})`;
        ctx.fillText(text, THREE.MathUtils.randFloatSpread(4), THREE.MathUtils.randFloatSpread(4));
      }

      const width = ctx.measureText(text).width;

      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = 'rgba(70, 9, 9, 0.4)';
        ctx.fillRect(
          THREE.MathUtils.randFloatSpread(Math.max(40, width * 0.9)),
          fontSize * 0.4,
          2.5,
          12 + Math.random() * 55
        );
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function makeStencilTexture(num) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');

      ctx.translate(128, 64);
      ctx.rotate(THREE.MathUtils.randFloatSpread(0.03));

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(212, 206, 188, 0.55)';

      ctx.font = '700 56px Consolas, monospace';
      ctx.fillText(num, 0, 10);

      ctx.font = '700 22px Consolas, monospace';
      ctx.fillText('СЕКТОР', 0, -34);

      ctx.globalCompositeOperation = 'destination-out';

      for (let i = 0; i < 350; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.5})`;
        ctx.fillRect(
          THREE.MathUtils.randFloatSpread(240),
          THREE.MathUtils.randFloatSpread(110),
          Math.random() * 4 + 1,
          Math.random() * 4 + 1
        );
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function makeArrowTexture(label) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(212, 206, 188, 0.5)';

      ctx.fillRect(28, 52, 130, 24);

      ctx.beginPath();
      ctx.moveTo(158, 28);
      ctx.lineTo(226, 64);
      ctx.lineTo(158, 100);
      ctx.closePath();
      ctx.fill();

      ctx.font = '700 26px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 128, 112);

      ctx.globalCompositeOperation = 'destination-out';

      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.5})`;
        ctx.fillRect(
          Math.random() * 256,
          Math.random() * 128,
          Math.random() * 4 + 1,
          Math.random() * 4 + 1
        );
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function makeExitSignTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#070303';
      ctx.fillRect(0, 0, 256, 96);

      ctx.strokeStyle = 'rgba(255, 42, 42, 0.55)';
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, 244, 84);

      ctx.font = '700 54px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#ff3838';
      ctx.fillText('ВЫХОД', 128, 50);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function makeFlashlightCookie() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.42, 'rgba(255,255,255,0.82)');
      gradient.addColorStop(0.78, 'rgba(255,255,255,0.3)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);

      for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 96 + Math.random() * 34;
        const r = 8 + Math.random() * 22;

        ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.08})`;
        ctx.beginPath();
        ctx.arc(128 + Math.cos(angle) * dist, 128 + Math.sin(angle) * dist, r, 0, Math.PI * 2);
        ctx.fill();
      }

      return new THREE.CanvasTexture(canvas);
    }

    function makeGlowTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,120,120,0.8)');
      g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function createApparition() {
      const group = new THREE.Group();

      const bodyMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.96
      });

      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.23, 1.05, 6, 12),
        bodyMaterial
      );
      body.position.y = 0.88;

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), bodyMaterial);
      head.scale.set(1, 1.28, 1);
      head.position.y = 1.84;
      head.rotation.z = 0.09;

      const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
      const eyeGeometry = new THREE.SphereGeometry(0.024, 8, 8);

      const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      leftEye.position.set(-0.062, 1.87, 0.155);

      const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      rightEye.position.set(0.062, 1.87, 0.155);

      const glowTexture = makeGlowTexture();

      const glowL = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff2222,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      glowL.scale.setScalar(0.17);
      glowL.position.set(-0.062, 1.87, 0.19);

      const glowR = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff2222,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      glowR.scale.setScalar(0.17);
      glowR.position.set(0.062, 1.87, 0.19);

      const eyeLight = new THREE.PointLight(0xff2020, 0, 6, 2);
      eyeLight.position.set(0, 1.82, 0.4);

      for (const armSide of [-1, 1]) {
        const arm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.032, 0.95, 8),
          bodyMaterial
        );
        arm.position.set(armSide * 0.3, 0.98, 0.02);
        arm.rotation.z = armSide * 0.1;
        group.add(arm);
      }

      group.add(body, head, leftEye, rightEye, glowL, glowR, eyeLight);

      return { group, parts: { head, eyeLight, glowL, glowR } };
    }

    function createCrawler() {
      const group = new THREE.Group();

      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.95
      });

      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), mat);
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.26;
      group.add(body);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), mat);
      head.position.set(0.4, 0.24, 0);
      group.add(head);

      const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
      const eyeGeometry = new THREE.SphereGeometry(0.018, 6, 6);

      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eye.position.set(0.46, 0.28, side * 0.055);
        group.add(eye);
      }

      return group;
    }

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function onKeyDown(event) {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          moveForward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          moveBackward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          moveLeft = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          moveRight = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          sprint = true;
          break;
        case 'KeyF':
          if (controls.isLocked) toggleFlashlight();
          break;
        case 'KeyR':
          if (controls.isLocked) startRewind();
          break;
        case 'KeyV':
          if (controls.isLocked) fastForward();
          break;
        case 'KeyP':
          if (controls.isLocked) pauseTape();
          break;
      }
    }

    function onKeyUp(event) {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          moveForward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          moveBackward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          moveLeft = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          moveRight = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          sprint = false;
          break;
      }
    }

    function toggleFlashlight() {
      flashlightOn = !flashlightOn;
      playClick();
    }

    function animate() {
      requestAnimationFrame(animate);

      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      rewindCooldown = Math.max(0, rewindCooldown - delta);
      ffCooldown = Math.max(0, ffCooldown - delta);
      endCooldown = Math.max(0, endCooldown - delta);

      if (controls.isLocked) {
        if (falseEnd.active) {
          updateFalseEnd(delta);
          updateLights(elapsed);
        } else if (rewind.active) {
          updateRewind(delta);
          updateLights(elapsed);
        } else {
          updatePlayer(delta);
          updateEvents(delta, elapsed);
          updateLights(elapsed);

          const roll =
            Math.sin(elapsed * 0.35) * 0.003 +
            Math.sin(elapsed * 1.7) * 0.0015 +
            (Math.random() - 0.5) * 0.0008;

          camera.rotation.z = roll + (Math.random() - 0.5) * cameraGlitch;
        }
      } else {
        updateLights(elapsed);
      }

      if (controls.isLocked && currentVhsMode === 'PLAY' && !falseEnd.active && !rewind.active) {
        tapeSeconds += delta;
      }

      if (rewind.active) {
        tapeSeconds = Math.max(0, tapeSeconds - delta * 12);
      }

      const tick = Math.floor(tapeSeconds * 4);
      if (tick !== lastTapeTick) {
        lastTapeTick = tick;
        updateVhsTape();
      }

      updateFlashlight(delta, elapsed);
      updateHum(delta);

      dripTimer -= delta;

      if (dripTimer <= 0) {
        dripTimer = 5 + Math.random() * 9;
        if (audioCtx && audioCtx.state === 'running') {
          playDrip();
        }
      }

      if (dust) {
        dust.material.opacity = 0.14 + Math.sin(elapsed * 0.7) * 0.035;
      }

      renderer.render(scene, camera);
    }

    function updateFlashlight(delta, elapsed) {
      let target = flashlightOn && elapsed >= flashOffUntil ? flashBase : 0;

      if (target > 0) {
        target *= 0.93 + 0.07 * Math.sin(elapsed * 12.7) * Math.sin(elapsed * 5.3);

        if (apparition && apparition.visible) {
          const distance = camera.position.distanceTo(apparition.position);

          if (distance < 9 && Math.random() < 0.12) {
            target *= 0.1 + Math.random() * 0.5;
          }
        }
      }

      flashlight.intensity += (target - flashlight.intensity) * Math.min(1, delta * 28);
    }

    function updateHum(delta) {
      if (!humGain || !audioCtx || audioCtx.state !== 'running') return;

      humTimer -= delta;
      if (humTimer > 0) return;
      humTimer = 0.18;

      let nearest = Infinity;

      for (const item of lights) {
        if (item.broken) continue;

        const dx = camera.position.x - item.light.position.x;
        const dz = camera.position.z - item.light.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < nearest) nearest = distSq;
      }

      const dist = Math.sqrt(nearest);
      const level = dist < 11 ? 0.022 * (1 - dist / 11) : 0;
      humGain.gain.setTargetAtTime(level, audioCtx.currentTime, 0.12);
    }

    function updatePlayer(delta) {
      const forwardInput = (moveForward ? 1 : 0) - (moveBackward ? 1 : 0);
      const rightInput = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);

      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, camera.up).normalize();

      const input = new THREE.Vector3();
      input.addScaledVector(forward, forwardInput);
      input.addScaledVector(right, rightInput);

      if (input.lengthSq() > 0) input.normalize();

      const maxSpeed = sprint ? 8.2 : 4.0;
      const smoothing = 1 - Math.exp(-10 * delta);

      velocity.x = THREE.MathUtils.lerp(velocity.x, input.x * maxSpeed, smoothing);
      velocity.z = THREE.MathUtils.lerp(velocity.z, input.z * maxSpeed, smoothing);

      const newX = camera.position.x + velocity.x * delta;
      const newZ = camera.position.z + velocity.z * delta;

      let resolved = resolveCollision(newX, camera.position.z);
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;

      resolved = resolveCollision(camera.position.x, newZ);
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;

      const speedLength = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      const bobPower = Math.min(speedLength / maxSpeed, 1);
      headBobTime += delta * (6 + speedLength * 1.4);

      camera.position.y =
        1.7 +
        Math.sin(headBobTime) * 0.025 * bobPower +
        Math.sin(headBobTime * 0.5) * 0.006 * bobPower +
        Math.sin(clock.elapsedTime * 1.5) * 0.005 * (1 - bobPower);

      const targetFov = sprint && speedLength > 4.5 ? 77 : 70;

      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, delta * 4);
        camera.updateProjectionMatrix();
      }

      if (speedLength > 0.4) {
        stepTimer += delta * (sprint ? 1.6 : 1.0);

        if (stepTimer > 0.5) {
          stepTimer = 0;
          playFootstep();
        }
      } else {
        stepTimer = 0;
      }

      historyTimer += delta;

      if (historyTimer >= HISTORY_INTERVAL) {
        historyTimer = 0;

        history.push({
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone()
        });

        if (history.length > MAX_HISTORY) {
          history.shift();
        }
      }

      if (!knockedEnd && endCooldown <= 0 && camera.position.distanceTo(endTarget) < 3.4) {
        knockedEnd = true;
        playDoorKnock();
      }

      if (endCooldown <= 0 && camera.position.distanceTo(endTarget) < 1.25) {
        startFalseEnd();
      }
    }

    function resolveCollision(x, z) {
      for (let iteration = 0; iteration < 3; iteration++) {
        let moved = false;

        for (const collider of wallColliders) {
          if (
            x < collider.minX - PLAYER_RADIUS ||
            x > collider.maxX + PLAYER_RADIUS ||
            z < collider.minZ - PLAYER_RADIUS ||
            z > collider.maxZ + PLAYER_RADIUS
          ) {
            continue;
          }

          const closestX = Math.max(collider.minX, Math.min(x, collider.maxX));
          const closestZ = Math.max(collider.minZ, Math.min(z, collider.maxZ));

          const dx = x - closestX;
          const dz = z - closestZ;
          const distSq = dx * dx + dz * dz;

          if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
            if (distSq > 0.000001) {
              const dist = Math.sqrt(distSq);
              const push = (PLAYER_RADIUS - dist) / dist;
              x += dx * push;
              z += dz * push;
            } else {
              const left = x - collider.minX;
              const right = collider.maxX - x;
              const top = z - collider.minZ;
              const bottom = collider.maxZ - z;

              const minPen = Math.min(left, right, top, bottom);

              if (minPen === left) {
                x = collider.minX - PLAYER_RADIUS;
              } else if (minPen === right) {
                x = collider.maxX + PLAYER_RADIUS;
              } else if (minPen === top) {
                z = collider.minZ - PLAYER_RADIUS;
              } else {
                z = collider.maxZ + PLAYER_RADIUS;
              }
            }

            moved = true;
          }
        }

        if (!moved) break;
      }

      return { x, z };
    }

    function updateLights(elapsed) {
      for (const item of lights) {
        if (item.broken) continue;

        if (elapsed < item.offUntil) {
          item.light.intensity = 0;
          item.bulb.material.color.setHex(0x111111);
        } else if (elapsed < item.flickerUntil) {
          const flick = Math.random() > 0.45;
          item.light.intensity = flick ? item.base * 1.7 : item.base * 0.08;
          item.bulb.material.color.setHex(flick ? 0xffffee : 0x222222);
        } else {
          item.light.intensity = item.base + Math.sin(elapsed * 23 + item.light.position.z) * 0.6;
          item.bulb.material.color.setHex(0xffeecc);
        }
      }

      if (exitSign) {
        exitSign.material.color.setScalar(Math.random() < 0.05 ? 0.15 : 0.72 + Math.random() * 0.28);
      }

      if (redLight) {
        redLight.intensity = 60 + Math.sin(elapsed * 2.0) * 10 + Math.random() * 3;
      }
    }

    function updateEvents(delta, elapsed) {
      eventTimer -= delta;

      if (eventTimer <= 0) {
        eventTimer = Math.max(2.0, 6.5 - loop * 0.35) + Math.random() * 6;

        const roll = Math.random();

        if (roll < 0.15) {
          if (Math.random() < 0.3) {
            playPA();
          } else {
            playWhisper();
          }
          showMessageRandom();
        } else if (roll < 0.28) {
          flickerLights(elapsed);
        } else if (roll < 0.46) {
          spawnTurnApparition();
        } else if (roll < 0.54) {
          spawnApparition();
        } else if (roll < 0.61) {
          lightsOut(elapsed);
        } else if (roll < 0.69) {
          signalLoss();
        } else if (roll < 0.76) {
          playHeartbeat();
        } else if (roll < 0.82) {
          playCreak();
        } else if (roll < 0.87) {
          playDistantClang();
        } else if (roll < 0.92) {
          spawnCrawler();
        } else if (roll < 0.95) {
          spawnBehind();
        } else if (roll < 0.98) {
          playFootstepsBehind();
        } else {
          playDistantScream();
        }
      }

      if (apparition.visible) {
        apparitionTimer -= delta;
        apparition.lookAt(camera.position.x, 0, camera.position.z);

        const distance = camera.position.distanceTo(apparition.position);
        const parts = apparitionParts;

        parts.eyeLight.intensity = 1.1 + Math.random() * 1.5;
        parts.glowL.material.opacity = 0.35 + Math.random() * 0.65;
        parts.glowR.material.opacity = 0.35 + Math.random() * 0.65;
        parts.head.rotation.z = 0.09 + Math.sin(elapsed * 2.3) * 0.05 + THREE.MathUtils.randFloatSpread(0.03);

        if (Math.random() < 0.03) {
          apparition.position.x += THREE.MathUtils.randFloatSpread(0.1);
          apparition.position.z += THREE.MathUtils.randFloatSpread(0.1);
        }

        if (Math.random() < 0.012) {
          document.body.classList.add('invert');
          setTimeout(() => document.body.classList.remove('invert'), 50);
        }

        if (distance < 7.5) {
          breathTimer -= delta;

          if (breathTimer <= 0) {
            playBreath(THREE.MathUtils.clamp(1.4 - distance / 7.5, 0.3, 1));
            breathTimer = 2.2 + Math.random() * 2.4;
          }
        }

        if (distance < 2.3 || apparitionTimer <= 0) {
          apparition.visible = false;

          if (distance < 5) {
            playScare();

            if (distance < 3.5) {
              hardGlitch(80);
            }
          }
        }
      }

      if (crawlerState && crawlerState.active) {
        crawlerState.t += delta;
        const k = Math.min(1, crawlerState.t / crawlerState.dur);

        crawler.position.lerpVectors(crawlerState.from, crawlerState.to, k);
        crawler.position.y = Math.abs(Math.sin(crawlerState.t * 42)) * 0.05;

        if (k >= 1) {
          crawlerState.active = false;
          crawler.visible = false;
        }
      }
    }

    function spawnBehind() {
      if (apparition.visible) return;

      const current = getNearestCellIndex();
      if (current === 0) return;

      const cell = cells[current - 1];

      apparition.position.set(
        cell.x * CELL_SIZE + THREE.MathUtils.randFloatSpread(0.6),
        0,
        cell.z * CELL_SIZE + THREE.MathUtils.randFloatSpread(0.6)
      );

      apparition.scale.setScalar(1.0 + Math.random() * 0.3);
      apparition.visible = true;
      apparitionTimer = 1.4 + Math.random() * 0.8;
      apparition.lookAt(camera.position.x, 0, camera.position.z);

      playCreak();
      playWhisper(0.07, 0.9, 500);
    }

    function spawnCrawler() {
      if (crawlerState.active || apparition.visible) return;

      const current = getNearestCellIndex();
      const index = Math.min(cells.length - 1, current + 4 + Math.floor(Math.random() * 4));
      const cell = cells[index];
      const cx = cell.x * CELL_SIZE;
      const cz = cell.z * CELL_SIZE;

      let alongX;
      if (cell.neighbors[0] || cell.neighbors[2]) alongX = true;
      else if (cell.neighbors[1] || cell.neighbors[3]) alongX = false;
      else alongX = Math.random() < 0.5;

      if (alongX) {
        crawlerState.from.set(cx - 1.55, 0, cz);
        crawlerState.to.set(cx + 1.55, 0, cz);
        crawler.rotation.y = 0;
      } else {
        crawlerState.from.set(cx, 0, cz - 1.55);
        crawlerState.to.set(cx, 0, cz + 1.55);
        crawler.rotation.y = Math.PI / 2;
      }

      crawlerState.active = true;
      crawlerState.t = 0;
      crawlerState.dur = 0.6 + Math.random() * 0.45;
      crawler.position.copy(crawlerState.from);
      crawler.visible = true;

      playSkitter();
    }

    function getNearestCellIndex() {
      let bestIndex = 0;
      let bestDist = Infinity;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const cx = cell.x * CELL_SIZE;
        const cz = cell.z * CELL_SIZE;

        const dx = camera.position.x - cx;
        const dz = camera.position.z - cz;
        const distSq = dx * dx + dz * dz;

        if (distSq < bestDist) {
          bestDist = distSq;
          bestIndex = i;
        }
      }

      return bestIndex;
    }

    function spawnTurnApparition() {
      if (apparition.visible) return;

      const current = getNearestCellIndex();

      let candidates = turnIndices.filter((index) => index > current + 1);
      let turnIndex;

      if (candidates.length > 0) {
        turnIndex = candidates[0];
      } else if (turnIndices.length > 0) {
        turnIndex = turnIndices[Math.floor(Math.random() * turnIndices.length)];
      } else {
        spawnApparition();
        return;
      }

      const targetIndex = Math.min(cells.length - 1, turnIndex + 1);
      const cell = cells[targetIndex];

      apparition.position.set(
        cell.x * CELL_SIZE + THREE.MathUtils.randFloatSpread(0.7),
        0,
        cell.z * CELL_SIZE + THREE.MathUtils.randFloatSpread(0.7)
      );

      apparition.scale.setScalar(1.0 + Math.random() * 0.25);
      apparition.visible = true;
      apparitionTimer = 0.8 + Math.random() * 0.7;
      apparition.lookAt(camera.position.x, 0, camera.position.z);

      playWhisper(0.11, 1.0, 900);
    }

    function spawnApparition() {
      if (apparition.visible) return;

      const current = getNearestCellIndex();
      const closeSpawn = Math.random() < 0.16;

      let x;
      let z;

      if (closeSpawn) {
        const cell = cells[current];
        const cx = cell.x * CELL_SIZE;
        const cz = cell.z * CELL_SIZE;

        x = THREE.MathUtils.clamp(
          camera.position.x + (Math.random() - 0.5) * 3.2,
          cx - CELL_SIZE / 2 + 0.4,
          cx + CELL_SIZE / 2 - 0.4
        );

        z = THREE.MathUtils.clamp(
          camera.position.z + (Math.random() - 0.5) * 3.2,
          cz - CELL_SIZE / 2 + 0.4,
          cz + CELL_SIZE / 2 - 0.4
        );
      } else {
        const ahead = Math.random() < 0.7;
        let index;

        if (ahead) {
          index = Math.min(cells.length - 1, current + 3 + Math.floor(Math.random() * 6));
        } else {
          index = Math.max(0, current - 3 - Math.floor(Math.random() * 5));
        }

        if (index === current && cells.length > 1) {
          index = Math.min(cells.length - 1, current + 1);
        }

        const cell = cells[index];
        x = cell.x * CELL_SIZE + THREE.MathUtils.randFloatSpread(1.4);
        z = cell.z * CELL_SIZE + THREE.MathUtils.randFloatSpread(1.4);
      }

      apparition.position.set(x, 0, z);
      apparition.scale.setScalar(0.9 + Math.random() * 0.45);
      apparition.visible = true;
      apparitionTimer = closeSpawn ? 0.12 + Math.random() * 0.1 : 0.35 + Math.random() * 0.8;
      apparition.lookAt(camera.position.x, 0, camera.position.z);

      if (closeSpawn) {
        playScare();
      } else {
      playWhisper(0.1, 0.8, 1800);
    }
    }

    function startRewind() {
      if (!controls.isLocked || rewind.active || falseEnd.active || rewindCooldown > 0) {
        return;
      }

      rewindCooldown = 6;

      if (history.length < 25) {
        pathRewind();
        return;
      }

      const secondsBack = 3.5 + Math.random() * 2.5;
      const samplesBack = Math.floor(secondsBack / HISTORY_INTERVAL);
      const targetIndex = Math.max(0, history.length - 1 - samplesBack);

      beginRewind(
        history[targetIndex].position,
        history[targetIndex].quaternion,
        targetIndex,
        0.85 + Math.min(1.2, samplesBack * 0.002)
      );
    }

    function pathRewind() {
      const current = getNearestCellIndex();
      const targetIndex = Math.max(0, current - 3);
      const cell = cells[targetIndex];

      const position = new THREE.Vector3(
        cell.x * CELL_SIZE,
        1.7,
        cell.z * CELL_SIZE
      );

      tempObject.position.copy(position);
      tempObject.lookAt(camera.position.x, 1.6, camera.position.z);

      beginRewind(
        position,
        tempObject.quaternion.clone(),
        -1,
        0.85
      );
    }

    function beginRewind(position, quaternion, targetIndex, duration) {
      rewind.fromPos.copy(camera.position);
      rewind.fromQuat.copy(camera.quaternion);
      rewind.toPos.copy(position);
      rewind.toQuat.copy(quaternion);

      rewind.active = true;
      rewind.time = 0;
      rewind.duration = Math.max(0.35, duration);
      rewind.targetIndex = targetIndex;

      document.body.classList.add('rewinding');
      rewindOverlay.style.opacity = 1;

      setVhsMode('REW');
      setInputEnabled(false);
      playRewindSound();
    }

    function updateRewind(delta) {
      rewind.time += delta;

      const t = Math.min(1, rewind.time / rewind.duration);
      const eased = t * t * (3 - 2 * t);

      camera.position.lerpVectors(rewind.fromPos, rewind.toPos, eased);
      camera.quaternion.copy(rewind.fromQuat);
      camera.quaternion.slerp(rewind.toQuat, eased);

      if (t >= 1) {
        finishRewind();
      }
    }

    function finishRewind() {
      rewind.active = false;

      document.body.classList.remove('rewinding');
      rewindOverlay.style.opacity = 0;

      setInputEnabled(true);

      if (rewind.targetIndex >= 0) {
        history = history.slice(0, rewind.targetIndex + 1);
      }

      endCooldown = Math.max(endCooldown, 1.0);
      setVhsMode('PLAY');
      showMessage('ПЕРЕМОТКА НАЗАД', 1200);
    }

    function cancelRewind(silent = false) {
      if (!rewind.active) return;

      rewind.active = false;
      document.body.classList.remove('rewinding');
      rewindOverlay.style.opacity = 0;
      setInputEnabled(true);

      if (!silent) {
        setVhsMode('PAUSE');
      }
    }

    function fastForward() {
      if (!controls.isLocked || falseEnd.active || rewind.active || ffCooldown > 0) {
        return;
      }

      ffCooldown = 7;

      const current = getNearestCellIndex();
      const targetIndex = Math.min(cells.length - 1, current + 2);
      const nextIndex = Math.min(cells.length - 1, targetIndex + 1);

      const cell = cells[targetIndex];
      const next = cells[nextIndex];

      camera.position.set(
        cell.x * CELL_SIZE,
        1.7,
        cell.z * CELL_SIZE
      );

      tempObject.position.copy(camera.position);

      if (nextIndex === targetIndex) {
        tempObject.lookAt(endTarget.x, endTarget.y, endTarget.z);
      } else {
        tempObject.lookAt(next.x * CELL_SIZE, 1.6, next.z * CELL_SIZE);
      }

      camera.quaternion.copy(tempObject.quaternion);

      history = [];
      historyTimer = 0;
      endCooldown = 2;

      hardGlitch(180);
      playStaticBurst();
      showMessage('ПЕРЕМОТКА ВПЕРЁД ПОВРЕЖДАЕТ ПЛЁНКУ');

      setVhsMode('FF');

      setTimeout(() => {
        if (controls.isLocked && currentVhsMode === 'FF') {
          setVhsMode('PLAY');
        }
      }, 900);
    }

    function startFalseEnd() {
      if (falseEnd.active || rewind.active) return;

      falseEnd.active = true;
      falseEnd.time = 0;
      falseEnd.phase = 0;

      velocity.set(0, 0, 0);

      setInputEnabled(false);
      setVhsMode('STOP');

      blackout.style.opacity = 1;
      blackoutText.textContent = 'ЗАПИСЬ ЗАКОНЧИЛАСЬ';

      playStaticBurst();
    }

    function updateFalseEnd(delta) {
      falseEnd.time += delta;

      if (falseEnd.phase === 0 && falseEnd.time > 1.7) {
        falseEnd.phase = 1;
        blackoutText.textContent = '...';
      } else if (falseEnd.phase === 1 && falseEnd.time > 3.1) {
        falseEnd.phase = 2;
        blackoutText.textContent = 'НЕТ';
        hardGlitch(180);
        playScare();
      } else if (falseEnd.phase === 2 && falseEnd.time > 4.3) {
        falseEnd.phase = 3;
        blackoutText.textContent = 'ПОВТОРНЫЙ ПРОСМОТР';
      } else if (falseEnd.phase === 3 && falseEnd.time > 5.4) {
        falseEnd.active = false;
        blackout.style.opacity = 0;

        setInputEnabled(true);
        nextLoop(true);
        setVhsMode('PLAY');
      }
    }

    function cancelFalseEnd(silent = false) {
      if (!falseEnd.active) return;

      falseEnd.active = false;
      blackout.style.opacity = 0;

      setInputEnabled(true);
      endCooldown = 2;

      if (!silent) {
        setVhsMode('PAUSE');
      }
    }

    function flickerLights(elapsed) {
      for (const item of lights) {
        item.flickerUntil = elapsed + 0.25 + Math.random() * 1.1;
      }

      if (Math.random() < 0.35) playWhisper(0.055, 0.6, 700);
    }

    function lightsOut(elapsed) {
      const duration = 0.45 + Math.random() * 1.3;

      for (const item of lights) {
        item.offUntil = elapsed + duration;
      }

      playWhisper(0.08, 0.8, 400);
    }

    function signalLoss(duration = 450) {
      blackoutText.textContent = Math.random() < 0.5 ? 'СИГНАЛ ПОТЕРЯН' : 'НЕТ СИГНАЛА';
      blackout.style.opacity = 1;

      hardGlitch(80);

      setTimeout(() => {
        if (!falseEnd.active) {
          blackout.style.opacity = 0;
        }
      }, duration + Math.random() * 500);

      playStaticBurst();
    }

    function hardGlitch(duration = 130) {
      if (glitchTimeout) clearTimeout(glitchTimeout);

      document.body.classList.add('glitch');
      glitchOverlay.style.opacity = 0.5;
      cameraGlitch = 0.05;

      glitchTimeout = setTimeout(() => {
        document.body.classList.remove('glitch');
        glitchOverlay.style.opacity = 0;
        cameraGlitch = 0;
      }, duration);

      playGlitchSound();
    }

    function nextLoop(silent = false) {
      loop++;
      hud.textContent = 'ПОВТОР: ' + loop;

      if (!silent) {
        if (loop === 1) {
          showMessage('ПОВТОРНЫЙ ПРОСМОТР НАЧАТ', 2600);
        } else {
          showMessage(`КОПИЯ ${loop} / ОШИБКА ЦИКЛА`, 2600);
        }

        playScare();
      }

      resetToStart();

      scene.fog.density = Math.min(0.12, 0.09 + loop * 0.004);
      scene.fog.color.setRGB(
        0.004 + Math.min(0.022, loop * 0.004),
        0.001,
        0.002
      );
      scene.background.copy(scene.fog.color);

      eventTimer = 1.0;
      tapeSeconds = 0;

      if (Math.random() < 0.6 && flashlightOn) {
        flashOffUntil = clock.elapsedTime + 0.22;
      }

      const working = lights.filter((item) => !item.broken);

      if (working.length > Math.ceil(lights.length * 0.35)) {
        const victim = working[Math.floor(Math.random() * working.length)];
        victim.broken = true;
        victim.light.intensity = 0;
        victim.bulb.material.color.setHex(0x161616);
      }

      noiseCanvas.style.opacity = Math.min(0.3, 0.13 + loop * 0.022);
      scanlinesEl.style.opacity = Math.min(0.55, 0.3 + loop * 0.045);
    }

    function showMessage(text, duration = 1800) {
      if (Math.random() < 0.24) {
        text = corruptText(text);
      }

      message.textContent = text;
      message.style.opacity = 1;

      if (messageTimeout) clearTimeout(messageTimeout);

      messageTimeout = setTimeout(() => {
        message.style.opacity = 0;
      }, duration);
    }

    function showMessageRandom() {
      const text = scaryMessages[Math.floor(Math.random() * scaryMessages.length)];
      showMessage(text);
    }

    function corruptText(text) {
      const badChars = '▓▒░#%&@$Ø×?!';
      return text
        .split('')
        .map((char) => {
          if (Math.random() < 0.16) {
            return badChars[Math.floor(Math.random() * badChars.length)];
          }
          return char;
        })
        .join('');
    }

    function startNoise() {
      setInterval(() => {
        const w = noiseCanvas.width;
        const h = noiseCanvas.height;

        noiseCtx.clearRect(0, 0, w, h);

        for (let i = 0; i < 160; i++) {
          const value = Math.floor(Math.random() * 255);
          noiseCtx.fillStyle = `rgba(${value},${value},${value},${Math.random() * 0.24})`;
          noiseCtx.fillRect(
            Math.random() * w,
            Math.random() * h,
            Math.random() * 2 + 1,
            Math.random() * 2 + 1
          );
        }

        if (Math.random() < 0.08) {
          noiseCtx.fillStyle = 'rgba(255,255,255,0.12)';
          noiseCtx.fillRect(0, Math.random() * h, w, Math.random() * 3 + 1);
        }
      }, 70);
    }

    function startFakeClock() {
      setInterval(() => {
        fakeTime.setSeconds(fakeTime.getSeconds() + 1);

        const text =
          `REC ● 03:14:1997 ${pad(fakeTime.getHours())}:${pad(fakeTime.getMinutes())}:${pad(fakeTime.getSeconds())}`;

        if (Math.random() < 0.04) {
          timestampEl.textContent = corruptText(text);
        } else {
          timestampEl.textContent = text;
        }
      }, 1000);
    }

    function pad(value) {
      return String(value).padStart(2, '0');
    }

    function initAudio() {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        audioCtx = new AudioContextClass();

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.9;

        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 12;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.3;

        masterGain.connect(limiter);
        limiter.connect(audioCtx.destination);

        const impulseLength = Math.floor(audioCtx.sampleRate * 1.4);
        const impulse = audioCtx.createBuffer(2, impulseLength, audioCtx.sampleRate);

        for (let ch = 0; ch < 2; ch++) {
          const data = impulse.getChannelData(ch);

          for (let i = 0; i < impulseLength; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 3.2);
          }
        }

        const reverb = audioCtx.createConvolver();
        reverb.buffer = impulse;

        const reverbGain = audioCtx.createGain();
        reverbGain.gain.value = 0.2;

        masterGain.connect(reverb);
        reverb.connect(reverbGain);
        reverbGain.connect(limiter);

        startAmbient();
      }

      if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function startAmbient() {
      const osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 32;

      const osc2 = audioCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 49;

      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.07;

      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 35;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 170;
      filter.Q.value = 0.8;

      const droneGain = audioCtx.createGain();
      droneGain.gain.value = 0.065;

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(droneGain);
      droneGain.connect(masterGain);

      osc1.start();
      osc2.start();
      lfo.start();

      const bufferLength = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferLength, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);

      let last = 0;

      for (let i = 0; i < bufferLength; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = 280;

      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0.05;

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);

      noise.start();

      humGain = audioCtx.createGain();
      humGain.gain.value = 0;

      const hum1 = audioCtx.createOscillator();
      hum1.type = 'sine';
      hum1.frequency.value = 50;
      hum1.connect(humGain);

      const hum2 = audioCtx.createOscillator();
      hum2.type = 'sine';
      hum2.frequency.value = 100;

      const hum2Level = audioCtx.createGain();
      hum2Level.gain.value = 0.35;

      hum2.connect(hum2Level);
      hum2Level.connect(humGain);
      humGain.connect(masterGain);

      hum1.start();
      hum2.start();
    }

    function playClick() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 800;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.06);
    }

    function playFootstep() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      stepSide *= -1;
      const pan = stepSide * (0.08 + Math.random() * 0.06);

      const thumpSrc = audioCtx.createBufferSource();
      thumpSrc.buffer = makeNoiseBuffer(0.075, 2.4);

      const thumpFilter = audioCtx.createBiquadFilter();
      thumpFilter.type = 'lowpass';
      thumpFilter.frequency.value = 140 + Math.random() * 130;

      const thumpGain = audioCtx.createGain();
      thumpGain.gain.value = 0.09 + Math.random() * 0.03;

      thumpSrc.connect(thumpFilter);
      thumpFilter.connect(thumpGain);
      connectOutput(thumpGain, pan);
      thumpSrc.start(t);

      const scuffSrc = audioCtx.createBufferSource();
      scuffSrc.buffer = makeNoiseBuffer(0.15, 3.2);

      const scuffFilter = audioCtx.createBiquadFilter();
      scuffFilter.type = 'bandpass';
      scuffFilter.frequency.value = 650 + Math.random() * 900;
      scuffFilter.Q.value = 0.8;

      const scuffGain = audioCtx.createGain();
      scuffGain.gain.value = 0.02 + Math.random() * 0.01;

      scuffSrc.connect(scuffFilter);
      scuffFilter.connect(scuffGain);
      connectOutput(scuffGain, pan * 1.4);
      scuffSrc.start(t);
    }

    function playWhisper(volume = 0.12, duration = 1.1, frequency = 1200) {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const dur = duration + Math.random() * 0.5;

      const buffer = audioCtx.createBuffer(
        1,
        Math.floor(audioCtx.sampleRate * dur),
        audioCtx.sampleRate
      );

      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const envelope = Math.pow(Math.sin((Math.PI * i) / data.length), 2);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.45;
      }

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = frequency + Math.random() * 700;
      bandpass.Q.value = 10;

      const wobble = audioCtx.createOscillator();
      wobble.frequency.value = 2.5 + Math.random() * 4;

      const wobbleGain = audioCtx.createGain();
      wobbleGain.gain.value = frequency * 0.4;

      wobble.connect(wobbleGain);
      wobbleGain.connect(bandpass.frequency);

      const gain = audioCtx.createGain();
      gain.gain.value = volume;

      let output = gain;

      source.connect(bandpass);
      bandpass.connect(gain);

      if (audioCtx.createStereoPanner) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = Math.random() * 2 - 1;
        gain.connect(panner);
        output = panner;
      }

      output.connect(masterGain);
      source.start(t);
      wobble.start(t);
      wobble.stop(t + dur + 0.1);
    }

    function playHeartbeat(volume = 0.22) {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      for (let i = 0; i < 2; i++) {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 50 + Math.random() * 10;

        const gain = audioCtx.createGain();
        const start = t + i * 0.35;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume * (i === 0 ? 1 : 0.8), start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(start);
        osc.stop(start + 0.3);
      }
    }

    function playCreak() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(65, t);
      osc.frequency.linearRampToValueAtTime(35, t + 0.7);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 240;
      filter.Q.value = 8;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.055, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.9);
    }

    function playTapeWarble() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);

      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 7;

      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 35;

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      lfo.start(t);
      osc.stop(t + 1.3);
      lfo.stop(t + 1.3);
    }

    function playRewindSound() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(750, t + 0.25);
      osc.frequency.linearRampToValueAtTime(220, t + 0.6);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 1.2;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.75);

      const noiseDuration = 0.5;
      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.floor(audioCtx.sampleRate * noiseDuration),
        audioCtx.sampleRate
      );

      const noiseData = noiseBuffer.getChannelData(0);

      for (let i = 0; i < noiseData.length; i++) {
        const fade = Math.pow(1 - i / noiseData.length, 1.4);
        noiseData[i] = (Math.random() * 2 - 1) * fade * 0.4;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 800;

      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0.08;

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);

      noise.start(t);
    }

    function playStaticBurst() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const duration = 0.22;

      const buffer = audioCtx.createBuffer(
        1,
        Math.floor(audioCtx.sampleRate * duration),
        audioCtx.sampleRate
      );

      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const fade = Math.pow(1 - i / data.length, 1.6);
        data[i] = (Math.random() * 2 - 1) * fade;
      }

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      const gain = audioCtx.createGain();
      gain.gain.value = 0.28;

      source.connect(gain);
      gain.connect(masterGain);

      source.start(t);
    }

    function playGlitchSound() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      for (let i = 0; i < 3; i++) {
        const osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(100 + Math.random() * 900, t + i * 0.035);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, t + i * 0.035);
        gain.gain.exponentialRampToValueAtTime(0.08, t + i * 0.035 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.035 + 0.07);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t + i * 0.035);
        osc.stop(t + i * 0.035 + 0.09);
      }
    }

    function playScare() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(22, t + 0.8);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 1);

      for (const base of [640, 890, 1240]) {
        const shriek = audioCtx.createOscillator();
        shriek.type = 'sawtooth';
        shriek.frequency.setValueAtTime(base * (1 + (Math.random() - 0.5) * 0.06), t);
        shriek.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.7);

        const shriekFilter = audioCtx.createBiquadFilter();
        shriekFilter.type = 'bandpass';
        shriekFilter.frequency.value = base * 1.1;
        shriekFilter.Q.value = 2.5;

        const shriekGain = audioCtx.createGain();
        shriekGain.gain.setValueAtTime(0.0001, t);
        shriekGain.gain.exponentialRampToValueAtTime(0.09, t + 0.025);
        shriekGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + Math.random() * 0.2);

        shriek.connect(shriekFilter);
        shriekFilter.connect(shriekGain);
        shriekGain.connect(masterGain);

        shriek.start(t);
        shriek.stop(t + 0.9);
      }

      const noiseDuration = 0.35;
      const noiseBuffer = audioCtx.createBuffer(
        1,
        Math.floor(audioCtx.sampleRate * noiseDuration),
        audioCtx.sampleRate
      );

      const noiseData = noiseBuffer.getChannelData(0);

      for (let i = 0; i < noiseData.length; i++) {
        const fade = Math.pow(1 - i / noiseData.length, 2);
        noiseData[i] = (Math.random() * 2 - 1) * fade;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0.42;

      noise.connect(noiseGain);
      noiseGain.connect(masterGain);

      noise.start(t);
    }

    function makeNoiseBuffer(duration, decayPower) {
      const length = Math.floor(audioCtx.sampleRate * duration);
      const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPower);
      }

      return buffer;
    }

    function connectOutput(node, pan = 0) {
      if (audioCtx.createStereoPanner && pan !== 0) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        node.connect(panner);
        panner.connect(masterGain);
      } else {
        node.connect(masterGain);
      }
    }

    function playDistantClang() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const base = 65 + Math.random() * 90;
      const pan = (Math.random() * 2 - 1) * 0.85;

      for (const [mult, level, decay] of [[1, 0.085, 1.7], [2.76, 0.038, 0.9], [5.4, 0.022, 0.5]]) {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = base * mult;

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

        osc.connect(gain);
        connectOutput(gain, pan);

        osc.start(t);
        osc.stop(t + decay + 0.1);
      }
    }

    function playPA() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const bed = audioCtx.createOscillator();
      bed.type = 'sine';
      bed.frequency.value = 440;

      const bedGain = audioCtx.createGain();
      bedGain.gain.setValueAtTime(0.0001, t);
      bedGain.gain.linearRampToValueAtTime(0.012, t + 0.3);
      bedGain.gain.setValueAtTime(0.012, t + 2.0);
      bedGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);

      bed.connect(bedGain);
      connectOutput(bedGain, (Math.random() * 2 - 1) * 0.6);

      bed.start(t);
      bed.stop(t + 2.5);

      let cursor = t + 0.25;
      const bursts = 4 + Math.floor(Math.random() * 4);

      for (let i = 0; i < bursts; i++) {
        const src = audioCtx.createBufferSource();
        src.buffer = makeNoiseBuffer(0.05 + Math.random() * 0.13, 1.2);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 650 + Math.random() * 1100;
        filter.Q.value = 4;

        const gain = audioCtx.createGain();
        gain.gain.value = 0.05 + Math.random() * 0.03;

        src.connect(filter);
        filter.connect(gain);
        connectOutput(gain, (Math.random() * 2 - 1) * 0.5);

        src.start(cursor);
        cursor += 0.12 + Math.random() * 0.25;
      }
    }

    function playBreath(scale = 1) {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const length = Math.floor(audioCtx.sampleRate * 1.3);
      const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const src = audioCtx.createBufferSource();
      src.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(380, t);
      filter.frequency.linearRampToValueAtTime(560, t + 0.4);
      filter.frequency.linearRampToValueAtTime(320, t + 1.2);
      filter.Q.value = 0.6;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.07 * scale, t + 0.38);
      gain.gain.linearRampToValueAtTime(0.02 * scale, t + 0.55);
      gain.gain.linearRampToValueAtTime(0.08 * scale, t + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.28);

      src.connect(filter);
      filter.connect(gain);
      connectOutput(gain, (Math.random() * 2 - 1) * 0.4);

      src.start(t);
    }

    function playWhirr() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const src = audioCtx.createBufferSource();
      src.buffer = makeNoiseBuffer(0.55, 1.1);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);

      const flutter = audioCtx.createOscillator();
      flutter.frequency.value = 11;

      const flutterGain = audioCtx.createGain();
      flutterGain.gain.value = 220;

      flutter.connect(flutterGain);
      flutterGain.connect(filter.frequency);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      src.start(t);
      flutter.start(t);
      flutter.stop(t + 0.65);
    }

    function playDoorKnock() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      for (let i = 0; i < 3; i++) {
        const start = t + i * 0.38 + Math.random() * 0.04;

        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(70, start);
        osc.frequency.exponentialRampToValueAtTime(42, start + 0.16);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.3, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(start);
        osc.stop(start + 0.25);

        const src = audioCtx.createBufferSource();
        src.buffer = makeNoiseBuffer(0.06, 2);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 260;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0.14;

        src.connect(filter);
        filter.connect(noiseGain);
        connectOutput(noiseGain, (Math.random() - 0.5) * 0.3);
        src.start(start);
      }
    }

    function playSkitter() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      let cursor = t;
      const bursts = 9 + Math.floor(Math.random() * 5);

      for (let i = 0; i < bursts; i++) {
        const src = audioCtx.createBufferSource();
        src.buffer = makeNoiseBuffer(0.03, 1.5);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1400 + Math.random() * 800;

        const gain = audioCtx.createGain();
        gain.gain.value = 0.05 + Math.random() * 0.03;

        src.connect(filter);
        filter.connect(gain);
        connectOutput(gain, (Math.random() * 2 - 1) * 0.5);
        src.start(cursor);

        cursor += 0.025 + Math.random() * 0.07;
      }
    }

    function playFootstepsBehind() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const count = 2 + Math.floor(Math.random() * 2);
      const side = Math.random() < 0.5 ? -1 : 1;
      let cursor = t + 0.15;

      for (let i = 0; i < count; i++) {
        const src = audioCtx.createBufferSource();
        src.buffer = makeNoiseBuffer(0.09, 2);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 220 + Math.random() * 120;

        const gain = audioCtx.createGain();
        gain.gain.value = 0.075 + Math.random() * 0.025;

        src.connect(filter);
        filter.connect(gain);
        connectOutput(gain, side * (i % 2 ? -0.5 : 0.5));
        src.start(cursor);

        cursor += 0.42 + Math.random() * 0.12;
      }
    }

    function playDrip() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900 + Math.random() * 700, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.07);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

      osc.connect(gain);
      connectOutput(gain, (Math.random() * 2 - 1) * 0.8);
      osc.start(t);
      osc.stop(t + 0.1);
    }

    function playDistantScream() {
      if (!audioCtx) return;

      const t = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600 + Math.random() * 200, t);
      osc.frequency.linearRampToValueAtTime(1300 + Math.random() * 300, t + 0.25);
      osc.frequency.linearRampToValueAtTime(400, t + 1.1);

      const vibrato = audioCtx.createOscillator();
      vibrato.frequency.value = 8;

      const vibratoGain = audioCtx.createGain();
      vibratoGain.gain.value = 30;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 950;
      filter.Q.value = 2.5;

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

      osc.connect(filter);
      filter.connect(gain);
      connectOutput(gain, (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.3));

      osc.start(t);
      vibrato.start(t);
      osc.stop(t + 1.3);
      vibrato.stop(t + 1.3);
    }
