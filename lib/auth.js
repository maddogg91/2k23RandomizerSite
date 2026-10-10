const bcrypt = require('bcryptjs');
const CryptoJS = require('crypto-js');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;

function validateCredentials(username, password) {
	if (!USERNAME_PATTERN.test(username || '')) return 'Username must be 3-20 letters, numbers, or underscores.';
	if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
		return `Password must be at least ${MIN_PASSWORD} characters.`;
	}
	return null;
}

function hashPassword(password) {
	return bcrypt.hash(password, 12);
}

// Accounts from the 2K23 site stored AES-encrypted passwords (`passw`). Those are
// checked once and upgraded to bcrypt by the caller via `needsUpgrade`.
async function verifyPassword(user, password) {
	if (user.passwordHash) {
		return { ok: await bcrypt.compare(password, user.passwordHash), needsUpgrade: false };
	}
	if (user.passw) {
		const decrypted = CryptoJS.AES.decrypt(user.passw, 'mdg').toString(CryptoJS.enc.Utf8);
		return { ok: decrypted === password, needsUpgrade: true };
	}
	return { ok: false, needsUpgrade: false };
}

module.exports = { validateCredentials, hashPassword, verifyPassword };
