// Player randomizer modeled on 2K's standard Create Player editor (not the MyPLAYER builder):
// every rating can be anything from 25 to 99 and any badge can be any tier. "Realistic"
// rolls use position and body type to shape a believable player; "chaos" rolls anything.
// Every function takes an optional `rng` (returns [0, 1)) so results are reproducible in tests.

const PHYSICALS = require('../data/physicals.json');
const ATTRIBUTES = require('../data/attributes.json');
const BADGES = require('../data/badges.json');

const ATTRIBUTE_LIST = ATTRIBUTES.categories.flatMap((c) => c.attributes);
const BADGE_LIST = BADGES.categories.flatMap((c) => c.badges);
const POSITION_IDS = PHYSICALS.positions.map((p) => p.id);
const MAX_TIER = BADGES.tiers.length - 1;
const RATED_CATEGORIES = ATTRIBUTES.categories.filter((c) => !c.excludeFromOverall);

const ATTRIBUTE_MODES = ['realistic', 'chaos'];
const BADGE_MODES = ['realistic', 'chaos', 'none'];
const LEVEL_IDS = ATTRIBUTES.levels.map((l) => l.id);

class ValidationError extends Error {}

const randInt = (min, max, rng) => min + Math.floor(rng() * (max - min + 1));
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function weightedPick(items, weightOf, rng) {
	const total = items.reduce((sum, item) => sum + weightOf(item), 0);
	let roll = rng() * total;
	for (const item of items) {
		roll -= weightOf(item);
		if (roll < 0) return item;
	}
	return items[items.length - 1];
}

// ---- Physicals ----

function getPosition(id) {
	return PHYSICALS.positions.find((p) => p.id === id);
}

// Typical weight/wingspan for a height; random rolls stay inside these, locked values
// only have to fit the editor's wider limits.
function realisticWeight(height) {
	const { min, max } = PHYSICALS.realistic.weight;
	return {
		min: clamp(Math.round(min.base + min.perInch * height), PHYSICALS.limits.weight.min, PHYSICALS.limits.weight.max),
		max: clamp(Math.round(max.base + max.perInch * height), PHYSICALS.limits.weight.min, PHYSICALS.limits.weight.max),
	};
}

function realisticWingspan(height) {
	const { minOffset, maxOffset } = PHYSICALS.realistic.wingspan;
	return { min: height + minOffset, max: height + maxOffset };
}

function formatInches(inches) {
	return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function checkLimit(label, value, range, format = String) {
	if (!Number.isInteger(value) || value < range.min || value > range.max) {
		throw new ValidationError(`${label} must be between ${format(range.min)} and ${format(range.max)}.`);
	}
}

// The position whose typical height range includes (or is closest to) `height`.
function positionsForHeight(height) {
	const fits = PHYSICALS.positions.filter((p) => height >= p.minHeight && height <= p.maxHeight);
	if (fits.length) return fits;
	const distance = (p) => Math.max(p.minHeight - height, height - p.maxHeight);
	const best = Math.min(...PHYSICALS.positions.map(distance));
	return PHYSICALS.positions.filter((p) => distance(p) === best);
}

// `spec` fields left null/undefined are randomized; set fields are validated and kept.
// Like the editor, any locked combination is allowed (a 7'6" point guard is fine).
function resolvePhysicals(spec = {}, rng = Math.random) {
	let { position, secondaryPosition, height, weight, wingspan } = spec;
	const { limits } = PHYSICALS;

	if (position != null && !getPosition(position)) throw new ValidationError('Unknown position.');
	if (secondaryPosition != null && !getPosition(secondaryPosition)) throw new ValidationError('Unknown secondary position.');
	if (position != null && position === secondaryPosition) {
		throw new ValidationError('Secondary position must differ from the primary position.');
	}
	if (height != null) checkLimit('Height', height, limits.height, formatInches);
	if (weight != null) checkLimit('Weight', weight, limits.weight, (n) => `${n} lbs`);
	if (wingspan != null) checkLimit('Wingspan', wingspan, limits.wingspan, formatInches);

	if (position == null) {
		const options = (height == null ? PHYSICALS.positions : positionsForHeight(height)).filter(
			(p) => p.id !== secondaryPosition,
		);
		position = pick(options.length ? options : PHYSICALS.positions.filter((p) => p.id !== secondaryPosition), rng).id;
	}
	const pos = getPosition(position);
	if (secondaryPosition == null) secondaryPosition = pick(pos.secondary, rng);
	if (height == null) height = randInt(pos.minHeight, pos.maxHeight, rng);

	if (weight == null) {
		const range = realisticWeight(height);
		weight = randInt(range.min, range.max, rng);
	}
	if (wingspan == null) {
		const range = realisticWingspan(height);
		wingspan = clamp(randInt(range.min, range.max, rng), limits.wingspan.min, limits.wingspan.max);
	}

	return { position, secondaryPosition, height, weight, wingspan };
}

// ---- Attributes ----

// Map a value within [min, max] onto [-1, 1], allowing a little overshoot for extreme locked values.
const centered = (value, min, max) => clamp(max === min ? 0 : ((value - min) / (max - min)) * 2 - 1, -1.5, 1.5);

// How tall / heavy / long the player is relative to typical, each roughly in [-1, 1].
function bodyProfile({ height, weight, wingspan }) {
	const w = realisticWeight(height);
	const ws = realisticWingspan(height);
	return [centered(height, 69, 88), centered(weight, w.min, w.max), centered(wingspan, ws.min, ws.max)];
}

// A level sets the rating range: Rookie rolls 65-99, Legend the editor's full 25-99.
function levelFloor(levelId = ATTRIBUTES.defaultLevel) {
	const level = ATTRIBUTES.levels.find((l) => l.id === levelId);
	if (!level) throw new ValidationError('Unknown level.');
	return level.floor;
}

const toRating = (r, floor) => Math.round(floor + (ATTRIBUTES.max - floor) * clamp(r, 0, 1));

// A believable player: a primary and secondary strength (weighted by position), a per-player
// talent level, and a nudge from body type (big men rebound, small guards handle). Nothing is
// capped, so a tall player can still roll a great handle; it's just less likely.
function realisticAttributes(physicals, level, rng = Math.random) {
	const floor = levelFloor(level);
	const profile = bodyProfile(physicals);
	const byWeight = (c) => c.weights[physicals.position];
	const primary = weightedPick(RATED_CATEGORIES, byWeight, rng);
	const secondary = weightedPick(RATED_CATEGORIES.filter((c) => c !== primary), byWeight, rng);
	const talent = (rng() - 0.5) * 0.4;
	const values = {};
	for (const category of ATTRIBUTES.categories) {
		const [lo, span] = category === primary ? [0.55, 0.4] : category === secondary ? [0.35, 0.45] : [0.1, 0.55];
		for (const attr of category.attributes) {
			const body = attr.body.reduce((sum, k, i) => sum + k * profile[i], 0) * 0.15;
			values[attr.id] = toRating(lo + span * rng() + talent + body, floor);
		}
	}
	return values;
}

function chaosAttributes(level, rng = Math.random) {
	const floor = levelFloor(level);
	return Object.fromEntries(ATTRIBUTE_LIST.map((a) => [a.id, randInt(floor, ATTRIBUTES.max, rng)]));
}

function randomAttributes(physicals, style, level, rng = Math.random) {
	return style === 'chaos' ? chaosAttributes(level, rng) : realisticAttributes(physicals, level, rng);
}

function categoryAverages(attributes) {
	const averages = {};
	for (const category of ATTRIBUTES.categories) {
		const sum = category.attributes.reduce((s, a) => s + attributes[a.id], 0);
		averages[category.id] = sum / category.attributes.length;
	}
	return averages;
}

// Position-weighted average of the rated categories, stretched so a well-rounded star lands in
// the 90s and a 25-across-the-board player around 40, like in-game overalls.
function overall(attributes, position) {
	const averages = categoryAverages(attributes);
	let total = 0;
	let weights = 0;
	for (const category of RATED_CATEGORIES) {
		total += averages[category.id] * category.weights[position];
		weights += category.weights[position];
	}
	return clamp(Math.round(20 + (total / weights) * 0.9), 40, 99);
}

function archetype(attributes) {
	const averages = categoryAverages(attributes);
	const [first, second] = [...RATED_CATEGORIES].sort((a, b) => averages[b.id] - averages[a.id]);
	return `${second.adjective} ${first.noun}`;
}

// ---- Badges ----

// Realistic: the better a badge's related ratings, the more likely it's equipped and the
// higher its tier. Nothing is gated, so the occasional surprise badge still shows up.
function realisticBadges(attributes, rng = Math.random) {
	const { equipFrom, equipSpan, maxChance, tierCutoffs, noise } = BADGES.realistic;
	const badges = {};
	for (const badge of BADGE_LIST) {
		const score = badge.requires.reduce((s, id) => s + attributes[id], 0) / badge.requires.length;
		const chance = clamp((score - equipFrom) / equipSpan, 0.02, maxChance);
		if (rng() >= chance) {
			badges[badge.id] = 0;
			continue;
		}
		const noisy = score + (rng() * 2 - 1) * noise;
		badges[badge.id] = clamp(tierCutoffs.filter((c) => noisy >= c).length, 1, MAX_TIER);
	}
	return badges;
}

function chaosBadges(rng = Math.random) {
	return Object.fromEntries(BADGE_LIST.map((b) => [b.id, randInt(0, MAX_TIER, rng)]));
}

function randomBadges(attributes, style, rng = Math.random) {
	return style === 'chaos' ? chaosBadges(rng) : realisticBadges(attributes, rng);
}

function noBadges() {
	return Object.fromEntries(BADGE_LIST.map((b) => [b.id, 0]));
}

// ---- Whole player ----

// options: { physicals: spec, attributesMode, level, badgesMode }
function generateBuild(options, rng = Math.random) {
	const { attributesMode = 'realistic', level = ATTRIBUTES.defaultLevel, badgesMode = 'realistic' } = options;
	if (!ATTRIBUTE_MODES.includes(attributesMode)) throw new ValidationError('Unknown attributes mode.');
	if (!LEVEL_IDS.includes(level)) throw new ValidationError('Unknown level.');
	if (!BADGE_MODES.includes(badgesMode)) throw new ValidationError('Unknown badges mode.');

	const physicals = resolvePhysicals(options.physicals, rng);
	const attributes = randomAttributes(physicals, attributesMode, level, rng);
	const badges = badgesMode === 'none' ? noBadges() : randomBadges(attributes, badgesMode, rng);
	return { physicals, attributes, badges };
}

// Re-rolls use the style picked at creation; badges created with "none" re-roll realistically.
const rerollStyle = (mode) => (mode === 'chaos' ? 'chaos' : 'realistic');

// Re-roll one section of an existing player. Sections are independent (no caps), so other
// sections are left untouched. `lockedPhysicals` keeps fields the user set at creation.
function reroll(build, section, rng = Math.random) {
	const { physicals, attributes, badges, modes = {} } = build;
	if (section === 'physicals') return { physicals: resolvePhysicals(build.lockedPhysicals, rng), attributes, badges };
	if (section === 'attributes') {
		const level = modes.level || ATTRIBUTES.defaultLevel;
		return { physicals, attributes: randomAttributes(physicals, rerollStyle(modes.attributes), level, rng), badges };
	}
	if (section === 'badges') return { physicals, attributes, badges: randomBadges(attributes, rerollStyle(modes.badges), rng) };
	throw new ValidationError('Unknown section.');
}

// Everything a view needs that is derived rather than stored.
function describe(build) {
	return {
		position: getPosition(build.physicals.position),
		secondaryPosition: getPosition(build.physicals.secondaryPosition),
		overall: overall(build.attributes, build.physicals.position),
		archetype: archetype(build.attributes),
		badgeCount: Object.values(build.badges).filter((t) => t > 0).length,
		level: ATTRIBUTES.levels.find((l) => l.id === (build.modes?.level || ATTRIBUTES.defaultLevel)),
	};
}

module.exports = {
	PHYSICALS,
	ATTRIBUTES,
	BADGES,
	ATTRIBUTE_LIST,
	BADGE_LIST,
	POSITION_IDS,
	ATTRIBUTE_MODES,
	BADGE_MODES,
	LEVEL_IDS,
	ValidationError,
	formatInches,
	realisticWeight,
	realisticWingspan,
	resolvePhysicals,
	realisticAttributes,
	chaosAttributes,
	overall,
	archetype,
	realisticBadges,
	chaosBadges,
	generateBuild,
	reroll,
	describe,
};
