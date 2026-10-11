const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const randomizer = require('./lib/randomizer');
const { createStore } = require('./lib/store');
const { validateCredentials, hashPassword, verifyPassword } = require('./lib/auth');

const PHYSICAL_FIELDS = ['position', 'secondaryPosition', 'height', 'weight', 'wingspan'];
const POSITION_FIELDS = ['position', 'secondaryPosition'];
const REROLL_SECTIONS = ['physicals', 'attributes', 'badges'];
// Guests keep players in their session only; this bounds how much one session can hold.
const GUEST_LIMIT = 5;

// Color band for a 25-99 rating, matching the green/yellow/red bands 2K uses.
function ratingClass(value) {
	if (value >= 90) return 'r-elite';
	if (value >= 80) return 'r-great';
	if (value >= 70) return 'r-good';
	if (value >= 60) return 'r-ok';
	return 'r-low';
}

// Where a request's players live: the database for signed-in users, the session for guests.
// Both expose the same async interface so the routes don't care which one they get.
function storeBuilds(store, owner) {
	return {
		guest: false,
		list: () => store.listBuilds(owner),
		get: (id) => store.getBuild(id, owner),
		create: (build) => store.createBuild({ ...build, owner }),
		update: (id, fields) => store.updateBuild(id, owner, fields),
		remove: (id) => store.deleteBuild(id, owner),
	};
}

function sessionBuilds(session) {
	const all = () => (session.guestBuilds ||= []);
	return {
		guest: true,
		list: async () => [...all()].reverse(),
		get: async (id) => all().find((b) => b.id === id) || null,
		create: async (build) => {
			all().push({ ...build, owner: null });
		},
		update: async (id, fields) => {
			Object.assign(all().find((b) => b.id === id) || {}, fields);
		},
		remove: async (id) => {
			session.guestBuilds = all().filter((b) => b.id !== id);
		},
	};
}

// Compact summary of a player for share previews and the downloadable card image.
function cardSummary(build, info) {
	const { BADGES, ATTRIBUTES } = randomizer;
	const tierCounts = BADGES.tiers.map((_, tier) => Object.values(build.badges).filter((t) => t === tier).length);
	const topBadges = randomizer.BADGE_LIST.filter((b) => build.badges[b.id] > 0)
		.sort((a, b) => build.badges[b.id] - build.badges[a.id])
		.slice(0, 6)
		.map((b) => ({ label: b.label, tier: build.badges[b.id] }));
	const categories = ATTRIBUTES.categories
		.filter((c) => !c.excludeFromOverall)
		.map((c) => ({
			label: c.label,
			value: Math.round(c.attributes.reduce((sum, a) => sum + build.attributes[a.id], 0) / c.attributes.length),
		}));
	const ph = build.physicals;
	return {
		name: build.name,
		overall: info.overall,
		archetype: info.archetype,
		positions: `${info.position.label} / ${info.secondaryPosition.label}`,
		vitals: [
			['POS', `${ph.position}/${ph.secondaryPosition}`],
			['HT', randomizer.formatInches(ph.height)],
			['WT', `${ph.weight} lbs`],
			['WS', randomizer.formatInches(ph.wingspan)],
		],
		level: `${info.level.label} · ${info.level.floor}-${ATTRIBUTES.max}`,
		categories,
		tiers: BADGES.tiers,
		tierCounts,
		topBadges,
		badgeCount: info.badgeCount,
	};
}

function createApp(store, { sessionSecret, secureCookies = false, publicUrl } = {}) {
	const app = express();

	app.set('view engine', 'ejs');
	app.set('views', path.join(__dirname, 'templates'));
	if (secureCookies) app.set('trust proxy', 1);

	app.use(helmet());
	app.use(express.static(path.join(__dirname, 'public')));
	app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
	app.use(express.urlencoded({ extended: true, limit: '20kb' }));
	app.use(
		session({
			secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
			resave: false,
			saveUninitialized: false,
			cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: 1000 * 60 * 60 * 24 * 7 },
		}),
	);

	// Expose the signed-in user and one-shot flash messages to every view.
	app.use((req, res, next) => {
		res.locals.user = req.session.user || null;
		res.locals.guestCount = req.session.user ? 0 : (req.session.guestBuilds || []).length;
		res.locals.flash = req.session.flash || [];
		delete req.session.flash;
		res.locals.formatInches = randomizer.formatInches;
		res.locals.ratingClass = ratingClass;
		next();
	});

	const flash = (req, type, text) => {
		req.session.flash = [...(req.session.flash || []), { type, text }];
	};

	const guestOnly = (req, res, next) => (req.session.user ? res.redirect('/players') : next());
	const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

	// Express 4 doesn't forward rejected promises to the error handler on its own.
	const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

	const buildsFor = (req) =>
		req.session.user ? storeBuilds(store, req.session.user.key) : sessionBuilds(req.session);

	// Signs the user in and saves any players they made as a guest to their account.
	// Resolves to the number of guest players saved.
	const signIn = async (req, user) => {
		const guestBuilds = req.session.guestBuilds || [];
		// New session id on login prevents session fixation.
		await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
		req.session.user = { username: user.username, key: user.usernameLower };
		const saved = storeBuilds(store, user.usernameLower);
		for (const build of guestBuilds) await saved.create(build);
		if (guestBuilds.length) {
			const n = guestBuilds.length;
			flash(req, 'success', `Saved ${n} guest player${n === 1 ? '' : 's'} to your Locker Room.`);
		}
		return guestBuilds.length;
	};

	// ---- Pages ----

	app.get('/', (req, res) => res.render('index', { title: 'Home' }));

	// ---- Accounts ----

	app.get('/register', guestOnly, (req, res) => res.render('register', { title: 'Sign Up', error: null, username: '' }));

	app.post(
		'/register',
		authLimiter,
		wrap(async (req, res) => {
			const username = String(req.body.username || '').trim();
			const password = req.body.password;
			const fail = (error) => res.status(400).render('register', { title: 'Sign Up', error, username });

			const invalid = validateCredentials(username, password);
			if (invalid) return fail(invalid);
			if (password !== req.body.confirm) return fail('Passwords do not match.');
			if (await store.findUser(username)) return fail('That username is taken.');

			const user = {
				username,
				usernameLower: username.toLowerCase(),
				passwordHash: await hashPassword(password),
				createdAt: new Date().toISOString(),
			};
			await store.createUser(user);
			const saved = await signIn(req, user);
			if (saved) return res.redirect('/players');
			flash(req, 'success', `Welcome, ${username}! Roll your first player.`);
			res.redirect('/players/new');
		}),
	);

	app.get('/login', guestOnly, (req, res) => res.render('login', { title: 'Log In', error: null, username: '' }));

	app.post(
		'/login',
		authLimiter,
		wrap(async (req, res) => {
			const username = String(req.body.username || '').trim();
			const user = username && (await store.findUser(username));
			const result = user ? await verifyPassword(user, String(req.body.password || '')) : { ok: false };
			if (!result.ok) {
				return res.status(401).render('login', { title: 'Log In', error: 'Invalid username or password.', username });
			}
			if (result.needsUpgrade) {
				user.usernameLower = user.username.toLowerCase();
				await store.updateUser(user.username, {
					usernameLower: user.usernameLower,
					passwordHash: await hashPassword(req.body.password),
				});
			}
			await signIn(req, user);
			res.redirect('/players');
		}),
	);

	app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

	// ---- Builds ----

	app.get(
		'/players',
		wrap(async (req, res) => {
			const builds = (await buildsFor(req).list()).map((b) => ({ ...b, info: randomizer.describe(b) }));
			res.render('players', { title: 'My Players', builds, guestLimit: GUEST_LIMIT });
		}),
	);

	const renderCreate = (res, { status = 200, error = null, form = {} } = {}) =>
		res.status(status).render('create', { title: 'Create Player', error, form, data: randomizer });

	app.get('/players/new', (req, res) => renderCreate(res));

	app.post(
		'/players',
		wrap(async (req, res) => {
			const body = req.body;
			const builds = buildsFor(req);
			if (builds.guest && (await builds.list()).length >= GUEST_LIMIT) {
				const error = `Guests can keep up to ${GUEST_LIMIT} players. Sign up to save them and make more, or delete one first.`;
				return renderCreate(res, { status: 400, error, form: body });
			}
			const name = String(body.name || '').trim().slice(0, 40);
			if (!name) return renderCreate(res, { status: 400, error: 'Give your player a name.', form: body });

			// Blank physical fields mean "randomize"; filled ones are locked for future re-rolls too.
			const lockedPhysicals = {};
			for (const field of PHYSICAL_FIELDS) {
				const raw = String(body[field] ?? '').trim();
				lockedPhysicals[field] = raw === '' ? null : POSITION_FIELDS.includes(field) ? raw : Number(raw);
			}

			let result;
			try {
				result = randomizer.generateBuild({
					physicals: lockedPhysicals,
					attributesMode: body.attributesMode,
					level: body.level,
					badgesMode: body.badgesMode,
				});
			} catch (err) {
				if (err instanceof randomizer.ValidationError) {
					return renderCreate(res, { status: 400, error: err.message, form: body });
				}
				throw err;
			}

			const now = new Date().toISOString();
			const build = {
				id: crypto.randomUUID(),
				name,
				physicals: result.physicals,
				attributes: result.attributes,
				badges: result.badges,
				lockedPhysicals,
				modes: {
					attributes: body.attributesMode || 'realistic',
					level: body.level || randomizer.ATTRIBUTES.defaultLevel,
					badges: body.badgesMode || 'realistic',
				},
				createdAt: now,
				updatedAt: now,
			};
			await builds.create(build);
			res.redirect(`/players/${build.id}`);
		}),
	);

	const loadBuild = wrap(async (req, res, next) => {
		const build = await buildsFor(req).get(req.params.id);
		if (!build) return res.status(404).render('error', { title: 'Not Found', message: "That player doesn't exist." });
		req.build = build;
		next();
	});

	const shareUrl = (req, shareId) => `${publicUrl || `${req.protocol}://${req.get('host')}`}/card/${shareId}`;

	const renderCard = (req, res, build, extra) => {
		const info = randomizer.describe(build);
		const card = cardSummary(build, info);
		res.render('player', {
			title: build.name,
			build,
			info,
			card,
			data: randomizer,
			canRerollPhysicals: PHYSICAL_FIELDS.some((f) => build.lockedPhysicals[f] == null),
			shareLink: build.shareId ? shareUrl(req, build.shareId) : null,
			shared: false,
			...extra,
		});
	};

	app.get('/players/:id', loadBuild, (req, res) => renderCard(req, res, req.build));

	// Public, read-only view of a player its owner chose to share.
	app.get(
		'/card/:shareId',
		wrap(async (req, res) => {
			const build = await store.getSharedBuild(req.params.shareId);
			if (!build) {
				return res.status(404).render('error', { title: 'Not Found', message: "This player card isn't shared anymore." });
			}
			const owner = await store.findUser(build.owner);
			renderCard(req, res, build, { shared: true, ownerName: owner?.username || build.owner });
		}),
	);

	app.post(
		'/players/:id/share',
		loadBuild,
		wrap(async (req, res) => {
			const builds = buildsFor(req);
			if (builds.guest) {
				flash(req, 'info', 'Sign up to share your player. Your guest players come with you.');
				return res.redirect('/register');
			}
			if (!req.build.shareId) {
				await builds.update(req.build.id, { shareId: crypto.randomBytes(12).toString('base64url') });
			}
			flash(req, 'success', 'Share link ready. Anyone with the link can view this player.');
			res.redirect(`/players/${req.build.id}#share`);
		}),
	);

	app.post(
		'/players/:id/unshare',
		loadBuild,
		wrap(async (req, res) => {
			await buildsFor(req).update(req.build.id, { shareId: null });
			flash(req, 'info', 'Sharing turned off. The old link no longer works.');
			res.redirect(`/players/${req.build.id}`);
		}),
	);

	app.post(
		'/players/:id/reroll',
		loadBuild,
		wrap(async (req, res) => {
			const section = req.body.section;
			if (!REROLL_SECTIONS.includes(section)) return res.redirect(`/players/${req.build.id}`);
			const before = randomizer.describe(req.build).overall;
			const next = randomizer.reroll(req.build, section);
			await buildsFor(req).update(req.build.id, { ...next, updatedAt: new Date().toISOString() });
			const after = randomizer.describe({ ...req.build, ...next }).overall;
			const delta = after - before;
			flash(req, 'info', `Re-rolled ${section}. OVR ${before} → ${after}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}.`);
			res.redirect(`/players/${req.build.id}`);
		}),
	);

	app.post(
		'/players/:id/delete',
		loadBuild,
		wrap(async (req, res) => {
			await buildsFor(req).remove(req.build.id);
			flash(req, 'info', `Deleted ${req.build.name}.`);
			res.redirect('/players');
		}),
	);

	// Old 2K23 routes.
	app.get(['/portal', '/myplayers', '/randomize'], (req, res) => res.redirect('/players'));
	app.get('/create', (req, res) => res.redirect('/players/new'));

	app.use((req, res) => res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' }));

	app.use((err, req, res, next) => {
		console.error(err);
		res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Try again.' });
	});

	return app;
}

// The MongoDB driver relies on globals (like Web Crypto) that only exist in newer Node, and
// fails deep inside a query with "crypto is not defined" on older versions. Fail fast instead.
function checkNodeVersion() {
	const required = require('./package.json').engines.node.replace(/[^\d.]/g, '');
	const [major, minor] = process.versions.node.split('.').map(Number);
	const [reqMajor, reqMinor] = required.split('.').map(Number);
	if (major < reqMajor || (major === reqMajor && minor < reqMinor)) {
		throw new Error(`Node ${required}+ is required (running ${process.version}). Upgrade Node on this server, e.g. to 22 LTS.`);
	}
}

async function start() {
	checkNodeVersion();
	const store = createStore();
	await store.connect();
	const production = process.env.NODE_ENV === 'production';
	if (!process.env.SESSION_SECRET) {
		if (production) throw new Error('SESSION_SECRET must be set in production.');
		console.warn('SESSION_SECRET not set; using a random secret (sessions reset on restart).');
	}
	const app = createApp(store, {
		sessionSecret: process.env.SESSION_SECRET,
		secureCookies: production,
		publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, ''),
	});
	const port = Number(process.env.PORT) || 7700;
	app.listen(port, () => console.log(`2K27 Randomizer running on http://localhost:${port} (${store.constructor.name})`));
}

if (require.main === module) {
	start().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

module.exports = { createApp };
