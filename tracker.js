
var mysqlNS = require('db-mysql');
var netNS = require('net');
var eventsNS = require('events');
var utilNS = require('util');


function Tracker(host, username, password, database, server_port) {
  this.host              = host;
  this.username          = username;
  this.password          = password;
  this.database          = database;
  this.tracked_node_ids  = {};
  this.server_port       = server_port;
  this.clients           = []

  var self = this;
 
  this.database = new mysqlNS.Database({
    hostname: this.host,
    user: this.username,
    password: this.password,
    database: this.database
  })

  this.database.on('error', function(error) {
    console.log('ERROR: ' + error);
  })

  this.database.on('ready', function(server) {
    console.log('Connected to ' + server.hostname + ' (' + server.version + ')');
  })

  this.database.connect(function(error) {
  
    if (error) {
      return console.log('CONNECTION error: ' + error);
    }
    
    this.query("SET time_zone='+0:00';").execute(function(error, rows, cols) {
      if (error) {
        console.log('ERROR: ' + error);
        return;
      }

      console.log('Timezone set in database!');
    });
  });


  this.server = netNS.createServer(function(socket) {

    console.log('Client connected from ' + socket.remoteAddress + ':' + socket.remotePort);

     // Bind data handler to client
    socket.on('data', function(data) {
      self.HandleClientDataReceived(socket, data);
    });


    // Bind disconnect handler to client
    socket.on('close', function() {
      console.log('Client disconnected from ' + socket.remoteAddress + ':' + socket.remotePort);
      
      self.clients = self.clients.filter(function(obj) {
        return obj !== socket;
      });

      if (self.tracked_node_ids[socket])
      {
        delete self.tracked_node_ids[socket];
      }
    });
    
    self.clients.push(socket);
    self.tracked_node_ids[socket] = true;

  });
  
  // Print out when server is running
  this.server.on('listening', function () {
    var address = self.server.address();
    console.log('TCP is now listening for clients on ' + address.address + ':' + address.port);
  });


  // Error handling
  this.server.on('error', function(error) {
    if (error.code == 'EADDRINUSE') {
      console.log('TCP port (' + self.server_port + ') in use, retrying...');

      setTimeout(function () {
        self.server.close();
        self.server.listen(self.server_port);
      }, 1000);
    }
  });


  // Start to listen for incomming connections
  this.server.listen(this.server_port);
}

  
/* Function for finding tracked object */
Tracker.prototype.Identify = function(socket, data)
{
  var self = this;

  this.database.query("SELECT `Nodes`.* FROM `Nodes`, `Attributes` WHERE `Nodes`.`type` = 'tracker' AND `Nodes`.`id` = `Attributes`.`node_id` AND `Attributes`.`name` = 'Imei' AND `Attributes`.`value` = '" + data.Imei + "'").execute(function(error, rows, cols) {
  
    if (error || rows.length == 0) {
      console.log('ERROR: ' + error);
      console.log("Unable to find a tracker with IMEI " + data.Imei);
    } else {
      var tracker_node_id = rows[0]["id"];
      var tracker_node_name = rows[0]["name"];

      console.log("Found tracker \"" + tracker_node_name + "\" (NodeId " + tracker_node_id + ") that corresponds to IMEI " + data.Imei);

      self.database.query("SELECT * FROM `Links` WHERE `node_id_up` = " + tracker_node_id + " AND `role` = 'tracker'").execute(function(error, rows, cols) {
      
        if (error || rows.length == 0) {
          console.log('ERROR: ' + error);
          console.log("Unable to find an object that is being tracked with this tracker, will store positions on the tracker itself!");

          self.tracked_node_ids[socket] = tracker_node_id;
        } else {
        
          self.database.query("SELECT * FROM `Nodes` WHERE `id` = " + rows[0]["node_id_down"]).execute(function(error, rows, cols) {
            if (error || rows.length == 0) {
              console.log('ERROR: ' + error);
              console.log("Unable to find an object that is being tracked with this tracker, will store positions on the tracker itself!");

              self.tracked_node_ids[socket] = tracker_node_id;
            } else {
              console.log("Found \"" + rows[0]["name"] + "\" (node_id " + rows[0]["id"] + ") which is being tracked by \"" + tracker_node_name + "\".");

              self.tracked_node_ids[socket] = rows[0]["id"];
            }
          });
        }
      });
    }
  });
}

/* Function for inserting new position in database */
Tracker.prototype.InsertPosition = function(tracker_node_id, data)
{
  var result = false;

  var query  =  "INSERT INTO `Positions` (`node_id`, `source`, `type`, `latitude_longitude`, `datetime`, `pdop`, `hdop`, `vdop`, `satellites`, `altitude`, `height_of_geoid`, `speed`, `angle`) VALUES (";
  query     +=  tracker_node_id + ",";
  query     +=  "'gps',";
  query     +=  "'" + data.Type + "',";
  query     +=  "GeomFromText('POINT(" + data.Latitude + " " + data.Longitude + ")'),";
  query     +=  "'20" + data.Datetime + "',";
  query     +=  data.Pdop + ",";
  query     +=  data.Hdop + ",";
  query     +=  data.Vdop + ",";
  query     +=  data.Satellites + ",";
  query     +=  data.Altitude + ",";
  query     +=  data.HeightOfGeoid + ",";
  query     +=  data.Speed + ",";
  query     +=  data.Angle;
  query     +=  ");";


//console.log(query);

  this.database.query(query).execute(function(error, rows, cols) {

    if (error) {
      console.log('ERROR: ' + error);
      console.log("Insert failed will try to reconnect to MySql database!");
    }
  });
}

Tracker.prototype.SendResponse = function(socket, id, success)
{
  var data = "";
  var json_data = {};

  json_data["jsonrpc"]  = "2.0";
  json_data["result"]   = success;
  json_data["id"]       = id;

  var data = JSON.stringify(json_data);

  console.log("Answer:" + data);

  socket.write(data);
}
  
  /* Functio for handling tracker data */
Tracker.prototype.HandleClientDataReceived = function(socket, data)
{
  if (this.tracked_node_ids[socket])
  {
    var result = true;

    var length = data.length;
    
    while (data[length - 1] == 0) {
      length--;
    }

    console.log("Received:  \"" + data + "\", len: " + length);
    
    var string = data.toString('ascii', 0, length).replace("}{", "}\n{");
    var lines = string.split("\n");

    for (var n = 0; n < lines.length; n++)
    {
      var json_string = lines[n];

      if (json_string.length == 0) {
        continue;
      }
    
      console.log(json_string + ", len: " + json_string.length);

      try {

        var json_data = JSON.parse(json_string);

        //console.log("json parsed!");

        if (json_data.method == "Tracker.AddPosition")
        {
          if (this.tracked_node_ids[socket])
          {
            this.InsertPosition(this.tracked_node_ids[socket], json_data.params);
          }
        }
        else if (json_data.method == "Tracker.Identify")
        {
          this.Identify(socket, json_data.params);
        }
        else if (json_data.method == "Tracker.StatusReport")
        {
        }
        else
        {
          console.log("Got unknown data \"" + data + "\" from client " + socket);
        }

        this.SendResponse(socket, json_data.id, result);
      } catch (exception) {
        console.log(exception);
      }
    }
  }
}

  
exports.Tracker = Tracker;
