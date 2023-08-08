const { MongoClient, ServerApiVersion } = require('mongodb');
const fs = require('fs');
const credentials = 'nba.pem'
const CryptoJS = require('crypto-js');
const client = new MongoClient('mongodb+srv://cluster0.4grai.mongodb.net/?authSource=%24external&authMechanism=MONGODB-X509&retryWrites=true&w=majority', {
  sslKey: credentials,
  sslCert: credentials,
  serverApi: ServerApiVersion.v1
});
async function run() {
  try {
    await client.connect();
    const database = client.db("nba");
    // perform actions using client
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}

function enc(txt){

return  CryptoJS.AES.encrypt(txt, 'mdg').toString();
}

function dec(data){
const bytes = CryptoJS.AES.decrypt(data, 'mdg');
  const originalText = bytes.toString(CryptoJS.enc.Utf8);
  return originalText;
}

async function register(username,pass){
	await client.connect();
	const database= client.db("nba");
	const collection= database.collection("users");
	const new_user= {
		username: username,
		passw: enc(pass),
		joindate: new Date().toLocaleString()
	}
	const user= await collection.findOne({username: new_user.username});
	
	if(!user){
		collection.insertOne(new_user);
		return true;
	}
	else{
		console.log("Username exists");
		return false;
	}
}

async function login(username,pass){
	await client.connect();
	const database= client.db("nba");
	const collection= database.collection("users");
	const user= await collection.findOne({username: username});
	
	if(user!= null){
		if(dec(user.passw) == pass){
		return user;
		}
		else{
			return null;
		}
	}
	else{
		return null;
	}
}

async function createPlayer(username, p) {
	const list= [];
	
	
	const new_player= { 
	username: username,
	players: list
	}
	await client.connect();
	const database= client.db("nba");
	const collection= database.collection("players");
	const player= await collection.findOne({username: new_player.username});
	
	if(!player){
		new_player.players.push(p);
		await collection.insertOne(new_player);
	}
	else{
		player.players.push(p);
		await collection.replaceOne({_id : player._id}, player);
	}
	return p;
}

async function loadPlayers(id){
	await client.connect();
	const database= client.db("nba");
	const collection= database.collection("players");
	const player= await collection.findOne({username: new_player.username});
}

run().catch(console.dir);
module.exports = { run, loadPlayers, register, login, createPlayer };