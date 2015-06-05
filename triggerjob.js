var url = require('url');
var http = require('http');
var https = require('https');
var follow = require('follow');

var args = process.argv.slice(2);
var config = {};
var port = 0;
var credentials = false;
var feeds = [];

var log = function(mesg) {
  if (args.length>0) console.log(mesg);
  else console.log(JSON.stringify(["log", mesg]));
};

var serialize = function(obj, prefix) {
  var str = [];
  for(var p in obj) {
    if (obj.hasOwnProperty(p)) {
      var k = prefix ? prefix + "[" + p + "]" : p, v = obj[p];
      str.push(typeof v == "object" ?
        serialize(v, k) :
        encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
  }
  return str.join("&");
}

var escapeRegExp = function(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
};

var subst_config = function(obj) {
	if (typeof obj!="object") return obj;
	var newtr = JSON.stringify(obj);
	if (typeof obj.allowed == "object") {
		for (var i in obj.allowed) {
			var k = obj.allowed[i];
			if (config[k]) {
				newtr = newtr.replace(new RegExp(escapeRegExp("<!"+k+"!>"),'gi'),config[k]);
			}
		}
	}
	newtr = newtr.replace(/<![^!]+!>/gi,"<!VAR-UNKNOWN-OR-NOT-ALLOWED!>");
	return JSON.parse(newtr);
};


var markTriggerAs = function(pathurl,tries, dockey, trkey, action, code, out, cb) {
	log(tries.toString()+" Marking trigger "+trkey+"@"+dockey+" as "+action);
	var req = http.request({
        host: "127.0.0.1",
        port: port.toString(),
        path: pathurl+"/trigger/"+dockey,
        method : "PUT",
        headers:{authorization:credentials?credentials:""}
    }, function(response) {
        var body = '';
        response.on('data', function(d) {
            body += d;
        });
        response.on('end', function() {
        	//log(tries.toString()+" Marking trigger "+ trkey+"@"+dockey+" as "+action+" onend "+body);
        	try {
        		var parsed = JSON.parse(body);
        		if (parsed.error) {
        			switch(parsed.error) {
        				case "conflict":
		        			if (tries < 3) {
			        			setTimeout(function(){
			        				markTriggerAs(pathurl,tries+1, dockey, trkey, action, code, out, cb);
			        			},Math.random()*4000);
		        			} else {
		        				cb(parsed.reason);
		        			}
        					break;
        				default:
        					cb(parsed.reason);
        					break;
        			}
        		} else {
        			if (!parsed.ok)log("UNK:"+body);
        			var err = !parsed.ok?(parsed.msg||"Unknown error"):false;
	        		cb(err,parsed);
        		}
        	} catch(ex){
        		cb(ex);
        	}
        });
    });
    req.on('error', function(ex) {
		cb(ex);
	});
	req.write(JSON.stringify({ 
      'action' : action,
      'trkey' : trkey,
      'code' : code,
      'out' : out
    }));
    req.end();	
};

var executeTrigger = function(pathurl,dockey,trkey,tr,cb){
	var cbdone = function(code,out){
		var err = typeof code != "number";
		markTriggerAs(pathurl,0,dockey,trkey,'done',err?null:code,err?err:out,function(error,data){
    		//log(error);
			if (!error) {
	        	log("DONE "+ trkey+"@"+dockey+": "+JSON.stringify(data));
	        	cb();
			} else {
				cb(error);
			}
		});		
	};

	markTriggerAs(pathurl,0,dockey,trkey,'queued',null,null,function(error,data){
        //log(error);
		if (!error) {
        	log("QUEUED "+ trkey+"@"+dockey+": "+JSON.stringify(data));

    		// replace config values: {{myvar}} will be replaced with value of <triggerjob.myvar>
        	var schema = ["http","https"].indexOf((tr.path||"").toLowerCase().split(":")[0]),
        		httpclient=http, opt = {},
        		opt = url.parse(tr.path||"");
        	if (typeof tr.path=="string") {
	        	switch(schema) {
	        		case 0:
	        			httpclient=http;
	        			opt.port = 80; // overwrite
	        			break;
	        		case 1:
						httpclient=https;
	        			opt.port = 443; // overwrite
	        			break;
	        		default:
	        			opt.host = '127.0.0.1'; // overwrite
	        			opt.port = port.toString(); // overwrite
	        			opt.path = pathurl+opt.path;
	        			if (credentials) {
	        				tr.headers = tr.headers?tr.headers:{};
	        				tr.headers.authorization = credentials;
	        			}
	        			cbdone("Invalid schema");
	        			break;
	        	}

	        	opt.headers = tr.headers||{};
	        	opt.method = (tr.method||"PUT").toUpperCase();
	        	//log(JSON.stringify(opt));
				var req = httpclient.request(opt, function(response) {
			        var body = '';
			        response.on('data', function(d) {
			            body += d;
			        });
			        response.on('end', function() {
	        			log((body||"").substring(0,200));
		        		cbdone(response.statusCode,body);
			        });
			    });
			    req.on('error', function(ex) {
			    	cbdone(ex);
				});
				req.write(tr.asquery?serialize(tr.params||"{}"):JSON.stringify(tr.params||{}));
				req.end();
			} else {
				cbdone("Trigger parameter \"path\" does not exists or is not a string");
			}
		} else {
			cb(error);
		}
	})
};

var executeAt =function(pathurl,id,trkey,tr,cb) {
    var now = new Date().getTime();
	//tr.start = now+20000;
	if ((tr.delay||0)>0) {
		setTimeout(function(){
			markTriggerAs(pathurl,0,id,trkey,'delay',null,null,function(error,data){
				if (error) cb(error);
			});
		},2000+Math.random()*2000);
	} else {
		log("Should start at :"+(tr.start||0).toString()+" now:"+(now).toString());
		if ((tr.start||0) < now){
			setTimeout(function(){
				executeTrigger(pathurl,id,trkey,tr,cb);
			},Math.random()*4000);
		} else {
			var toelapse = tr.start-now;
			log("Postponing of :"+toelapse.toString()+" ms");
			setTimeout(function(){
				executeTrigger(pathurl,id,trkey,tr,cb);
			},toelapse);
		}
	}
};

var followChanges = function(path) {
	var cb=function(){},
		pathurl="http://127.0.0.1:"+port.toString()+path;
	log("Following url: "+path);
	return follow({db:pathurl+"/follow",headers:{authorization:credentials?credentials:""}}, function(error, change) {
		  if(!error) {
		    //console.log("Got change number " + change.seq + ": " + change.id);
		    for (var trkey in change.doc&&change.doc.triggers?change.doc.triggers:{}){
		    	var tr = change.doc.triggers[trkey];
				if (!tr.queued) {
					executeAt(path,change.id,trkey,subst_config(tr),cb);
				}
		    }
		  } else {
		  	log(error.toString());
		  }
	});
};

var start = function(paths){
	if (config.job_path) delete config.job_path;
	if (config.job_authorization) delete config.job_authorization;
	if (typeof paths == "string" && paths.length>0) {
		paths = paths.split(',');
		for (var i in paths) {
			if (paths[i].length>0) {
				feeds[paths[i]] = followChanges(paths[i]);
			}
		}
	} else {
		log("Invalid triggerjob.job_path");
	}
};

var cmdlineinit = function(){
	port = args[0];
	credentials = "Basic "+(new Buffer(args[1]||"").toString('base64'));

	var req = http.request({
        host: "127.0.0.1",
        port: port.toString(),
        path: "/_config/triggerjob",
        method : "GET",
        headers:{authorization:credentials?credentials:""}
    }, function(response) {
        var body = '';
        response.on('data', function(d) {
            body += d;
        });
        response.on('end', function(d) {
            try {
            	config = JSON.parse(body);
            	start(config.job_path);
            } catch(ex) {
            	log("init exception: "+ ex.toString());
            }
        });
    }).on('error', function(ex) {
    	log(ex);
	}).end();
};


// We use stdin in a couple ways. First, we
// listen for data that will be the requested
// port information. We also listen for it
// to close which indicates that CouchDB has
// exited and that means its time for us to
// exit as well.
var stdin = process.openStdin();

stdin.on('data', function(msg) {
	var parsed = {};
	//log("Receiving stdin message: " + msg);
	try {
		parsed = JSON.parse(msg);
		if (parseInt(parsed)==parsed) {
			port = parseInt(parsed);
			console.log(JSON.stringify(["register", "triggerjob"]));
			console.log(JSON.stringify(["get", "triggerjob"]));
		} else if (parsed.couchdb) { // welcome message
			//log("welcome message: " + msg);
		} else if (parsed.job_path)  { 
			//log("triggerjob config: " + msg);
			config = parsed;
			credentials = "Basic "+(new Buffer(config.job_authorization||"").toString('base64'));
			start(config.job_path);
		} else {
			log("Discarding unknown message: " + msg);
		}
	} catch(ex){
		log("Not a JSON string: " + msg);
	}
});

stdin.on('end', function () {
	for (var i in feeds){
		log("Stopping feed "+feeds[i]);
		feeds[i].stop();
		delete feeds[i];
	}
	process.exit(0);
});

if (args.length>0) {
	// port and config from command line
	cmdlineinit();
} else {
	// port and config from stdin
	console.log(JSON.stringify(["get", "httpd", "port"]));
}
