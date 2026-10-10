const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CryptoJS = require('crypto-js');
const { createApp } = require('../main');
const { FileStore } = require('../lib/store');

// Minimal cookie-keeping client around fetch.
function client(base) {
	let cookie = '';
	return async (method, url, form) => {
		const res = await fetch(base + url, {
			method,
			redirect: 'manual',
			headers: { cookie, ...(form && { 'content-type': 'application/x-www-form-urlencoded' }) },
			body: form && new URLSearchParams(form).toString(),
		});
		const set = res.headers.get('set-cookie');
		if (set) cookie = set.split(';')[0];
		return { status: res.status, location: res.headers.get('location'), text: await res.text() };
	};
}

let server;
let base;
let store;

test.before(async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rand-'));
	store = new FileStore(path.join(dir, 'db.json'));
	await store.connect();
	server = createApp(store, { sessionSecret: 'test' }).listen(0);
	base = `http://localhost:${server.address().port}`;
});

test.after(() => server.close());

test('sign up, create a mixed build, view it, re-roll, and delete', async () => {
	const http = client(base);
	let res = await http('POST', '/register', { username: 'hooper', password: 'password1', confirm: 'password1' });
	assert.equal(res.status, 302);
	assert.equal(res.location, '/players/new');

	res = await http('GET', '/players/new');
	assert.match(res.text, /Create Player/);

	res = await http('POST', '/players', {
		name: '<b>Buckets</b>',
		position: 'PG',
		height: '',
		weight: '',
		wingspan: '',
		attributesMode: 'chaos',
		level: 'rookie',
		badgesMode: 'none',
	});
	assert.equal(res.status, 302);
	const playerUrl = res.location;
	assert.match(playerUrl, /^\/players\/[0-9a-f-]{36}$/);

	res = await http('GET', playerUrl);
	assert.equal(res.status, 200);
	assert.match(res.text, /&lt;b&gt;Buckets&lt;\/b&gt;/, 'player name is escaped');
	assert.doesNotMatch(res.text, /<b>Buckets<\/b>/);
	assert.match(res.text, /Point Guard/);
	assert.match(res.text, /0 equipped/);
	assert.match(res.text, /Rookie · 65–99/);

	res = await http('POST', `${playerUrl}/reroll`, { section: 'badges' });
	assert.equal(res.location, playerUrl);
	res = await http('GET', playerUrl);
	assert.match(res.text, /Re-rolled badges\. OVR/);

	res = await http('GET', '/players');
	assert.match(res.text, /Buckets/);
	assert.ok(res.text.includes(`action="${playerUrl}/delete"`), 'locker room has a delete control');

	res = await http('POST', `${playerUrl}/delete`);
	assert.equal(res.location, '/players');
	res = await http('GET', playerUrl);
	assert.equal(res.status, 404);
});

test('invalid physicals re-render the form with an error', async () => {
	const http = client(base);
	await http('POST', '/register', { username: 'bigman', password: 'password1', confirm: 'password1' });
	const res = await http('POST', '/players', { name: 'Big Fella', position: 'C', secondaryPosition: 'C', weight: '500' });
	assert.equal(res.status, 400);
	assert.match(res.text, /Secondary position must differ/);
	assert.match(res.text, /value="Big Fella"/, 'form input is preserved');
});

test("users cannot see each other's players", async () => {
	const owner = client(base);
	await owner('POST', '/register', { username: 'owner1', password: 'password1', confirm: 'password1' });
	const { location } = await owner('POST', '/players', { name: 'Mine' });

	const other = client(base);
	await other('POST', '/register', { username: 'other1', password: 'password1', confirm: 'password1' });
	assert.equal((await other('GET', location)).status, 404);
	assert.equal((await other('POST', `${location}/delete`)).status, 404);
	assert.equal((await owner('GET', location)).status, 200);
});

test('auth: duplicate usernames and bad logins', async () => {
	const http = client(base);
	await http('POST', '/register', { username: 'dupe', password: 'password1', confirm: 'password1' });

	const again = client(base);
	let res = await again('POST', '/register', { username: 'DUPE', password: 'password1', confirm: 'password1' });
	assert.equal(res.status, 400);
	assert.match(res.text, /taken/);
	res = await again('POST', '/login', { username: 'dupe', password: 'wrongpass' });
	assert.equal(res.status, 401);
	res = await again('POST', '/login', { username: 'dupe', password: 'password1' });
	assert.equal(res.location, '/players');
});

test('legacy 2K23 accounts can log in and are upgraded to bcrypt', async () => {
	await store.createUser({ username: 'OldTimer', passw: CryptoJS.AES.encrypt('hunter22', 'mdg').toString() });
	const http = client(base);
	const res = await http('POST', '/login', { username: 'OldTimer', password: 'hunter22' });
	assert.equal(res.location, '/players');
	const user = store.data.users.find((u) => u.username === 'OldTimer');
	assert.ok(user.passwordHash.startsWith('$2'));
	assert.equal(user.usernameLower, 'oldtimer');
});

test('guests can create, view, re-roll, and delete players without saving anything', async () => {
	const guest = client(base);
	const before = store.data.builds.length;
	let res = await guest('GET', '/players/new');
	assert.equal(res.status, 200);

	res = await guest('POST', '/players', { name: 'Walk-On', level: 'pro' });
	assert.equal(res.status, 302);
	const url = res.location;
	res = await guest('GET', url);
	assert.equal(res.status, 200);
	assert.match(res.text, /playing as a guest/);
	assert.match(res.text, /Walk-On/);

	await guest('POST', `${url}/reroll`, { section: 'attributes' });
	res = await guest('GET', url);
	assert.match(res.text, /Re-rolled attributes/);

	res = await guest('GET', '/players');
	assert.match(res.text, /Walk-On/);
	assert.match(res.text, /1\/5 used/);
	assert.equal(store.data.builds.length, before, 'nothing written to the database');

	await guest('POST', `${url}/delete`);
	assert.equal((await guest('GET', url)).status, 404);

	// Another visitor can't see a guest's player.
	await guest('POST', '/players', { name: 'Secret' });
	const secret = (await guest('GET', '/players')).text.match(/\/players\/[0-9a-f-]{36}/)[0];
	assert.equal((await client(base)('GET', secret)).status, 404);
});

test('signing up saves guest players to the new account', async () => {
	const guest = client(base);
	await guest('POST', '/players', { name: 'Keeper One' });
	await guest('POST', '/players', { name: 'Keeper Two' });

	let res = await guest('POST', '/register', { username: 'convert', password: 'password1', confirm: 'password1' });
	assert.equal(res.location, '/players');
	res = await guest('GET', '/players');
	assert.match(res.text, /Saved 2 guest players to your Locker Room/);
	assert.match(res.text, /Keeper One/);
	assert.match(res.text, /Keeper Two/);
	assert.doesNotMatch(res.text, /playing as a guest/);

	const saved = store.data.builds.filter((b) => b.owner === 'convert');
	assert.deepEqual(saved.map((b) => b.name).sort(), ['Keeper One', 'Keeper Two']);

	// After logging out, the session is fresh: no leftover guest players.
	await guest('POST', '/logout');
	res = await guest('GET', '/players');
	assert.match(res.text, /No players yet/);
});

test('logging in also saves guest players', async () => {
	const owner = client(base);
	await owner('POST', '/register', { username: 'returning', password: 'password1', confirm: 'password1' });

	const guest = client(base);
	await guest('POST', '/players', { name: 'Pickup Game' });
	const res = await guest('POST', '/login', { username: 'returning', password: 'password1' });
	assert.equal(res.location, '/players');
	assert.match((await guest('GET', '/players')).text, /Pickup Game/);
	assert.ok(store.data.builds.some((b) => b.owner === 'returning' && b.name === 'Pickup Game'));
});

test('guests are limited to a handful of unsaved players', async () => {
	const guest = client(base);
	for (let i = 1; i <= 5; i++) assert.equal((await guest('POST', '/players', { name: `G${i}` })).status, 302);
	const res = await guest('POST', '/players', { name: 'G6' });
	assert.equal(res.status, 400);
	assert.match(res.text, /Guests can keep up to 5 players/);
});

test('owners can share a read-only card, stop sharing, and links die with the player', async () => {
	const owner = client(base);
	await owner('POST', '/register', { username: 'sharer', password: 'password1', confirm: 'password1' });
	const { location: playerUrl } = await owner('POST', '/players', { name: 'Show "Off" <3' });

	let res = await owner('GET', playerUrl);
	assert.match(res.text, /Create share link/);
	assert.doesNotMatch(res.text, /\/card\//);

	res = await owner('POST', `${playerUrl}/share`);
	assert.equal(res.location, `${playerUrl}#share`);
	res = await owner('GET', playerUrl);
	const cardUrl = res.text.match(/http:\/\/localhost:\d+(\/card\/[\w-]{16})/)[1];
	assert.match(res.text, /Stop sharing/);

	// Sharing again keeps the same link.
	await owner('POST', `${playerUrl}/share`);
	assert.ok((await owner('GET', playerUrl)).text.includes(cardUrl));

	// Anyone can view it, read-only.
	const visitor = client(base);
	res = await visitor('GET', cardUrl);
	assert.equal(res.status, 200);
	assert.match(res.text, /Built by <strong>sharer<\/strong>/);
	assert.match(res.text, /Show &#34;Off&#34; &lt;3/);
	assert.match(res.text, /<meta property="og:title" content="Show &#34;Off&#34; &lt;3 · \d+ OVR/);
	assert.doesNotMatch(res.text, /\/reroll|\/delete|\/share"|Stop sharing|playing as a guest/);

	// Visitors can't act on the player through its real id.
	assert.equal((await visitor('POST', `${playerUrl}/reroll`, { section: 'badges' })).status, 404);

	await owner('POST', `${playerUrl}/unshare`);
	assert.equal((await visitor('GET', cardUrl)).status, 404);

	// Re-sharing issues a fresh link; deleting the player kills it.
	await owner('POST', `${playerUrl}/share`);
	const fresh = (await owner('GET', playerUrl)).text.match(/(\/card\/[\w-]{16})/)[1];
	assert.notEqual(fresh, cardUrl);
	assert.equal((await visitor('GET', fresh)).status, 200);
	await owner('POST', `${playerUrl}/delete`);
	assert.equal((await visitor('GET', fresh)).status, 404);
});

test('guests are asked to sign up before sharing; others cannot share your player', async () => {
	const guest = client(base);
	const { location } = await guest('POST', '/players', { name: 'Guest Share' });
	const res = await guest('POST', `${location}/share`);
	assert.equal(res.location, '/register');
	assert.match((await guest('GET', '/register')).text, /Sign up to share your player/);

	const owner = client(base);
	await owner('POST', '/register', { username: 'mine2', password: 'password1', confirm: 'password1' });
	const mine = (await owner('POST', '/players', { name: 'Mine Two' })).location;
	const other = client(base);
	await other('POST', '/register', { username: 'thief', password: 'password1', confirm: 'password1' });
	assert.equal((await other('POST', `${mine}/share`)).status, 404);
	assert.equal((await client(base)('GET', '/card/doesnotexist0000')).status, 404);
});
