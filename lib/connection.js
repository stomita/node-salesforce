var events  = require('events')
  , request = require('request')
  , async   = require('async')
  , _       = require('underscore')._
  , OAuth2  = require('./oauth2')
  , Query   = require('./query')
  , SObject = require('./sobject')
  , path    = require('path')
  ;

/**
 * constructor
 */
var Connection = module.exports = function(options) {
  this.initialize(options || {});
};

/**
 *
 */
Connection.prototype = new events.EventEmitter();

var loginUrl = "https://login.salesforce.com"
  , instanceUrl = "https://{instance}.salesforce.com"
  , version  = "23.0"
  ;

/**
 * initialize
 */
Connection.prototype.initialize = function(options) {
  this.loginUrl  = options.loginUrl || this.loginUrl || loginUrl;
  this.version   = options.version || this.version || version;
  this.instanceUrl = options.instanceUrl || options.serverUrl || this.instanceUrl || 
                     instanceUrl.replace("{instance}", options.instance || "na1");
  this.serverPath = options.serverPath;
  this.metadataServerUrl = options.metadataServerUrl;
  this.passwordExpired = options.passwordExpired;
  this.type = options.type || "partner"; // type of API - partner or enterprise
  var typeUrl = (options.type==="partner") ? 'u' : 'c';
  this.urls = {
    soap : {
      login : [ this.loginUrl, "services/Soap", typeUrl, this.version ].join('/')
    },
    rest : {
      base : [ this.instanceUrl, "services/data", "v" + this.version ].join('/')
    },
    streaming: {
      base : [ this.instanceUrl, "cometd", this.version ].join('/')
    }
  };
  if (options.clientId) {
    this.oauth2 = new OAuth2({
      authzServiceUrl : this.loginUrl + "/services/oauth2/authorize",
      tokenServiceUrl : this.loginUrl + "/services/oauth2/token",
      clientId : options.clientId,
      clientSecret : options.clientSecret,
      redirectUri : options.redirectUri
    });
  }
  this.accessToken = options.sessionId || options.accessToken || this.accessToken;
  this.userInfo = options.userInfo || null;
  this.refreshToken = options.refreshToken || this.refreshToken;
  if (this.oauth2 && this.refreshToken) {
    this.removeAllListeners('auth');
    this.once('auth', _.bind(this._refresh, this));
  }
  this.maxRequest = options.maxRequest || this.maxRequest || 10;
};


/**
 * Sending request to API endpoint
 * @private
 */
Connection.prototype._request = function(params, callback, noContentResponse) {
  var self = this;
  var onResume = function() {
    self._request(params, callback, noContentResponse); 
  };
  if (self.suspended) {
    self.once('resume', onResume);
    return;
  }
  params.headers = params.headers || {};
  if (this.accessToken) {
    params.headers.Authorization = "OAuth " + this.accessToken;
  }
  self.emit('request', params.method, params.url, params);
  request(params, function(err, response) {
    if (err) {
      callback(err);
    } else {
      self.emit('response', response.statusCode, response.body, response);
      // if authorization required and auth handler is available
      if (response.statusCode === 401 && self.listeners('auth').length >= 0) {
        self.suspended = true;
        self.once('resume', onResume);
        self.emit('auth');
        return;
      }
      if (response.statusCode >= 400) {
        var errors;
        try {
          errors = JSON.parse(response.body);
        } catch(e) {
          errors = [{ message : response.body }];
        }
        callback(errors[0]);
      } else if (response.statusCode === 204) {
        callback(null, noContentResponse);
      } else {
        var res;
        try {
          res = JSON.parse(response.body);
        } catch(e2) {
          err = e2;
        }
        if (response.statusCode === 300) { // Multiple Choices
          err = { message : 'Multiple records found' };
        }
        callback(err, res);
      }
    }
  });
};

/**
 * Refresh access token
 * @private
 */
Connection.prototype._refresh = function() {
  var self = this;
  this.oauth2.refreshToken(this.refreshToken, function(err, res) {
    if (!err) {
      self.initialize({
        instanceUrl : res.instance_url,
        accessToken : res.access_token
      });
      self.once('auth', _.bind(self._refresh, self));
    }
    self.suspended = false;
    self.emit('resume');
  });
};


/**
 * query
 */
Connection.prototype.query = function(soql, callback) {
  var query = new Query(this, soql);
  if (callback) {
    query.run(callback);
  }
  return query;
};

/**
 * queryMore
 */
Connection.prototype.queryMore = function(locator, callback) {
  var query = new Query(this, null, locator);
  if (callback) {
    query.run(callback);
  }
  return query;
};


/**
 * retrieve
 */
Connection.prototype.retrieve = function(type, ids, callback) {
  var self = this;
  var isArray = _.isArray(ids);
  ids = isArray ? ids : [ ids ];
  if (ids.length > self.maxRequest) {
    callback({ message : "Exceeded max limit of concurrent call" });
    return;
  }
  async.parallel(_.map(ids, function(id) {
    return function(cb) {
      var url = [ self.urls.rest.base, "sobjects", type, id ].join('/');
      self._request({
        method : 'GET',
        url : url
      }, cb);
    };
  }), function(err, results) {
    callback(err, !isArray && _.isArray(results) ? results[0] : results);
  });
};


/**
 * create
 */
Connection.prototype.create = function(type, records, callback) {
  if (arguments.length === 2) {
    type = null;
    records = type;
    callback = records;
  }
  var self = this;
  var isArray = _.isArray(records);
  records = isArray ? records : [ records ];
  if (records.length > self.maxRequest) {
    callback({ message : "Exceeded max limit of concurrent call" });
    return;
  }
  async.parallel(_.map(records, function(record) {
    return function(cb) {
      var sobjectType = type || (record.attributes && record.attributes.type) || record.type;
      if (!sobjectType) {
        cb({ message : 'No SObject Type defined in record' });
        return;
      }
      record = _.clone(record);
      delete record.Id;
      delete record.type;
      delete record.attributes;

      var url = [ self.urls.rest.base, "sobjects", sobjectType ].join('/');
      self._request({
        method : 'POST',
        url : url,
        body : JSON.stringify(record),
        headers : {
          "Content-Type" : "application/json"
        }
      }, cb);
    };
  }), function(err, results) {
    callback(err, !isArray && _.isArray(results) ? results[0] : results);
  });
};

/**
 * update
 */
Connection.prototype.update = function(type, records, callback) {
  if (arguments.length === 2) {
    type = null;
    records = type;
    callback = records;
  }
  var self = this;
  var isArray = _.isArray(records);
  records = isArray ? records : [ records ];
  if (records.length > self.maxRequest) {
    callback({ message : "Exceeded max limit of concurrent call" });
    return;
  }
  async.parallel(_.map(records, function(record) {
    return function(cb) {
      var id = record.Id;
      if (!id) {
        cb({ message : 'Record id is not found in record.' });
        return;
      }
      var sobjectType = type || (record.attributes && record.attributes.type) || record.type;
      if (!sobjectType) {
        cb({ message : 'No SObject Type defined in record' });
        return;
      }
      record = _.clone(record);
      delete record.Id;
      delete record.type;
      delete record.attributes;

      var url = [ self.urls.rest.base, "sobjects", sobjectType, id ].join('/');
      self._request({
        method : 'PATCH',
        url : url,
        body : JSON.stringify(record),
        headers : {
          "Content-Type" : "application/json"
        }
      }, cb, { id : id, success : true, errors : [] });
    };
  }), function(err, results) {
    callback(err, !isArray && _.isArray(results) ? results[0] : results);
  });
};

/**
 * upsert
 */
Connection.prototype.upsert = function(type, records, extIdField, callback) {
  // You can omit "type" argument, when the record includes type information.
  if (arguments.length === 3) {
    type = null;
    records = type;
    extIdField = records;
    callback = extIdField;
  }
  var self = this;
  var isArray = _.isArray(records);
  records = isArray ? records : [ records ];
  if (records.length > self.maxRequest) {
    callback({ message : "Exceeded max limit of concurrent call" });
    return;
  }
  async.parallel(_.map(records, function(record) {
    return function(cb) {
      var sobjectType = type || (record.attributes && record.attributes.type) || record.type;
      var extId = record[extIdField];
      if (!extId) {
        cb({ message : 'External ID is not defined in the record' });
        return;
      }
      record = _.clone(record);
      delete record[extIdField];
      delete record.type;
      delete record.attributes;

      var url = [ self.urls.rest.base, "sobjects", sobjectType, extIdField, extId ].join('/');
      self._request({
        method : 'PATCH',
        url : url,
        body : JSON.stringify(record),
        headers : {
          "Content-Type" : "application/json"
        }
      }, cb, { success : true, errors : [] });
    };
  }), function(err, results) {
    callback(err, !isArray && _.isArray(results) ? results[0] : results);
  });
};



/**
 * destroy
 */
Connection.prototype.del =
Connection.prototype.destroy = function(type, ids, callback) {
  var self = this;
  var isArray = _.isArray(ids);
  ids = isArray ? ids : [ ids ];
  if (ids.length > self.maxRequest) {
    callback({ message : "Exceeded max limit of concurrent call" });
    return;
  }
  async.parallel(_.map(ids, function(id) {
    return function(cb) {
      var url = [ self.urls.rest.base, "sobjects", type, id ].join('/');
      self._request({
        method : 'DELETE',
        url : url
      }, cb, { id : id, success : true, errors : [] });
    };
  }), function(err, results) {
    callback(err, !isArray && _.isArray(results) ? results[0] : results);
  });
};


/**
 * describe
 */
Connection.prototype.describe = function(type, callback) {
  var url = [ this.urls.rest.base, "sobjects", type, "describe" ].join('/');
  this._request({
    method : 'GET',
    url : url
  }, callback);
};

/**
 * describeGlobal
 */
Connection.prototype.describeGlobal = function(callback) {
  var url = this.urls.rest.base + "/sobjects";
  this._request({
    method : 'GET',
    url : url
  }, callback);
};


/**
 * sobject
 */
Connection.prototype.sobject = function(type) {
  this._sobjects = this._sobjects || {};
  var sobject = this._sobjects[type] = 
    this._sobjects[type] || new SObject(type, this);
  return sobject;
};


/**
 * Authorize (using oauth2 web server flow)
 */
Connection.prototype.authorize = function(code, callback) {
  var self = this;
  this.oauth2.requestToken(code, function(err, res) {
    if (err) {
      callback(err);
      return;
    }
    self.initialize({
      instanceUrl : res.instance_url,
      accessToken : res.access_token,
      refreshToken : res.refresh_token
    });
    callback(null);
  });
};


/**
 * login (using oauth2 username & password flow)
 */
Connection.prototype.login = function(username, password, callback) {
  if (this.oauth2) {
    this.loginByOAuth2(username, password, callback);
  } else {
    this.loginBySoap(username, password, callback);
  }
};


/**
 * Login by OAuth2 username & password flow
 */
Connection.prototype.loginByOAuth2 = function(username, password, callback) {
  var self = this;
  this.oauth2.authenticate(username, password, function(err, res) {
    if (err) {
      callback(err);
      return;
    }
    self.initialize({
      instanceUrl : res.instance_url,
      accessToken : res.access_token
    });
    callback(null);
  });
};

/**
 * Login by SOAP web service API
 */
Connection.prototype.loginBySoap = function(username, password, callback) {
  var self = this;
  var body = [
    '<se:Envelope xmlns:se="http://schemas.xmlsoap.org/soap/envelope/">',
    '<se:Header xmlns:sfns="urn:' + this.type + '.soap.sforce.com"/>',
    '<se:Body>',
    '<login xmlns="urn:' + this.type + '.soap.sforce.com" xmlns:ns1="sobject.' + this.type + '.soap.sforce.com">',
    '<username>' + _esc(username) + '</username>',
    '<password>' + _esc(password) + '</password>',
    '</login>',
    '</se:Body>',
    '</se:Envelope>'
  ].join('');

  request({
    method : 'POST',
    url : this.urls.soap.login,
    body : body,
    headers : {
      "Content-Type" : "text/xml",
      "SOAPAction" : '""'
    }
  }, function(err, response) {
    if (err) {
      callback(err);
      return;
    } 
    if (response.statusCode >= 400) {
      callback({ message : response.body });
      return;
    }
    
    var m = response.body.match(/<serverUrl>([^<]+)<\/serverUrl>/);
    var serverUrl = m && m[1];
    m = response.body.match(/<metadataServerUrl>([^<]+)<\/metadataServerUrl>/);
    var metadataServerUrl = m && m[1];
    m = response.body.match(/<sessionId>([^<]+)<\/sessionId>/);
    var sessionId = m && m[1];
    m = response.body.match(/<passwordExpired>([^<]+)<\/passwordExpired>/);
    var passwordExpired = m && m[1];

    // Grab some useful stuff from the <userInfo> section of the SOAP response
    var userInfo = {};
    m = response.body.match(/<userId>([^<]+)<\/userId>/);
    userInfo.userId = m && m[1];
    m = response.body.match(/<userFullName>([^<]+)<\/userFullName>/);
    userInfo.userFullName = m && m[1];
    m = response.body.match(/<roleId>([^<]+)<\/roleId>/);
    userInfo.roleId = m && m[1];
    m = response.body.match(/<profileId>([^<]+)<\/profileId>/);
    userInfo.profileId = m && m[1];
    m = response.body.match(/<userType>([^<]+)<\/userType>/);
    userInfo.userType = m && m[1];
    m = response.body.match(/<organizationName>([^<]+)<\/organizationName>/);
    userInfo.organizationName = m && m[1];

    var split = serverUrl.split('/'),
    sUrl = split.slice(0, 3).join('/'),
    sPath = split.slice(3, split.length).join('/');

    self.initialize({
      serverUrl: sUrl,
      serverPath: sPath,
      metadataServerUrl: metadataServerUrl,
      sessionId: sessionId,
      passwordExpired: passwordExpired,
      userInfo: userInfo,
      type: self.type
    });

    callback(null);
  });
};

/**
 * Logout & invalidate sessionId by SOAP web service API
 */
Connection.prototype.logout = function(callback) {
  var self = this,
  sessionId = this.accessToken;
  if (this.type!=="enterprise"){
    callback("Error: Logout API is only available for the Enterprise API. Did you specify type:'enterprise' when setting up the connection? ");
  }

  var body = [
    '<se:Envelope xmlns:se="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:' + this.type + '.soap.sforce.com">',
    '<se:Header>',
      '<urn:SessionHeader>',
        '<urn:sessionId>' + _esc(sessionId) + '</urn:sessionId>',
      '</urn:SessionHeader>',
    '</se:Header>',
    '<se:Body>',
      '<urn:logout/>',
    '</se:Body>',
    '</se:Envelope>'
  ].join('');

  request({
    method : 'POST',
    url : this.urls.soap.login,
    body : body,
    headers : {
      "Content-Type" : "text/xml",
      "SOAPAction" : '""'
    }
  }, function(err, response) {
    if (err) {
      callback(err);
      return;
    }
    if (response.statusCode >= 400) {
      callback({ message : response.body });
      return;
    }

    // Destroy the session bound to this connection
    self.accessToken = null;
    self.userInfo = null;
    self.refreshToken = null;
    self.instanceUrl = null;

    // nothing useful returned by logout API, just return
    callback(null);
  });
};

/*
 * Private function to connection.js for escaping strings prior to their input into soap
 */
function _esc(str) {
  return str && String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}