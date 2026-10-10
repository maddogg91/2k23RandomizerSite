// Player card sharing: copy link, native share sheet, and a downloadable 1200x630 card image
// (the standard social preview size) drawn on a canvas from the page's #card-data JSON.
(function () {
	const dataEl = document.getElementById('card-data');
	if (!dataEl) return;
	const card = JSON.parse(dataEl.textContent);

	// ---- Copy link ----

	for (const button of document.querySelectorAll('[data-copy]')) {
		const input = document.querySelector(button.dataset.copy);
		const label = button.textContent;
		button.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(input.value);
			} catch {
				// Clipboard API unavailable (e.g. plain http): fall back to selecting the text.
				input.select();
				document.execCommand('copy');
			}
			button.textContent = 'Copied!';
			button.classList.add('is-copied');
			window.setTimeout(() => {
				button.textContent = label;
				button.classList.remove('is-copied');
			}, 1600);
		});
	}

	// ---- Native share sheet (mostly mobile) ----

	for (const button of document.querySelectorAll('[data-native-share]')) {
		if (!navigator.share) continue;
		button.hidden = false;
		button.addEventListener('click', async () => {
			const shareData = { title: button.dataset.title, text: `Check out my 2K27 player: ${button.dataset.title}`, url: button.dataset.url };
			try {
				const file = await renderFile();
				if (file && navigator.canShare?.({ files: [file] })) shareData.files = [file];
			} catch {}
			try {
				await navigator.share(shareData);
			} catch {}
		});
	}

	// ---- Card image ----

	const RATING = [
		[90, '#2ee6a6'],
		[80, '#5fd35f'],
		[70, '#e6d22e'],
		[60, '#ff9f1a'],
		[0, '#ff4d4d'],
	];
	const TIER = ['#262b3d', '#c47a45', '#c9d1dc', '#f2c230', '#a46bff', '#ff8a5a'];
	const DISPLAY = '"Oswald", "Bebas Neue", "Arial Narrow", Impact, sans-serif';
	const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
	const ratingColor = (v) => RATING.find(([min]) => v >= min)[1];

	function loadImage(src) {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = src;
		});
	}

	function roundRect(g, x, y, w, h, r) {
		g.beginPath();
		g.moveTo(x + r, y);
		g.arcTo(x + w, y, x + w, y + h, r);
		g.arcTo(x + w, y + h, x, y + h, r);
		g.arcTo(x, y + h, x, y, r);
		g.arcTo(x, y, x + w, y, r);
		g.closePath();
	}

	// Shrink the font until `text` fits in `maxWidth`.
	function fitText(g, text, size, maxWidth, family, weight = '700') {
		do {
			g.font = `${weight} ${size}px ${family}`;
			size -= 2;
		} while (g.measureText(text).width > maxWidth && size > 18);
	}

	async function drawCard() {
		const W = 1200;
		const H = 630;
		const canvas = document.createElement('canvas');
		canvas.width = W;
		canvas.height = H;
		const g = canvas.getContext('2d');
		const [ball, court] = await Promise.all([loadImage('/images/ball.svg'), loadImage('/images/court.svg')]);

		// Background: dark floor, red sweep, faint court lines.
		g.fillStyle = '#07080c';
		g.fillRect(0, 0, W, H);
		const sweep = g.createLinearGradient(0, 0, W * 0.7, H);
		sweep.addColorStop(0, 'rgba(255, 59, 48, 0.45)');
		sweep.addColorStop(0.55, 'rgba(255, 59, 48, 0)');
		g.fillStyle = sweep;
		g.fillRect(0, 0, W, H);
		if (court) {
			g.globalAlpha = 0.07;
			g.drawImage(court, W - 560, 40, 600, 564);
			g.globalAlpha = 1;
		}
		if (ball) {
			g.globalAlpha = 0.9;
			g.drawImage(ball, W - 150, 34, 110, 110);
			g.globalAlpha = 1;
		}

		// OVR block.
		g.fillStyle = ratingColor(card.overall);
		roundRect(g, 60, 60, 190, 190, 26);
		g.fill();
		g.fillStyle = '#07080c';
		g.textAlign = 'center';
		g.font = `700 26px ${DISPLAY}`;
		g.fillText('OVR', 155, 105);
		g.font = `700 110px ${DISPLAY}`;
		g.fillText(String(card.overall), 155, 220);

		// Name, positions, archetype.
		g.textAlign = 'left';
		g.fillStyle = '#ff3b30';
		g.font = `700 24px ${BODY}`;
		g.fillText(card.positions.toUpperCase(), 290, 92);
		g.fillStyle = '#eef0f6';
		fitText(g, card.name.toUpperCase(), 84, 760, DISPLAY);
		g.fillText(card.name.toUpperCase(), 286, 180);
		g.fillStyle = '#ffd6a0';
		g.font = `600 32px ${BODY}`;
		g.fillText(card.archetype, 290, 232);

		// Vitals row, spaced by each value's width so long weights don't collide.
		let vitalX = 60;
		for (const [label, value] of card.vitals) {
			g.fillStyle = '#8a90a6';
			g.font = `600 20px ${BODY}`;
			g.fillText(label, vitalX, 310);
			g.fillStyle = '#eef0f6';
			g.font = `700 40px ${DISPLAY}`;
			g.fillText(value, vitalX, 356);
			vitalX += Math.max(130, g.measureText(value).width + 44);
		}
		g.fillStyle = '#8a90a6';
		g.font = `600 20px ${BODY}`;
		g.fillText(card.level, 60, 400);

		// Category bars.
		const barX = 760;
		card.categories.forEach((c, i) => {
			const y = 300 + i * 42;
			g.fillStyle = '#c6cadb';
			g.font = `600 20px ${BODY}`;
			g.textAlign = 'left';
			g.fillText(c.label, barX, y);
			g.fillStyle = '#1b1f2d';
			roundRect(g, barX + 195, y - 14, 180, 12, 6);
			g.fill();
			g.fillStyle = ratingColor(c.value);
			roundRect(g, barX + 195, y - 14, 180 * (c.value / 99), 12, 6);
			g.fill();
			g.textAlign = 'right';
			g.font = `700 26px ${DISPLAY}`;
			g.fillText(String(c.value), W - 40, y);
		});

		// Badges: tier counts and the best few.
		g.textAlign = 'left';
		g.fillStyle = '#eef0f6';
		g.font = `700 26px ${DISPLAY}`;
		g.fillText(`BADGES · ${card.badgeCount}`, 60, 460);
		let chipX = 60;
		for (let tier = card.tiers.length - 1; tier >= 1; tier--) {
			const n = card.tierCounts[tier];
			if (!n) continue;
			const text = `${n} ${card.tiers[tier]}`;
			g.font = `700 20px ${BODY}`;
			const w = g.measureText(text).width + 52;
			if (chipX + w > barX - 20) break; // keep clear of the category bars
			g.fillStyle = '#1b1f2d';
			roundRect(g, chipX, 478, w, 38, 19);
			g.fill();
			drawEmblem(g, chipX + 22, 497, 11, tier);
			g.fillStyle = TIER[tier];
			g.fillText(text, chipX + 40, 504);
			chipX += w + 10;
		}
		g.fillStyle = '#c6cadb';
		g.font = `500 20px ${BODY}`;
		const best = card.topBadges.map((b) => b.label).join(' · ');
		if (best) g.fillText(best.length > 90 ? `${best.slice(0, 87)}…` : best, 60, 554);

		// Footer.
		g.fillStyle = '#8a90a6';
		g.font = `600 18px ${BODY}`;
		g.fillText('2K27 PLAYER RANDOMIZER', 60, 600);
		g.textAlign = 'right';
		g.fillText('Fan-made · not affiliated with the NBA or 2K', W - 40, 600);
		return canvas;
	}

	function drawEmblem(g, cx, cy, r, tier) {
		g.beginPath();
		for (let i = 0; i < 6; i++) {
			const a = Math.PI / 6 + (i * Math.PI) / 3;
			g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
		}
		g.closePath();
		if (tier === 5) {
			const grad = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
			['#ff4d4d', '#ffcc00', '#2ee6a6', '#4da6ff', '#b84dff'].forEach((c, i) => grad.addColorStop(i / 4, c));
			g.fillStyle = grad;
		} else {
			g.fillStyle = TIER[tier];
		}
		g.fill();
	}

	const fileName = () => `${card.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'player'}-2k27-card.png`;

	async function renderFile() {
		const canvas = await drawCard();
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		return blob ? new File([blob], fileName(), { type: 'image/png' }) : null;
	}

	for (const button of document.querySelectorAll('[data-card-download]')) {
		button.addEventListener('click', async () => {
			button.disabled = true;
			try {
				const file = await renderFile();
				if (!file) return;
				const url = URL.createObjectURL(file);
				const a = document.createElement('a');
				a.href = url;
				a.download = file.name;
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			} finally {
				button.disabled = false;
			}
		});
	}
})();
