/* Донаты: две маленькие three.js-сцены (карта и монета Monero). */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function scene(canvasId, build, animate) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true }); }
    catch (e) { return; } // нет WebGL — просто пустой фон
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    var sc = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    cam.position.set(0, 0.6, 6);
    cam.lookAt(0, 0, 0);
    sc.add(new THREE.AmbientLight(0x6060a0, 0.7));
    var key = new THREE.DirectionalLight(0xd8ffb0, 1.3); key.position.set(3, 5, 4); sc.add(key);
    var rim = new THREE.DirectionalLight(0x8b7bff, 1.1); rim.position.set(-4, -2, -3); sc.add(rim);
    var obj = build();
    sc.add(obj);

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    var visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(canvas);
    }
    function loop(t) {
      if (visible) { animate(obj, t); renderer.render(sc, cam); }
      if (!reduced) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  scene('card-scene', function () {
    var W = 3.375, H = 2.125, R = 0.16, s = new THREE.Shape();
    s.moveTo(-W / 2 + R, -H / 2); s.lineTo(W / 2 - R, -H / 2); s.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + R);
    s.lineTo(W / 2, H / 2 - R); s.quadraticCurveTo(W / 2, H / 2, W / 2 - R, H / 2);
    s.lineTo(-W / 2 + R, H / 2); s.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - R);
    s.lineTo(-W / 2, -H / 2 + R); s.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + R, -H / 2);
    var geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 });
    geo.center();
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x1b1d26, shininess: 90, specular: 0x8b7bff })));
    var chip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.03), new THREE.MeshPhongMaterial({ color: 0xc8ff4d, shininess: 150, specular: 0xffffff }));
    chip.position.set(-0.95, 0.3, 0.07);
    g.add(chip);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.18, 0.01), new THREE.MeshPhongMaterial({ color: 0x8b7bff, emissive: 0x2a2060 }));
    stripe.position.set(0, -0.55, 0.07);
    g.add(stripe);
    g.scale.setScalar(0.9);
    return g;
  }, function (g, t) {
    g.rotation.y = t * 0.0006;
    g.rotation.x = Math.sin(t * 0.001) * 0.15;
  });

  scene('coin-scene', function () {
    var g = new THREE.Group();
    var coin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.16, 64), new THREE.MeshPhongMaterial({ color: 0x15171f, shininess: 160, specular: 0xc8ff4d }));
    coin.rotation.x = Math.PI / 2;
    var ringMat = new THREE.MeshPhongMaterial({ color: 0xc8ff4d, emissive: 0x3a4a10, shininess: 200 });
    g.add(coin, new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.06, 16, 100), ringMat), new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 16, 100), ringMat));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), new THREE.MeshPhongMaterial({ color: 0x8b7bff, emissive: 0x4a3aa0 })));
    g.rotation.x = 0.35;
    return g;
  }, function (g, t) {
    g.rotation.y = t * 0.0009;
    g.rotation.z = Math.sin(t * 0.0008) * 0.1;
  });
})();
