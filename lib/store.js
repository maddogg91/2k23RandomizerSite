// Persistence for users and builds. Uses MongoDB when MONGODB_URI is set, otherwise a
// local JSON file (handy for development). Both expose the same async interface.

const fs = require('fs');
const path = require('path');

class FileStore {
	constructor(file) {
		this.file = file;
		this.data = { users: [], builds: [] };
	}

	async connect() {
		if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
		else fs.mkdirSync(path.dirname(this.file), { recursive: true });
	}

	save() {
		const tmp = `${this.file}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
		fs.renameSync(tmp, this.file);
	}

	async findUser(username) {
		const key = username.toLowerCase();
		return this.data.users.find((u) => u.usernameLower === key || u.username === username) || null;
	}

	async createUser(user) {
		this.data.users.push(user);
		this.save();
	}

	async updateUser(username, fields) {
		Object.assign(this.data.users.find((u) => u.username === username), fields);
		this.save();
	}

	async listBuilds(owner) {
		return this.data.builds.filter((b) => b.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async getBuild(id, owner) {
		return this.data.builds.find((b) => b.id === id && b.owner === owner) || null;
	}

	async createBuild(build) {
		this.data.builds.push(build);
		this.save();
	}

	async updateBuild(id, owner, fields) {
		const build = await this.getBuild(id, owner);
		if (!build) return false;
		Object.assign(build, fields);
		this.save();
		return true;
	}

	async deleteBuild(id, owner) {
		const before = this.data.builds.length;
		this.data.builds = this.data.builds.filter((b) => !(b.id === id && b.owner === owner));
		this.save();
		return this.data.builds.length < before;
	}

	async close() {}
}

class MongoStore {
	constructor(uri, options) {
		const { MongoClient, ServerApiVersion } = require('mongodb');
		const clientOptions = { serverApi: ServerApiVersion.v1 };
		if (options.certFile) clientOptions.tlsCertificateKeyFile = options.certFile;
		this.client = new MongoClient(uri, clientOptions);
		this.dbName = options.dbName;
	}

	async connect() {
		await this.client.connect();
		const db = this.client.db(this.dbName);
		this.users = db.collection('users');
		this.builds = db.collection('builds');
		await this.users.createIndex({ usernameLower: 1 }, { unique: true, sparse: true });
		await this.builds.createIndex({ owner: 1, createdAt: -1 });
		await this.builds.createIndex({ id: 1 }, { unique: true });
	}

	async findUser(username) {
		// Legacy 2K23 accounts only have `username`, so match either field.
		return this.users.findOne(
			{ $or: [{ usernameLower: username.toLowerCase() }, { username }] },
			{ projection: { _id: 0 } },
		);
	}

	async createUser(user) {
		await this.users.insertOne({ ...user });
	}

	// `username` is the exact stored value (legacy records have no usernameLower).
	async updateUser(username, fields) {
		await this.users.updateOne({ username }, { $set: fields, $unset: { passw: '' } });
	}

	async listBuilds(owner) {
		return this.builds.find({ owner }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
	}

	async getBuild(id, owner) {
		return this.builds.findOne({ id, owner }, { projection: { _id: 0 } });
	}

	async createBuild(build) {
		await this.builds.insertOne({ ...build });
	}

	async updateBuild(id, owner, fields) {
		const result = await this.builds.updateOne({ id, owner }, { $set: fields });
		return result.matchedCount > 0;
	}

	async deleteBuild(id, owner) {
		const result = await this.builds.deleteOne({ id, owner });
		return result.deletedCount > 0;
	}

	async close() {
		await this.client.close();
	}
}

function createStore(env = process.env) {
	if (env.MONGODB_URI) {
		return new MongoStore(env.MONGODB_URI, { dbName: env.MONGODB_DB || 'nba', certFile: env.MONGODB_CERT });
	}
	return new FileStore(env.DATA_FILE || path.join(__dirname, '..', '.data', 'db.json'));
}

module.exports = { createStore, FileStore, MongoStore };
