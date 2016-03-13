var url = require('url');
var request = require('request'),
  zlib = require('zlib');

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

module.exports = function(log,sysopt,pathurl,tr,dockey,trkey,cbdone){
	try {
		var schema = ["http","https"].indexOf((tr.path||"").toLowerCase().split(":")[0]),
			opt = {}, 
			parsedpath=url.parse(tr.path||"");
		if (typeof tr.path=="string") {
			switch(schema) {
				case 0: // abolute path over http
					opt = parsedpath;
					opt.host=opt.hostname;
					opt.port = 80; // overwrite
					break;
				case 1: // abolute path over https
					opt = parsedpath;
					opt.host=opt.hostname;
					opt.port = 443; // overwrite
					break;
				default: // relative path
					opt = url.parse(pathurl);
					opt.path = (opt.path+'/'+parsedpath.path).replace(/\/\//g,'/');
					opt.pathname = (opt.pathname+'/'+parsedpath.pathname).replace(/\/\//g,'/');

					if (sysopt.headers&&sysopt.headers.authorization) {
						tr.headers = tr.headers?tr.headers:{};
						tr.headers.authorization = sysopt.headers.authorization;
					}
					break;
			}

			opt.headers = tr.headers||{};
			opt.method = (tr.method||"PUT").toUpperCase();

			var ropt = { 
				method: opt.method
			    , url:url.format(opt)
			    , headers : opt.headers
			    , gzip: tr.gzip||false
			};

			if (tr.form) ropt.form = tr.form;
			if (typeof tr.params=="object") ropt.body = JSON.stringify(tr.params);

			log("PREP REQUEST: "+JSON.stringify({
				method: ropt.method
			    , url:ropt.url
			    , gzip:ropt.gzip
			    , headers : ropt.headers
			}));

			request(ropt , function (error, response, body) {
				var e = (error||"").toString();
			  	if (e.length>0) {
			  		cbdone("REQUEST EXCEPTION:"+e);
			  	} else {
				  	log("RESPONSE("+(response.statusCode||"").toString()+"):"+(body||"").substring(0,200));
			    	cbdone(response.statusCode,body);
			    }
			});
		} else {
			cbdone("REQUEST ERROR: Trigger parameter \"path\" does not exists or is not a string");
		}
	} catch(ex){
		log("TRIGGER HTTP EXCEPTION: " + ex);
	}
};