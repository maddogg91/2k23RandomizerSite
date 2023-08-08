var http = require('http');
const express = require('express');
const app = express();
const fs= require('fs');
const path= require('path');
const mongo= require('./mongoinfo.js');
var bodyParser = require('body-parser');
var helmet = require('helmet');
var rateLimit = require("express-rate-limit");
var _alert = require('alert'); 


app.set('view engine', 'ejs');
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'templates'));
app.use(express.static('public'));
app.use(express.static('images'));
app.engine('.html', require('ejs').renderFile);
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:');
const cookieParser = require("cookie-parser");
const sessions = require('express-session');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(sessions({
    secret: "thisismysecrctekeyfhrgfgrfrty84fwir767",
    saveUninitialized:true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
    resave: false 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({extended: false}));
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(limiter);
app.use(cookieParser());

const server = app.listen(7700, () => {
  console.log(`Express running → PORT ${server.address().port}`);
});


var session;

var sessionChecker = (req, res, next) => {    
    console.log(`Session Checker: ${req.session.userid}`.green);
    console.log(req.session);
    if (req.session.userid) {
        console.log(`Found User Session`.green);
        next();
    } else {
        console.log(`No User Session Found`.red);
        res.redirect('/login');
    }
};

var loggedSession = (req, res, next) => {    
    console.log(`Session Checker: ${req.session.userid}`.green);
    console.log(req.session);
    if (req.session.userid) {
        console.log(`Found User Session`.green);
        res.redirect('/portal');
    } else {
        console.log(`No User Session Found`.red);
        next();
    }
};

function createPlayer(name, username){
let templatedata= JSON.parse(fs.readFileSync('attributes.json'));
let badgesdata= JSON.parse(fs.readFileSync('badges.json'));
const p = {
		name: name,
		attributes: templatedata,
		badges: badgesdata,
		createdate: new Date().toLocaleString()
	}
mongo.createPlayer(username, p);

return p;

}

function updateOffense(){
	
	
}

app.get('/', (req, res) => {
  res.render('index.html');
});

app.get('/login', loggedSession, (req, res) => {
  
  res.render('login.html', {al: null});
});

app.post('/login', async function(req,res){
	const user= await mongo.login(req.body.username, req.body.password);
	if(!user){
		res.render('login.html', {al: 'Invalid Username or Password'});
	
	}
	else{
		session= req.session;
		session.userid= req.body.username;
		console.log(req.session);
		res.redirect('/portal');
	}
});

app.get('/register', loggedSession,  (req, res) => {

  res.render('register.html');
});

app.post('/register', async function(req,res){
	user= await mongo.register(req.body.username, req.body.password);
	if(!user){
		res.render('register.html', {al: 'User already exists'});
	
	}
	else{
		session= req.session;
		session.userid= req.body.username;
		console.log(req.session);
		res.redirect('/portal');
	}
}
);

app.get('/logout',(req,res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/portal', sessionChecker, (req,res) => {
	
	res.render('portal.html');

});

app.get('/create', sessionChecker, (req,res) => {
	
	res.render('create.html');

});

app.post('/create', sessionChecker, function (req,res){
	
	player= createPlayer(req.body.name, session.userid);
	player= randomizeStats(player);
	player= randomizeBadges(player);
	session.player= JSON.stringify(player);
	res.redirect('/randomize');

});

app.get('/randomize', sessionChecker, function (req, res){
	if(!session.player){
		res.render('create.html');
	}
	res.render('randomize.html', {player: session.player});
});

app.get('/myplayers', sessionChecker, (req,res) => {
	
	res.render('myplayers.html');

});

function randomizeStats(player){

	attributes= player.attributes;
	attributes.Offense= randomizeStat(attributes.Offense);
	attributes.Defense= randomizeStat(attributes.Defense);
	attributes.Athleticsm= randomizeStat(attributes.Athleticism);
	attributes.Durability= randomizeStat(attributes.Durability);
	attributes.Mental= mental= randomizeStat(attributes.Mental);
	attributes.Misc= randomizeStat(attributes.Misc);
	player.attributes= attributes;
	return player;
}

function randomizeStat(stat){
	for(var key in stat){
		stat[key]= Math.floor(Math.random() * (99- 70 + 1) + 70);
	}
	return stat;
}

function randomizeBadges(player){

	badges= player.badges;
	badges.InsideScoring= randomizeBadge(badges.InsideScoring);
	badges.OutsideScoring= randomizeBadge(badges.OutsideScoring);
	badges.Playmaking= randomizeBadge(badges.Playmaking);
	badges.Defending= randomizeBadge(badges.Defending);
	badges.Athleticism= randomizeBadge(badges.Athleticism);
	badges.Rebounding= randomizeBadge(badges.Rebounding);
	return player;
}

function randomizeBadge(badge){
	for(var key in badge){
		badge[key]= chooseBadge(Math.floor(Math.random() * (5- 1 + 1) + 1));
	}
	return badge;
}

function chooseBadge(numb){
	switch(numb){
		case 1:
			return "None"
		case 2:
			return "Bronze"
		case 3:
			return "Silver"
		case 4:
			return "Gold"
		case 5:
			return "Hall of Fame"
	}
}