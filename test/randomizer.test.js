const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../lib/randomizer');

// Small seeded PRNG (mulberry32) so failures are reproducible.
function seeded(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;

test('random physicals are realistic for the position', () => {
	const rng = seeded(1);
	for (let i = 0; i < 2000; i++) {
		const p = r.resolvePhysicals({}, rng);
		const pos = r.PHYSICALS.positions.find((x) => x.id === p.position);
		assert.ok(p.height >= pos.minHeight && p.height <= pos.maxHeight);
		assert.ok(pos.secondary.includes(p.secondaryPosition));
		const w = r.realisticWeight(p.height);
		assert.ok(p.weight >= w.min && p.weight <= w.max);
		const ws = r.realisticWingspan(p.height);
		assert.ok(p.wingspan >= ws.min && p.wingspan <= ws.max);
	}
});

test('any locked combination inside the editor limits is allowed', () => {
	const odd = { position: 'C', secondaryPosition: 'PG', height: 66, weight: 340, wingspan: 99 };
	assert.deepEqual(r.resolvePhysicals(odd), odd);
	const rng = seeded(2);
	for (let i = 0; i < 200; i++) {
		const p = r.resolvePhysicals({ height: 90 }, rng);
		assert.equal(p.height, 90);
		assert.equal(p.position, 'C', 'random position fits a locked 7\'6" height');
	}
	// Weight/wingspan can be locked without a height.
	assert.equal(r.resolvePhysicals({ weight: 200 }).weight, 200);
});

test('invalid physicals are rejected', () => {
	assert.throws(() => r.resolvePhysicals({ position: 'XX' }), r.ValidationError);
	assert.throws(() => r.resolvePhysicals({ position: 'PG', secondaryPosition: 'PG' }), /must differ/);
	assert.throws(() => r.resolvePhysicals({ height: 92 }), /Height/);
	assert.throws(() => r.resolvePhysicals({ height: 74.5 }), /Height/);
	assert.throws(() => r.resolvePhysicals({ weight: 400 }), /Weight/);
	assert.throws(() => r.resolvePhysicals({ wingspan: 50 }), /Wingspan/);
	// A locked secondary never collides with a random primary.
	const rng = seeded(3);
	for (let i = 0; i < 200; i++) assert.notEqual(r.resolvePhysicals({ secondaryPosition: 'C', height: 86 }, rng).position, 'C');
});

test('every rating stays within 25-99 and all 37 are present', () => {
	const rng = seeded(4);
	for (const mode of ['realistic', 'chaos']) {
		for (let i = 0; i < 300; i++) {
			const b = r.generateBuild({ attributesMode: mode, badgesMode: mode }, rng);
			assert.equal(Object.keys(b.attributes).length, 37);
			for (const v of Object.values(b.attributes)) assert.ok(v >= 25 && v <= 99);
			for (const t of Object.values(b.badges)) assert.ok(t >= 0 && t <= 5);
		}
	}
});

test('realistic rolls follow position and body type, without hard caps', () => {
	const rng = seeded(5);
	const roll = (position) =>
		Array.from({ length: 1500 }, () => r.generateBuild({ physicals: { position } }, rng).attributes);
	const centers = roll('C');
	const guards = roll('PG');
	assert.ok(avg(centers.map((a) => a.defensiveRebound)) > avg(guards.map((a) => a.defensiveRebound)) + 8);
	assert.ok(avg(guards.map((a) => a.ballHandle)) > avg(centers.map((a) => a.ballHandle)) + 8);
	assert.ok(Math.max(...centers.map((a) => a.ballHandle)) >= 90, 'a center can still roll an elite handle');
});

test('each level sets the floor of the rating range for both styles', () => {
	const rng = seeded(9);
	for (const level of r.ATTRIBUTES.levels) {
		for (const mode of ['realistic', 'chaos']) {
			const values = Array.from({ length: 300 }, () => r.generateBuild({ attributesMode: mode, level: level.id }, rng))
				.flatMap((b) => Object.values(b.attributes));
			assert.equal(Math.min(...values), level.floor, `${mode} ${level.id} reaches its floor`);
			assert.ok(Math.max(...values) <= 99);
		}
	}
	assert.throws(() => r.generateBuild({ level: 'goat' }), /Unknown level/);
	assert.throws(() => r.generateBuild({ attributesMode: 'manual' }), /Unknown attributes mode/);
	assert.throws(() => r.generateBuild({ badgesMode: 'manual' }), /Unknown badges mode/);
});

test('easier levels produce higher overalls', () => {
	const rng = seeded(10);
	const medianOvr = (level) => {
		const o = Array.from({ length: 800 }, () => r.describe(r.generateBuild({ level }, rng)).overall).sort((a, b) => a - b);
		return o[400];
	};
	const medians = r.LEVEL_IDS.map(medianOvr);
	for (let i = 1; i < medians.length; i++) assert.ok(medians[i] < medians[i - 1], medians.join(' > '));
});

test('realistic badges track related ratings; none mode equips nothing', () => {
	const high = Object.fromEntries(r.ATTRIBUTE_LIST.map((a) => [a.id, 95]));
	const low = Object.fromEntries(r.ATTRIBUTE_LIST.map((a) => [a.id, 40]));
	const rng = seeded(6);
	const count = (attrs) => avg(Array.from({ length: 200 }, () => Object.values(r.realisticBadges(attrs, rng)).filter(Boolean).length));
	assert.ok(count(high) > 30);
	assert.ok(count(low) < 3);
	assert.ok(Object.values(r.generateBuild({ badgesMode: 'none' }).badges).every((t) => t === 0));
});

test('re-rolls change only their section and keep locked physicals', () => {
	const rng = seeded(7);
	const created = r.generateBuild({ physicals: { position: 'SG', height: 78 } }, rng);
	const build = {
		...created,
		lockedPhysicals: { position: 'SG', secondaryPosition: null, height: 78, weight: null, wingspan: null },
		modes: { attributes: 'chaos', level: 'rookie', badges: 'none' },
	};
	const phys = r.reroll(build, 'physicals', rng);
	assert.equal(phys.physicals.position, 'SG');
	assert.equal(phys.physicals.height, 78);
	assert.deepEqual(phys.attributes, build.attributes);
	assert.deepEqual(phys.badges, build.badges);

	const attrs = r.reroll(build, 'attributes', rng);
	assert.deepEqual(attrs.physicals, build.physicals);
	assert.deepEqual(attrs.badges, build.badges);
	assert.notDeepEqual(attrs.attributes, build.attributes);
	assert.ok(Object.values(attrs.attributes).every((v) => v >= 65), 're-roll keeps the Rookie level');

	assert.throws(() => r.reroll(build, 'bogus'), r.ValidationError);
});

test('describe produces OVR within range and a readable play style', () => {
	const d = r.describe(r.generateBuild({}, seeded(8)));
	assert.ok(d.overall >= 40 && d.overall <= 99);
	assert.match(d.archetype, /^[A-Z][\w-]+ [A-Z][\w ]+$/);
	assert.ok(d.secondaryPosition);
	const all99 = Object.fromEntries(r.ATTRIBUTE_LIST.map((a) => [a.id, 99]));
	assert.equal(r.overall(all99, 'PG'), 99);
});
