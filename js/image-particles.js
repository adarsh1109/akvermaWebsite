/* Smooth, directional sand-particle rendering for the existing About portraits.
   The original img elements retain their exact layout boxes; canvases are overlays only. */
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: -1e5, y: -1e5, vx: 0, vy: 0, active: false, last: 0 };
  const fields = [];
  const imageCache = new Map();
  const MAX_PARTICLES = 130000; // denser sampling while keeping canvas work bounded

  function loadImage(src) {
    if (!imageCache.has(src)) imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    }));
    return imageCache.get(src);
  }

  function sample(image, width, height) {
    // Preserve the source image's intrinsic aspect ratio. The canvas remains an
    // exact overlay of the existing image element, but particle coordinates are
    // sampled from a uniformly scaled image (never stretched to the box).
    const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawW = image.naturalWidth * fit;
    const drawH = image.naturalHeight * fit;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;
    const scale = Math.min(1, 900 / Math.max(drawW, drawH));
    const sw = Math.max(1, Math.round(drawW * scale));
    const sh = Math.max(1, Math.round(drawH * scale));
    const source = document.createElement('canvas');
    source.width = sw; source.height = sh;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(image, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh).data;
    // Choose sampling interval from the available pixel area, not a subpixel loop.
    // This prevents hundreds of thousands of redundant particles and browser hangs.
    const stride = Math.max(0.9, Math.sqrt((sw * sh) / MAX_PARTICLES));
    const points = [];
    for (let yy = stride * .5; yy < sh; yy += stride) {
      for (let xx = stride * .5; xx < sw; xx += stride) {
        const x = Math.min(sw - 1, Math.floor(xx));
        const y = Math.min(sh - 1, Math.floor(yy));
        const i = (y * sw + x) * 4;
        if (data[i + 3] < 20) continue;
        const lum = (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114) / 255;
        // Slightly brighten low-contrast samples while preserving source colour.
        const brighten = 1.13;
        points.push({
          ox: offsetX + xx / sw * drawW, oy: offsetY + yy / sh * drawH,
          x: offsetX + xx / sw * drawW, y: offsetY + yy / sh * drawH, vx: 0, vy: 0,
          r: .34 + Math.random() * .13 + (1 - lum) * .035,
          color: `rgb(${Math.min(255, Math.round(data[i] * brighten))},${Math.min(255, Math.round(data[i + 1] * brighten))},${Math.min(255, Math.round(data[i + 2] * brighten))})`,
          alpha: .96 + Math.random() * .04,
          phase: Math.random() * Math.PI * 2,
          seed: Math.random()
        });
      }
    }
    return points;
  }

  function position(field, rect) {
    field.canvas.style.left = `${rect.left + window.scrollX}px`;
    field.canvas.style.top = `${rect.top + window.scrollY}px`;
    field.canvas.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
  }

  function install(img) {
    if (img.dataset.particleReady) return;
    img.dataset.particleReady = '1';
    const canvas = document.createElement('canvas');
    canvas.className = 'particle-image-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    // Keep the original image in layout; only hide its pixels, never reposition it.
    img.style.setProperty('opacity', '0', 'important');
    img.style.setProperty('transition', 'none', 'important');
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    const field = { img, canvas, ctx, points: [], dust: [], ready: false, width: 0, height: 0, rebuild: null, dustClock: 0 };
    fields.push(field);
    loadImage(img.currentSrc || img.src).then(source => {
      field.rebuild = () => {
        const rect = img.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        field.width = rect.width; field.height = rect.height; field.dpr = dpr;
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        field.points = sample(source, rect.width, rect.height);
        field.dust = []; field.dustClock = 0; field.ready = true;
        position(field, rect);
      };
      field.rebuild();
    }).catch(() => { img.style.removeProperty('opacity'); });
  }

  function init() { document.querySelectorAll('.about_img img').forEach(install); }

  function animate(now) {
    const dt = Math.min(1.8, Math.max(.55, (now - (animate.last || now)) / 16.67));
    animate.last = now;
    const speed = Math.hypot(pointer.vx, pointer.vy);
    const dirX = speed > .12 ? pointer.vx / speed : 0;
    const dirY = speed > .12 ? pointer.vy / speed : 0;

    for (const f of fields) {
      if (!f.ready) continue;
      const rect = f.img.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (Math.abs(f.width - rect.width) > 1 || Math.abs(f.height - rect.height) > 1) f.rebuild?.();
      position(f, rect);
      const { ctx, points } = f;
      ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // A short-lived plume is emitted behind a moving cursor. It is independent of
      // the image-forming grains, so particles can float away without leaving holes.
      if (pointer.active && !reducedMotion && speed > 1.2) {
        const lx = pointer.x - rect.left, ly = pointer.y - rect.top;
        if (lx > 0 && ly > 0 && lx < rect.width && ly < rect.height) {
          f.dustClock += dt;
          if (f.dustClock >= .7) {
            f.dustClock = 0;
            const amount = 2 + (Math.random() * 3 | 0);
            for (let k = 0; k < amount; k++) {
              const sourcePoint = points[(Math.random() * points.length) | 0];
              f.dust.push({
                x: lx - dirX * (3 + Math.random() * 8) + (Math.random() - .5) * 10,
                y: ly - dirY * (3 + Math.random() * 8) + (Math.random() - .5) * 10,
                vx: dirX * (1.1 + Math.random() * 1.8) + (Math.random() - .5) * 1.1,
                vy: dirY * (1.1 + Math.random() * 1.8) + (Math.random() - .5) * 1.1,
                r: .25 + Math.random() * .35, color: sourcePoint?.color || '#aaa',
                alpha: .45 + Math.random() * .5, age: 0, maxAge: 35 + Math.random() * 40
              });
            }
          }
        }
      }

      for (const p of points) {
        let ax = 0, ay = 0;
        const sx = rect.left + p.x, sy = rect.top + p.y;
        if (pointer.active && !reducedMotion) {
          const dx = sx - pointer.x, dy = sy - pointer.y;
          const dist = Math.hypot(dx, dy);
          const radius = 100;
          if (dist < radius) {
            const influence = (1 - dist / radius) ** 1.65;
            // Smooth, individually varied advection. Avoid a shared lateral
            // shear vector, which made visible parallel streaks/lines in the image.
            // Each grain receives a slightly different cross-flow based on its seed.
            const motion = Math.min(speed, 18);
            const grainPhase = p.seed * Math.PI * 2;
            const crossFlow = Math.sin(grainPhase + now * .0018) * .035;
            ax += dirX * motion * .043 * influence - dirY * crossFlow * influence;
            ay += dirY * motion * .043 * influence + dirX * crossFlow * influence;
            // Very small local cohesion keeps the image filled without forming a void.
            ax += dx * .00012 * influence;
            ay += dy * .00012 * influence;
          }
        }
        // Small spring and strong damping make motion smooth and settle promptly,
        // rather than looking frozen or leaving broken white patches.
        p.vx = (p.vx + ax * dt + (p.ox - p.x) * .012 * dt) * Math.pow(.86, dt);
        p.vy = (p.vy + ay * dt + (p.oy - p.y) * .012 * dt) * Math.pow(.86, dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        // Tiny squares are substantially cheaper than beginPath/arc/fill per grain.
        const size = p.r * 2;
        ctx.fillRect(p.x - p.r, p.y - p.r, size, size);
      }

      for (let i = f.dust.length - 1; i >= 0; i--) {
        const d = f.dust[i];
        d.age += dt;
        d.vx = d.vx * .99 + dirX * .015;
        d.vy = d.vy * .99 + dirY * .015;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.age >= d.maxAge || d.x < -4 || d.y < -4 || d.x > rect.width + 4 || d.y > rect.height + 4) {
          f.dust.splice(i, 1); continue;
        }
        ctx.globalAlpha = d.alpha * Math.max(0, 1 - d.age / d.maxAge);
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x, d.y, d.r * 2, d.r * 2);
      }
      ctx.globalAlpha = 1;
    }
    // Preserve momentum briefly, then decay without leaving the image in a displaced state.
    pointer.vx *= .90; pointer.vy *= .90;
    requestAnimationFrame(animate);
  }

  window.addEventListener('pointermove', e => {
    const t = performance.now();
    const oldX = pointer.x, oldY = pointer.y;
    const elapsed = Math.max(8, t - (pointer.last || t - 16));
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.vx = pointer.last ? (pointer.x - oldX) / elapsed * 16 : 0;
    pointer.vy = pointer.last ? (pointer.y - oldY) / elapsed * 16 : 0;
    pointer.last = t; pointer.active = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.active = false; }, { passive: true });
  window.addEventListener('scroll', () => {
    for (const f of fields) if (f.ready) position(f, f.img.getBoundingClientRect());
  }, { passive: true });
  window.addEventListener('resize', () => fields.forEach(f => f.rebuild?.()), { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init(); requestAnimationFrame(animate); });
  else { init(); requestAnimationFrame(animate); }
})();
