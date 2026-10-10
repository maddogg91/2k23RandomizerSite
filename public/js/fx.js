// Game-feel layer: synthesized basketball sound effects (Web Audio, no audio files), a mute
// toggle, and the reveal animations on the player page. Pages opt in with data attributes:
//   <form data-fx-submit="dribble|squeak|buzzer" data-fx-reveal> plays a sound (and an exit
//     animation for [data-fx-exit] targets) before submitting; data-fx-reveal marks the next
//     page load as a reveal.
//   [data-fx-count] counts a number up from 0.
//   <body data-fx-celebrate> on a player whose OVR is worth a celebration.
// Everything degrades quietly: muted, reduced motion, or a browser that blocks audio.
(function () {
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const storage = {
		get(key) {
			try {
				return window.localStorage.getItem(key);
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				window.localStorage.setItem(key, value);
			} catch {}
		},
	};
	const session = {
		take(key) {
			try {
				const value = window.sessionStorage.getItem(key);
				window.sessionStorage.removeItem(key);
				return value;
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				window.sessionStorage.setItem(key, value);
			} catch {}
		},
	};

	// ---- Sound ----

	let muted = storage.get('sfx') === 'off';
	let ctx = null;

	function audio() {
		if (muted) return null;
		if (!ctx) {
			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return null;
			ctx = new AudioCtx();
		}
		if (ctx.state === 'suspended') ctx.resume();
		return ctx;
	}

	function noiseBuffer(ac, seconds) {
		const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		return buffer;
	}

	function envelope(ac, at, peak, attack, decay) {
		const gain = ac.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
		gain.connect(ac.destination);
		return gain;
	}

	const sounds = {
		// Ball hitting hardwood: a fast pitch drop plus a tiny slap of noise.
		bounce(ac, at = ac.currentTime, level = 1) {
			const osc = ac.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(150, at);
			osc.frequency.exponentialRampToValueAtTime(48, at + 0.14);
			osc.connect(envelope(ac, at, 0.55 * level, 0.004, 0.16));
			osc.start(at);
			osc.stop(at + 0.2);

			const slap = ac.createBufferSource();
			slap.buffer = noiseBuffer(ac, 0.04);
			const lp = ac.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = 900;
			slap.connect(lp).connect(envelope(ac, at, 0.12 * level, 0.002, 0.03));
			slap.start(at);
		},
		// Two quick dribbles.
		dribble(ac) {
			const t = ac.currentTime;
			sounds.bounce(ac, t, 1);
			sounds.bounce(ac, t + 0.22, 0.8);
		},
		// Ball through the net: a band-passed noise sweep.
		swish(ac, at = ac.currentTime) {
			const src = ac.createBufferSource();
			src.buffer = noiseBuffer(ac, 0.5);
			const bp = ac.createBiquadFilter();
			bp.type = 'bandpass';
			bp.Q.value = 1.4;
			bp.frequency.setValueAtTime(3200, at);
			bp.frequency.exponentialRampToValueAtTime(700, at + 0.4);
			src.connect(bp).connect(envelope(ac, at, 0.35, 0.03, 0.4));
			src.start(at);
		},
		// Sneaker squeak: a high, wobbling tone.
		squeak(ac) {
			const t = ac.currentTime;
			const osc = ac.createOscillator();
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(1500, t);
			osc.frequency.linearRampToValueAtTime(2300, t + 0.07);
			osc.frequency.linearRampToValueAtTime(1900, t + 0.14);
			const wobble = ac.createOscillator();
			const depth = ac.createGain();
			wobble.frequency.value = 38;
			depth.gain.value = 120;
			wobble.connect(depth).connect(osc.frequency);
			osc.connect(envelope(ac, t, 0.12, 0.01, 0.15));
			osc.start(t);
			wobble.start(t);
			osc.stop(t + 0.2);
			wobble.stop(t + 0.2);
		},
		// End-of-quarter horn.
		buzzer(ac) {
			const t = ac.currentTime;
			const lp = ac.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.value = 1400;
			lp.connect(envelope(ac, t, 0.16, 0.02, 0.6));
			for (const freq of [196, 199.5]) {
				const osc = ac.createOscillator();
				osc.type = 'sawtooth';
				osc.frequency.value = freq;
				osc.connect(lp);
				osc.start(t);
				osc.stop(t + 0.65);
			}
		},
		// Crowd roar: a swelling wash of filtered noise.
		cheer(ac, at = ac.currentTime) {
			const src = ac.createBufferSource();
			src.buffer = noiseBuffer(ac, 2.2);
			const bp = ac.createBiquadFilter();
			bp.type = 'bandpass';
			bp.frequency.value = 1100;
			bp.Q.value = 0.6;
			src.connect(bp).connect(envelope(ac, at, 0.22, 0.45, 1.6));
			src.start(at);
		},
		// One bell-like note per badge tier, rising with the tier.
		chime(ac, at, tier) {
			const freq = [0, 523.25, 659.25, 783.99, 987.77, 1318.51][tier] || 523.25;
			for (const [mult, level] of [[1, 0.1], [2.01, 0.03]]) {
				const osc = ac.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = freq * mult;
				osc.connect(envelope(ac, at, level, 0.005, 0.5));
				osc.start(at);
				osc.stop(at + 0.6);
			}
		},
	};

	function play(name, ...args) {
		const ac = audio();
		if (!ac || !sounds[name]) return;
		try {
			sounds[name](ac, ...args);
		} catch {}
	}

	// ---- Mute toggle ----

	const toggle = document.getElementById('sfx-toggle');
	function renderToggle() {
		if (!toggle) return;
		toggle.setAttribute('aria-pressed', String(!muted));
		toggle.title = muted ? 'Sound off' : 'Sound on';
		toggle.classList.toggle('is-muted', muted);
	}
	if (toggle) {
		toggle.hidden = false;
		renderToggle();
		toggle.addEventListener('click', () => {
			muted = !muted;
			storage.set('sfx', muted ? 'off' : 'on');
			renderToggle();
			play('bounce');
		});
	}

	// ---- Buttons and forms ----

	// A light dribble on primary buttons and links that aren't handled by a form below.
	document.addEventListener('click', (event) => {
		const target = event.target.closest('a.btn, .level, .segmented label');
		if (target) play('bounce', undefined, 0.7);
	});

	const DELAYS = { dribble: 380, squeak: 220, buzzer: 520 };
	for (const form of document.querySelectorAll('form[data-fx-submit]')) {
		form.addEventListener('submit', (event) => {
			if (form.dataset.fxSubmitting) return;
			if (!form.checkValidity()) return;
			event.preventDefault();
			form.dataset.fxSubmitting = '1';
			const sound = form.dataset.fxSubmit;
			play(sound);
			if ('fxReveal' in form.dataset) session.set('fx-pending', 'reveal');
			form.classList.add('is-busy');
			const exit = form.closest('[data-fx-exit]');
			if (exit && !reducedMotion) exit.classList.add('is-leaving');
			const delay = muted && reducedMotion ? 0 : DELAYS[sound] || 250;
			window.setTimeout(() => form.submit(), delay);
		});
	}
	// Back/forward cache can restore a page mid-submit; reset it.
	window.addEventListener('pageshow', () => {
		for (const form of document.querySelectorAll('form[data-fx-submitting]')) {
			delete form.dataset.fxSubmitting;
			form.classList.remove('is-busy');
			form.closest('[data-fx-exit]')?.classList.remove('is-leaving');
		}
	});

	// ---- Reveal (player page) ----

	function countUp(el) {
		const target = Number(el.dataset.fxCount);
		if (reducedMotion || !target) return;
		const duration = 900;
		const start = performance.now();
		el.textContent = '0';
		const step = (now) => {
			const p = Math.min(1, (now - start) / duration);
			el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
			if (p < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}
	document.querySelectorAll('[data-fx-count]').forEach(countUp);

	const revealing = session.take('fx-pending') === 'reveal';
	if (revealing && document.querySelector('.player-card')) {
		document.body.classList.add('is-revealing');
		const ac = audio();
		if (ac && ac.state === 'running') {
			const t = ac.currentTime;
			sounds.swish(ac, t + 0.05);
			// A rising chime for each badge tier this player has, best last.
			const tiers = [...new Set([...document.querySelectorAll('.badge-row[data-tier]')].map((r) => Number(r.dataset.tier)))]
				.filter(Boolean)
				.sort((a, b) => a - b);
			tiers.forEach((tier, i) => sounds.chime(ac, t + 0.6 + i * 0.14, tier));
			if ('fxCelebrate' in document.body.dataset) sounds.cheer(ac, t + 0.5);
		}
		if ('fxCelebrate' in document.body.dataset && !reducedMotion) window.setTimeout(confetti, 450);
	}

	// Basketballs raining down for a 90+ overall.
	function confetti() {
		const canvas = document.createElement('canvas');
		canvas.className = 'fx-confetti';
		document.body.appendChild(canvas);
		const g = canvas.getContext('2d');
		const dpr = window.devicePixelRatio || 1;
		canvas.width = innerWidth * dpr;
		canvas.height = innerHeight * dpr;
		g.scale(dpr, dpr);

		const ball = new Image();
		ball.src = '/images/ball.svg';
		const colors = ['#ff3b30', '#ff8a00', '#f2c230', '#ffffff'];
		const pieces = Array.from({ length: 70 }, (_, i) => ({
			ball: i % 4 === 0,
			x: Math.random() * innerWidth,
			y: -20 - Math.random() * innerHeight * 0.6,
			vx: (Math.random() - 0.5) * 2.5,
			vy: 2 + Math.random() * 3,
			size: i % 4 === 0 ? 18 + Math.random() * 12 : 6 + Math.random() * 6,
			spin: Math.random() * Math.PI,
			vspin: (Math.random() - 0.5) * 0.2,
			color: colors[i % colors.length],
		}));

		const end = performance.now() + 3200;
		const frame = (now) => {
			g.clearRect(0, 0, innerWidth, innerHeight);
			for (const p of pieces) {
				p.vy += 0.06;
				p.x += p.vx;
				p.y += p.vy;
				p.spin += p.vspin;
				g.save();
				g.translate(p.x, p.y);
				g.rotate(p.spin);
				if (p.ball && ball.complete) g.drawImage(ball, -p.size / 2, -p.size / 2, p.size, p.size);
				else {
					g.fillStyle = p.color;
					g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
				}
				g.restore();
			}
			if (now < end) requestAnimationFrame(frame);
			else canvas.remove();
		};
		requestAnimationFrame(frame);
	}
})();
