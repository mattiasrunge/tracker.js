
var fs = require("fs");
var express = require("express");
var compression = require("compression");
var bodyParser = require("body-parser");
var nmea = require("nmea-0183");

var config = require("./config.json");
var positions = {};

try {
  positions = require("./positions.json");
} catch (e) {
  console.log("No valid positions file found!");
}


var app = express();

app.use(bodyParser());
app.use(compression({ threshold: 512 }));

app.get(/^\/(index\.html)?$/, function(req, res) {
  res.sendfile(__dirname +  "/index.html");
});

app.get("/positions", function(req, res) {
  res.json(positions);
});

app.get("/gps", function(req, res) {
  /*
  { dev: 'Mattias Båt',
  alt: '47.900001525878906',
  code: '0xF020',
  acct: 'Mattias',
  id: 'Mattias Båt',
  gprmc: '$GPRMC,135345,A,5740.24054,N,1156.21675,E,0.000000,0.000000,160714,,*28' }
  */
  /*
  { id: 'GPRMC',
  time: '135816',
  valid: 'A',
  latitude: '57.67071100',
  longitude: '11.93728067',
  speed: 0,
  course: 0,
  date: '160714',
  mode: '',
  variation: NaN }
  */
    
  if (!req.query.id) {
    console.error("No ID received in GPS data, ignoring...");
    console.error(JSON.stringify(req.query, null, 2));
    res.send(400);
    return;
  }
  
  var data = nmea.parse(req.query.gprmc);
  
  if (!data) {
    console.error("No or invalid NMEA received in GPS data, ignoring...");
    console.error(JSON.stringify(req.query, null, 2));
    res.send(400);
    return;
  }
  
  if (data.valid !== "A") {
    console.error("Not valid GPS data, ignoring...");
    console.error(JSON.stringify(req.query, null, 2));
    console.error(JSON.stringify(data, null, 2));
    res.send(200);
    return;
  }
  
  positions[req.query.id] = {
    latitude: data.latitude,
    longitude: data.longitude,
    speed: data.speed,
    course: data.course,
    time: new Date().toString()
  };
  
  fs.writeFile("./positions.json", JSON.stringify(positions, null, 2), function(error) {
    if (error) {
      console.error("Failed to write positions file...");
      res.send(500);
      return;
    }
    
    res.send(200);
  }); 
});

app.listen(config.http.port);
