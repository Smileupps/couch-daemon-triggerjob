process.env.NODE_PATH = "/usr/lib/nodejs:/usr/lib/node_modules:/usr/share/javascript";
//__dirname;
require('module').Module._initPaths();

var os = require("os");
var url = require('url');
var http = require('http');
var https = require('https');
var request = require('request');
var follow = require('follow');
var triggers = {};
var sysclient = http;
var thishost = [os.hostname()];

var args = process.argv.slice(2);
var config = {};
var port = 0;
var sysopt = {};
var feeds = [];

var loadTrigger = function(type) {
	if (typeof triggers[type]!=="undefined") return triggers[type];
	try {
		triggers[type] = require('./trigger-'+type);
	}catch(ex){
		log("CANNOT FIND .JS FILE FOR TRIGGER TYPE: \""+type.toString()+"\"");
		triggers[type] = false;
	}
	return triggers[type];
};

var log = function(mesg) {
  if (args.length>0) console.log(mesg);
  else console.log(JSON.stringify(["log", mesg]));
};

var escapeRegExp = function(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
};

var subst_config = function(obj) {
	// replace config values: <!myvar!> will be replaced with value of <triggerjob.myvar>
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
	//log(tries.toString()+" Marking trigger "+trkey+"@"+dockey+" as "+action);

	var ropt = { 
		method: 'PUT'
	    , url:pathurl+"/trigger/"+dockey
	    , headers : sysopt.headers
	    //, json : true
	    , body : JSON.stringify({
			'action' : action,
      		'trkey' : trkey,
      		'code' : code,
      		'out' : out	    	
	    })
	};
	//log("PREP REQUEST: "+JSON.stringify(ropt));
	//log("Trigger url: "+pathurl+"/trigger/"+dockey);

	request(ropt , function (error, response, body) {
		var e = (error||"").toString();
	  	if (e.length>0) {
	  		cb("REQUEST EXCEPTION:"+e);
	  	} else {
		  	//log("RESPONSE("+(response.statusCode||"").toString()+"):"+(body||"").substring(0,200));
			try {
        		switch(parseInt(response.statusCode)) {
        			case 200:
        			case 201:
        				cb(false,body);
        				break;

        			case 409:
	        			if (tries < 3) {
		        			setTimeout(function(){
		        				markTriggerAs(pathurl,tries+1, dockey, trkey, action, code, out, cb);
		        			},Math.random()*4000);
	        			} else {
	        				cb("Conflict persists after 3 attempts");
	        			}
        				break;

        			default:
        				cb(body)
        				break;
        		}
        	} catch(ex){
        		cb(ex);
        	}
	    }
	});


};

var executeTrigger = function(pathurl,dockey,trkey,tr,executecb){
	var cbdone = function(code,out){
		var iserrmsg = typeof code != "number";
		markTriggerAs(pathurl,0,dockey,trkey,'done',iserrmsg?false:code,iserrmsg?code:out,function(error,data){
			if (!error) {
	        	log("DONE "+ trkey+"@"+dockey+": "+(data||""));
	        	executecb();
			} else {
				executecb(error);
			}
		});		
	};

	var fn = loadTrigger((tr.type||"http").toString());
	if (fn) {
		markTriggerAs(pathurl,0,dockey,trkey,'queued',null,null,function(error,data){
			if (!error) {
	        	log("QUEUED "+ trkey+"@"+dockey+": "+(data||""));

				fn(log,sysopt,pathurl,tr,dockey,trkey,cbdone);
			} else {
				executecb(error);
			}
		})
	} else {
		executecb("Cannot find trigger type \""+(tr.type||"http")+"\"");
	}
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
	var cb=function(err){
		if (typeof err !== "undefined") {
			log("EXECUTEAT-CB: "+(err||"UNK-ERROR"));
		}
	}, opt=sysopt, pathurl=""; 
    opt.pathname = path;
	pathurl = url.format(opt);

	log("Following path: "+path);
	log("Following url: "+pathurl);
	return follow({db:pathurl+"/follow",headers:opt.headers}, function(error, change) {
	    //log("follow changes return a doc");
		  if(!error) {
		    log("Got change number " + change.seq + ": " + change.id);
		    for (var trkey in change.doc&&change.doc.triggers?change.doc.triggers:{}){
		    	var tr = change.doc.triggers[trkey];
				if (typeof tr.queued==="undefined" && (!tr.h||thishost.indexOf(tr.h||"")>=0)) {
					log("CALLING ExecuteAt "+trkey)
					executeAt(pathurl,change.id,trkey,subst_config(tr),cb);
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
	sysopt = url.parse(args[0]||"");
	sysopt.method = "GET";
	var credentials = "Basic "+(new Buffer(args[1]||"").toString('base64'));
    sysopt.headers = {authorization:credentials?credentials:""}

	var schema = ["http","https"].indexOf((sysopt.protocol||"").toLowerCase().split(":")[0]);
	if (schema === 1) {
		sysclient = https;
		sysopt.protocol = "https:";
		//sysopt.hostname = sysopt.host;
		//sysopt.port = sysopt.port||443;
	}

    var opt=sysopt; 
    opt.path = "/_config/triggerjob"; opt.method = "GET";
	var req = sysclient.request(opt, function(response) {
        var body = '';
        response.on('data', function(d) {
            body += d;
        });
        response.on('end', function(d) {
            try {
            	if (response.statusCode!=200) throw(body);
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
			var credentials = "Basic "+(new Buffer(config.job_authorization||"").toString('base64'));

			sysclient = http;
			sysopt = url.parse("http://127.0.0.1:"+port.toString());
			//sysopt.host = "127.0.0.1:"+port;
			//sysopt.hostname = "127.0.0.1";
			delete sysopt.host;
			//sysopt.port = port;
			sysopt.method = "GET";
		    sysopt.headers = {authorization:credentials?credentials:""}

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
