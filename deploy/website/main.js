/* Scrub the first half, then let native playback finish the chapter at 1x. */
(() => {
  const viewport = document.querySelector('.chapters');
  const scenes = [...viewport.querySelectorAll('.scene')];
  const links = [...document.querySelectorAll('.chapter-nav a')];
  const next = document.querySelector('.next-chapter');
  const previous = document.querySelector('.previous-chapter');
  const nextLabel = next.querySelector('.next-label');
  const nextArrow = next.querySelector('.next-arrow');
  const navigation = document.querySelector('.chapter-nav');
  const skip = document.querySelector('.skip-intro');
  const replay = document.querySelector('.replay-intro');
  const film = document.querySelector('.opening-film');
  const video = document.querySelector('.opening-video');
  const idle = document.querySelector('.idle-video');
  const toggleIdle = document.querySelector('.toggle-idle');
  const films = [...document.querySelectorAll('.scroll-film')].map(element => ({element, video: element.querySelector('video'), progress: 0, loading: false}));
  for (const media of document.querySelectorAll('video[data-av1]')) {
    if (media.canPlayType('video/mp4; codecs="av01.0.08M.08"')) media.dataset.src = media.dataset.av1;
  }
  const openingCopy = document.querySelector('.scene-opening .scene-copy');
  const chapterCopies = scenes.slice(1).map(scene => scene.querySelector('.scene-copy'));
  const revealAt = 3.25; // The leap begins; the slogan resolves during the turn.
  const scrollFeel = {travel: 1.7, release: 100, boundaryRelease: 320, preview: .5, commit: .04, inputKnee: .06};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const palette = scenes.map(scene => {
    const hex = getComputedStyle(scene).getPropertyValue('--scene-color').trim();
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  });
  let current = 0, target = 0, clock, settle, videoFrame, introRun = 0;
  let colorFrame = 0;
  let gesture, releaseTimer, boundaryTimer, snapFrame = 0;
  let idlePaused = false, idleFailed = false;
  let jump, navigationRun = 0;
  let playback;
  function loadFilm(clip) {
    if (clip.loading) return;
    clip.loading = true;
    // Native Range loading makes the first frames usable before the full file arrives.
    clip.video.src = clip.video.dataset.src;
  }

  function seekFilm(clip) {
    const media = clip.video;
    if (reduce.matches || media.readyState < 2 || media.seeking || media.error || (playback?.clip === clip && playback.started)) return;
    const start = Number(media.dataset.start || 0);
    const end = Math.min(Number(media.dataset.end || media.duration), media.duration) - .002;
    const time = start + clip.progress * Math.max(0, end - start);
    // Short keyframe intervals keep random seeks inexpensive.
    if (Math.abs(media.currentTime - time) > .015) media.currentTime = time;
    else clip.element.dataset.ready = 'true';
  }

  function syncIdle() {
    const active = document.body.dataset.intro === 'ready' && !reduce.matches && !document.hidden && viewport.scrollTop < 1;
    toggleIdle.hidden = !active || idleFailed;
    if (!active || idlePaused || idleFailed) {idle.pause(); return;}
    if (!idle.getAttribute('src')) idle.src = idle.dataset.src;
    if (idle.paused) idle.play().catch(error => {
      if (error.name !== 'AbortError') {
        idleFailed = true;
        document.body.dataset.idle = 'hidden';
        toggleIdle.hidden = true;
      }
    });
  }

  function renderColor() {
    colorFrame = 0;
    const position = Math.max(0, Math.min(scenes.length - 1, viewport.scrollTop / viewport.clientHeight));
    const from = Math.floor(position), to = Math.min(from + 1, scenes.length - 1), mix = position - from;
    const color = palette[from].map((value, channel) => Math.round(value + (palette[to][channel] - value) * mix));
    document.body.style.backgroundColor = `rgb(${color.join(' ')})`;
    film.style.opacity = Math.max(0, Math.min(1, films.length + 1 - position));
    film.style.setProperty('--opening-shade-opacity', 1 - Math.max(0, Math.min(1, (position - 1) / .12)));
    films.forEach((clip, index) => {
      clip.progress = Math.max(0, Math.min(1, position - index));
      const enter = Number(clip.element.dataset.enterAt ?? index);
      clip.element.toggleAttribute('data-visible', position > enter && position < index + 2);
      clip.element.style.opacity = Math.max(0, Math.min(1, (position - enter) / Number(clip.element.dataset.blend || .12)));
      clip.element.toggleAttribute('data-hold', position <= Number(clip.element.dataset.holdUntil ?? -1));
      // Give the opening bandwidth first, then warm the active and approaching chapter.
      if (!reduce.matches && document.body.dataset.intro === 'ready' && index <= Math.floor(position + .65)) loadFilm(clip);
      seekFilm(clip);
    });
    const openingOpacity = Math.max(0, 1 - position / .1);
    openingCopy.style.opacity = openingOpacity;
    openingCopy.inert = openingOpacity === 0;
    openingCopy.setAttribute('aria-hidden', String(openingOpacity === 0));
    chapterCopies.forEach((copy, index) => {
      const scene = scenes[index + 1], progress = position - index;
      const opacity = Math.max(0, Math.min(1, (progress - .1) / .1)) * Math.max(0, Math.min(1, 1 - (progress - 1) / .1));
      copy.style.opacity = opacity;
      copy.style.transform = `translateY(${-Math.max(0, 1 - progress) * viewport.clientHeight}px)`;
      copy.setAttribute('aria-hidden', String(opacity === 0));
      copy.inert = opacity === 0;
      scene.classList.toggle('is-visible', opacity > 0);
    });
    // One continuous 0–1 scroll clock also provides the position for later frame animation.
    document.body.dataset.progress = (position / (scenes.length - 1)).toFixed(6);
    navigation.style.setProperty('--chapter-position', position);
    syncIdle();
  }
  function queueColor() {
    if (!colorFrame) colorFrame = requestAnimationFrame(renderColor);
  }

  function finishIntro() {
    clearTimeout(clock);
    if (videoFrame !== undefined) video.cancelVideoFrameCallback(videoFrame);
    video.pause();
    // Natural playback keeps the decoded final frame; skip/error uses its extracted still.
    if (!video.ended) {
      document.body.dataset.media = 'end';
      // Skipping the opening must also release its in-flight network request.
      if (video.getAttribute('src')) {video.removeAttribute('src'); video.load();}
    }
    document.body.dataset.intro = 'ready';
    viewport.inert = false;
    skip.hidden = true;
    document.querySelector('.create-link').hidden = false;
    replay.hidden = false;
    next.disabled = false;
    queueColor();
  }

  function revealCopy() {
    document.body.dataset.copy = 'visible';
    viewport.inert = false;
    // Warm the idle loop only after the entire opening has arrived, avoiding late-film stalls.
    if (!idle.getAttribute('src') && video.buffered.length && video.buffered.end(video.buffered.length - 1) >= video.duration - .05) idle.src = idle.dataset.src;
  }

  function select(index) {
    current = index;
    document.body.dataset.scene = scenes[index].id;
    document.body.dataset.ink = scenes[index].dataset.ink;
    links.forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    document.querySelector('.chapter-status').textContent = links[index].textContent.trim();
    previous.disabled = index === 0;
    previous.setAttribute('aria-label', index > 0 ? '返回' + links[index - 1].textContent.trim() : '上一章');
    nextLabel.textContent = index === scenes.length - 1 ? '回到开场' : '探索' + links[index + 1].textContent.trim();
    next.title = nextLabel.textContent;
    previous.title = previous.getAttribute('aria-label');
    nextArrow.textContent = index === scenes.length - 1 ? '↺' : '↓';
    if (index === target) links.forEach(link => {delete link.dataset.pending;});
  }

  function cancelSnap() {
    clearTimeout(releaseTimer);
    clearTimeout(boundaryTimer);
    cancelAnimationFrame(snapFrame);
    snapFrame = 0;
    if (playback) playback.clip.video.pause();
    playback = null;
    delete document.body.dataset.playback;
  }

  function waitForNextGesture() {
    clearTimeout(boundaryTimer);
    // ponytail: wheel has no release phase; a post-arrival quiet period closes the round.
    // A pause during the trip cannot release its endpoint.
    boundaryTimer = setTimeout(() => {if (gesture?.landed) gesture = null;}, scrollFeel.boundaryRelease);
  }

  function parkGesture(index) {
    snapFrame = 0;
    gesture.position = index;
    gesture.landed = true;
    select(index);
    history.replaceState(null, '', '#' + scenes[index].id);
    waitForNextGesture();
  }

  function playRemaining() {
    const clip = films[gesture.low], media = clip.video;
    const low = gesture.low, high = gesture.high;
    const run = playback = {clip, started: false};
    const waitingAt = performance.now();
    target = high;
    document.body.dataset.playback = 'waiting';
    function finish() {
      if (playback !== run) return;
      cancelSnap();
      viewport.scrollTo({top: scenes[high].offsetTop, behavior: 'instant'});
      parkGesture(high);
      queueColor();
    }
    function advance(now) {
      if (playback !== run) return;
      if (media.error || clip.element.dataset.error === 'true' || (!run.started && now - waitingAt > 15000)) {finish(); return;}
      if (!run.started) {
        seekFilm(clip);
        if (media.readyState >= 2 && !media.seeking) {
          run.started = true;
          document.body.dataset.playback = 'playing';
          media.playbackRate = 1;
          media.play().catch(finish);
        }
      } else {
        const start = Number(media.dataset.start || 0);
        const end = Math.min(Number(media.dataset.end || media.duration), media.duration) - .002;
        // The media clock drives the page, so buffering cannot speed up or skip the film.
        gesture.position = low + Math.max(0, Math.min(1, (media.currentTime - start) / (end - start)));
        viewport.scrollTo({top: gesture.position * viewport.clientHeight, behavior: 'instant'});
        if (media.currentTime >= end || media.ended) {finish(); return;}
      }
      snapFrame = requestAnimationFrame(advance);
    }
    advance(performance.now());
  }

  function settleGesture() {
    if (!gesture) return;
    const index = gesture.choice, start = viewport.scrollTop, end = scenes[index].offsetTop;
    const distance = end - start;
    target = index;
    if (reduce.matches || Math.abs(distance) < 1) {
      viewport.scrollTo({top: end, behavior: 'instant'});
      parkGesture(index);
      return;
    }
    if (index === gesture.high) {playRemaining(); return;}
    // Browsers do not support native reverse playback; seek backwards at the same 1x clock.
    const media = films[gesture.low].video;
    const seconds = Math.min(Number(media.dataset.end || media.duration || 5), media.duration || 5) - Number(media.dataset.start || 0);
    const duration = Math.max(120, Math.abs(distance) / viewport.clientHeight * seconds * 1000);
    const started = performance.now();
    snapFrame = requestAnimationFrame(function advance(now) {
      const t = Math.min(1, (now - started) / duration);
      viewport.scrollTo({top: start + distance * t, behavior: 'instant'});
      if (t < 1) snapFrame = requestAnimationFrame(advance);
      else parkGesture(index);
    });
  }

  function cancelNavigation() {
    navigationRun++;
    jump?.skipTransition();
    jump = null;
    links.forEach(link => {delete link.dataset.pending;});
  }

  function go(index, smooth = true) {
    finishIntro();
    cancelNavigation();
    cancelSnap();
    gesture = null;
    clearTimeout(settle);
    target = index;
    links[index].dataset.pending = 'true';
    // Direct navigation can skip chapters; only gestures must traverse their frames.
    const distance = Math.abs(viewport.scrollTop / viewport.clientHeight - index);
    if (distance < .001) {
      viewport.scrollTo({top: scenes[index].offsetTop, behavior: 'instant'});
      select(index);
      return;
    }
    if (smooth && !reduce.matches && distance > 1.25 && document.startViewTransition) {
      const run = navigationRun;
      jump = document.startViewTransition(() => {
        if (run !== navigationRun) return;
        films.forEach(clip => {delete clip.element.dataset.ready;});
        viewport.scrollTo({top: scenes[index].offsetTop, behavior: 'instant'});
        select(index);
        renderColor();
      });
      // Interrupting a visual transition rejects ready, while its DOM update may still run.
      jump.ready.catch(() => {});
      jump.finished.catch(() => {}).finally(() => {if (run === navigationRun) jump = null;});
      return;
    }
    viewport.scrollTo({top: scenes[index].offsetTop, behavior: smooth && !reduce.matches ? 'smooth' : 'instant'});
  }

  function step(direction) {
    const position = viewport.scrollTop / viewport.clientHeight;
    // Continue toward the requested chapter, but reverse from the visible position.
    const index = (target - position) * direction > .001 ? target + direction
      : direction > 0 ? Math.floor(position + .001) + 1 : Math.ceil(position - .001) - 1;
    go(Math.max(0, Math.min(scenes.length - 1, index)));
  }

  function startIntro() {
    const run = ++introRun;
    // The first opening is already at its anchor; don't briefly load its fallback poster.
    if (run > 1 || viewport.scrollTop || reduce.matches) go(0, false);
    select(0);
    history.replaceState(null, '', '#opening');
    idle.pause();
    document.body.dataset.idle = 'hidden';
    toggleIdle.hidden = true;
    if (reduce.matches) return;
    document.body.dataset.copy = 'hidden';
    document.body.dataset.media = 'start';
    document.body.dataset.intro = 'playing';
    viewport.inert = true;
    skip.hidden = false;
    replay.hidden = true;
    next.disabled = true;
    video.muted = true;
    if (!video.getAttribute('src')) video.src = video.dataset.src;
    idle.currentTime = 0;
    video.currentTime = 0;
    if (video.requestVideoFrameCallback) videoFrame = video.requestVideoFrameCallback(function followFrame(now, frame) {
      if (run !== introRun || document.body.dataset.intro !== 'playing') return;
      document.body.dataset.media = 'video';
      if (frame.mediaTime >= revealAt) revealCopy();
      else videoFrame = video.requestVideoFrameCallback(followFrame);
    });
    // A stalled load must not leave navigation locked indefinitely.
    clock = setTimeout(finishIntro, 20000);
    primeOpening();
  }

  function primeOpening() {
    if (document.body.dataset.intro !== 'playing' || reduce.matches || !video.buffered.length) return;
    const buffered = video.buffered.end(video.buffered.length - 1);
    // Browser canplaythrough can fire with < 1s cached; retain headroom for network variation.
    if (video.paused && buffered >= Math.min(2.5, video.duration) && video.readyState >= 2) {
      const run = introRun;
      video.play().catch(() => {if (run === introRun && document.body.dataset.intro === 'playing') finishIntro();});
    }
    if (buffered >= video.duration - .05) loadFilm(films[0]);
  }
  video.addEventListener('progress', primeOpening);
  video.addEventListener('loadeddata', primeOpening);
  video.addEventListener('seeked', primeOpening);
  video.addEventListener('ended', finishIntro);
  video.addEventListener('error', finishIntro);
  video.addEventListener('timeupdate', () => {
    if (!video.requestVideoFrameCallback && document.body.dataset.intro === 'playing' && video.currentTime >= revealAt) revealCopy();
  });
  video.addEventListener('playing', () => {
    if (!video.requestVideoFrameCallback && document.body.dataset.intro === 'playing') document.body.dataset.media = 'video';
  });
  idle.addEventListener('playing', () => {
    if (document.body.dataset.intro === 'ready' && !reduce.matches) {
      document.body.dataset.idle = 'visible';
      toggleIdle.hidden = false;
    }
  });
  toggleIdle.addEventListener('click', () => {
    idlePaused = !idlePaused;
    toggleIdle.setAttribute('aria-label', idlePaused ? '继续动态' : '暂停动态');
    toggleIdle.title = toggleIdle.getAttribute('aria-label');
    toggleIdle.setAttribute('aria-pressed', String(idlePaused));
    syncIdle();
  });
  films.forEach(clip => {
    clip.video.addEventListener('loadeddata', () => seekFilm(clip));
    clip.video.addEventListener('seeked', () => seekFilm(clip));
    clip.video.addEventListener('error', () => {delete clip.element.dataset.ready; clip.element.dataset.error = 'true';});
  });

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= .55) select(scenes.indexOf(entry.target));
  }, {root: viewport, threshold: [.55]});
  scenes.forEach(scene => observer.observe(scene));
  viewport.addEventListener('scroll', () => {
    queueColor();
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (snapFrame || Math.abs(viewport.scrollTop - scenes[current].offsetTop) >= 1) return;
      target = current;
      history.replaceState(null, '', '#' + scenes[current].id);
    }, 150);
  }, {passive: true});

  document.addEventListener('wheel', event => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (document.body.dataset.intro === 'playing') return;
    cancelNavigation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const distance = Math.abs(event.deltaY) * unit, direction = Math.sign(event.deltaY);
    const position = viewport.scrollTop / viewport.clientHeight;
    const anchor = Math.round(position), atAnchor = Math.abs(position - anchor) < .001;
    if (playback) {
      if (direction > 0) return; // Neither inertia nor a new forward stroke can accelerate the film.
      gesture.origin = gesture.high;
      gesture.position = position;
      gesture.previewEnd = gesture.high;
    }

    // The interval is fixed when a round begins; neither arrival nor an input gap can extend it.
    if (!gesture) {
      const low = Math.max(0, Math.min(scenes.length - 2, atAnchor ? anchor - (direction < 0 ? 1 : 0) : Math.floor(position)));
      const origin = atAnchor ? anchor : direction > 0 ? low : low + 1;
      gesture = {low, high: low + 1, origin, choice: origin, position, previewEnd: origin === low ? Math.max(low + scrollFeel.preview, position) : low + 1, landed: false};
    } else if (gesture.landed && ((direction > 0 && gesture.position === gesture.high) || (direction < 0 && gesture.position === gesture.low))) {
      waitForNextGesture();
      return; // Discard the rest of this round instead of passing it into another interval.
    } else if (gesture.landed) {
      gesture.origin = gesture.position;
      gesture.previewEnd = gesture.origin === gesture.low ? gesture.low + scrollFeel.preview : gesture.high;
    }
    if (snapFrame) gesture.position = position;
    cancelSnap();
    gesture.landed = false;
    const raw = distance / viewport.clientHeight / scrollFeel.travel, knee = scrollFeel.inputKnee;
    const movement = raw <= knee ? raw : knee + knee * Math.tanh((raw - knee) / knee);
    gesture.position = Math.max(gesture.low, Math.min(gesture.previewEnd, gesture.position + direction * movement));
    const moved = Math.abs(gesture.position - gesture.origin);
    gesture.choice = moved < scrollFeel.commit ? gesture.origin : gesture.origin === gesture.low ? gesture.high : gesture.low;
    target = gesture.choice;
    viewport.scrollTo({top: gesture.position * viewport.clientHeight, behavior: 'instant'});
    if (gesture.position === gesture.low || gesture.position === gesture.high) {
      parkGesture(gesture.position);
      return;
    }
    // Holding the gesture holds the half-way frame; release hands the remaining film to the decoder.
    releaseTimer = setTimeout(settleGesture, scrollFeel.release);
  }, {passive: false});

  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.classList.contains('skip-content')) {
      event.preventDefault();
      go(current, false);
      viewport.focus({preventScroll: true});
      return;
    }
    const index = scenes.findIndex(scene => '#' + scene.id === link.hash);
    if (index < 0) return;
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    go(index);
  }));
  function warmDestination(event) {
    const link = event.target.closest('a[href^="#"]');
    const index = scenes.findIndex(scene => '#' + scene.id === link?.hash);
    if (!reduce.matches && index > 0) loadFilm(films[index - 1]);
  }
  navigation.addEventListener('pointerover', warmDestination);
  navigation.addEventListener('focusin', warmDestination);
  window.addEventListener('popstate', () => {
    const index = scenes.findIndex(scene => '#' + scene.id === location.hash);
    go(Math.max(0, index));
  });
  skip.addEventListener('click', () => {finishIntro(); viewport.focus({preventScroll: true});});
  replay.addEventListener('click', startIntro);
  next.addEventListener('click', () => go(current === scenes.length - 1 ? 0 : current + 1));
  previous.addEventListener('click', () => go(Math.max(0, current - 1)));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable]')) return;
    if (event.key === 'Escape') {finishIntro(); viewport.focus({preventScroll: true}); return;}
    const delta = ['ArrowDown', 'PageDown'].includes(event.key) ? 1 : ['ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
    const space = event.key === ' ' && !event.target.closest('button,a');
    if (!delta && !space && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (document.body.dataset.intro === 'playing' || event.repeat) return;
    if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(scenes.length - 1);
    else step(space ? (event.shiftKey ? -1 : 1) : delta);
  });
  reduce.addEventListener('change', () => {
    if (reduce.matches) {
      go(target, false);
      idle.pause();
      document.body.dataset.idle = 'hidden';
      toggleIdle.hidden = true;
    } else {
      queueColor();
    }
    if (reduce.matches) films.forEach(clip => {delete clip.element.dataset.ready;});
  });
  document.addEventListener('visibilitychange', () => {
    syncIdle();
    if (playback?.started) {
      if (document.hidden) playback.clip.video.pause();
      else {
        const run = playback;
        run.clip.video.play().catch(() => {if (playback === run) go(target, false);});
      }
    }
  });
  window.addEventListener('resize', () => {if (document.body.dataset.intro === 'ready') go(target, false); queueColor();});
  window.addEventListener('pageshow', queueColor);
  window.addEventListener('pagehide', () => {if (gesture) go(gesture.choice, false); cancelNavigation(); cancelSnap(); finishIntro(); idle.pause(); clearTimeout(settle); cancelAnimationFrame(colorFrame); colorFrame = 0;});
  const initial = scenes.findIndex(scene => '#' + scene.id === location.hash);
  if (initial > 0) {go(initial, false); select(initial);}
  else startIntro();
  renderColor();
})();
