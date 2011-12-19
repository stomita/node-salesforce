var events  = require('events')
  , util    = require('util')
  , request = require('request')
  , async   = require('async')
  , _       = require('underscore')._
  ;

var loginUrl = "https://login.salesforce.com"
  , serverUrl  = "https://instance.salesforce.com"
  , version  = "23.0"
  ;

/**
 * Connection
 */
var Connection = exports.Connection = function(options) {
  this.initialize(options);
};

/**
 *
 */
Connection.prototype.initialize = function(options) {
  this.loginUrl  = options.loginUrl || this.loginUrl || loginUrl;
  this.version   = options.version || this.version || version;
  this.serverUrl = options.serverUrl || this.serverUrl || serverUrl.replace("instance", options.instance || "na1");
  this.urls = {
    soap : {
      login : [ this.loginUrl, "services/Soap/u", this.version ].join('/')
    },
    rest : {
      base : [ this.serverUrl, "services/data", "v" + this.version ].join('/')
    }
  };
  this.urls.rest.query = this.urls.rest.base + "/query";
  this.accessToken = options.sessionId || options.accessToken || this.accessToken;
//  this.flattenNS = options.flattenNS || false; 
  this.maxRequest = options.maxRequest || this.maxRequest || 10;
};


/**
 *
 */
Connection.prototype.query = function(soql, callback) {
  var query = new Query(this, soql);
  if (callback) {
    query.run(callback);
  }
  return query;
};

/**
 *
 */
Connection.prototype.queryMore = function(locator, callback) {
  var query = new Query(this, null, locator);
  if (callback) {
    query.run(callback);
  }
  return query;
};

/**
 *
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
      var url = self.urls.rest.base + "/sobjects/" + type + "/" + id;
      request({
        method : 'GET',
        url : url,
        headers : {
          "Authorization" : "OAuth " + self.accessToken
        }
      }, function(err, response) {
        if (err) {
          cb(err);
        } else {
          cb(null, JSON.parse(response.body));
        }
      });
    };
  }), function(err, results) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, isArray ? results : results[0]);
  });
};


/**
 *
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
      var so = record.type || type;
      if (!so) {
        cb({ message : 'No SObject Type defined in record' });
        return;
      }
      if (record.type) {
        record = JSON.parse(JSON.stringify(record));
        delete record.type;
      }
      var url = self.urls.rest.base + "/sobjects/" + so;
      request({
        method : 'POST',
        url : url,
        body : JSON.stringify(record),
        headers : {
          "Authorization" : "OAuth " + self.accessToken,
          "Content-Type" : "application/json"
        }
      }, function(err, response) {
        if (err) {
          cb(err);
        } else {
          cb(null, JSON.parse(response.body));
        }
      });
    };
  }), function(err, results) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, isArray ? results : results[0]);
  });
};

/**
 *
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
      var so = record.type || type;
      if (!so) {
        cb({ message : 'No SObject Type defined in record' });
        return;
      }
      record = JSON.parse(JSON.stringify(record));
      if (record.type) {
        delete record.type;
      }
      var id = record.Id;
      delete record.Id;
      var url = self.urls.rest.base + "/sobjects/" + so + "/" + id;
      request({
        method : 'PATCH',
        url : url,
        body : JSON.stringify(record),
        headers : {
          "Authorization" : "OAuth " + self.accessToken,
          "Content-Type" : "application/json"
        }
      }, function(err, response) {
        if (err) {
          cb(err);
        } else {
          cb(null, { id : id, success : true, errors : [] });
        }
      });
    };
  }), function(err, results) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, isArray ? results : results[0]);
  });
};

/**
 *
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
      var id = id;
      var url = self.urls.rest.base + "/sobjects/" + type + "/" + id;
      request({
        method : 'DELETE',
        url : url,
        headers : {
          "Authorization" : "OAuth " + self.accessToken,
          "Content-Type" : "application/json"
        }
      }, function(err, response) {
        if (err) {
          cb(err);
        } else {
          cb(null, { id : id, success : true, errors : [] });
        }
      });
    };
  }), function(err, results) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, isArray ? results : results[0]);
  });
};


/**
 *
 */
Connection.prototype.sobject = function(type) {
  return new SObjectCollection(type, this);
};

/**
 *
 */
Connection.prototype.login = function(username, password, callback) {
  function esc(str) {
    return str && String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var self = this;
  var body = [
    '<se:Envelope xmlns:se="http://schemas.xmlsoap.org/soap/envelope/">',
    '<se:Header xmlns:sfns="urn:partner.soap.sforce.com"/>',
    '<se:Body>',
    '<login xmlns="urn:partner.soap.sforce.com" xmlns:ns1="sobject.partner.soap.sforce.com">',
    '<username>' + esc(username) + '</username>',
    '<password>' + esc(password) + '</password>',
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
    var m = response.body.match(/<serverUrl>([^<]+)<\/serverUrl>/);
    var serverUrl = m && m[1];
    m = response.body.match(/<sessionId>([^<]+)<\/sessionId>/);
    var sessionId = m && m[1];
    self.initialize({ 
      serverUrl: serverUrl.split('/').slice(0, 3).join('/'), 
      sessionId: sessionId
    });
    callback(null);
  });
};



/**
 * Query
 */
var Query = exports.Query = function(conn, soql, locator) {
  this._conn = conn;
  this._soql = soql;
  if (locator && locator.indexOf("/") >= 0) {
    locator = locator.split("/").pop();
  }
  this._locator = locator;
};

util.inherits(Query, events.EventEmitter);

/**
 *
 */
Query.prototype.run = 
Query.prototype.exec = 
Query.prototype.execute = function(callback) {
  if (typeof callback === "function") {
    this.once('response', function(res) { callback(null, res); });
  }
  var self = this;
  self.totalFetched = 0;
  var url = self._locator ?
            self._conn.urls.rest.query + "/" + self._locator :
            self._conn.urls.rest.query + "?q=" + encodeURIComponent(self._soql);
  request({
    method : 'GET',
    url : url,
    headers : {
      "Authorization" : "OAuth " + self._conn.accessToken
    }
  }, function(err, response) {
    if (err) {
      self.emit("error", err);
      return;
    }
    var data;
    try {
      data = JSON.parse(response.body);
    } catch(e) {
      self.emit("error", e);
    }
    self.emit("response", data);
    _.forEach(data.records, function(record, i) {
      if (!self.stopQuery) {
        self.emit('record', record, i, self.totalFetched++);
      }
    });
    if (!data.done && self.autoFetch && !self.stopQuery) {
      self._locator = data.nextRecordsUrl.split('/').pop();
      self.execute();
    } else {
      self.emit('end', self.totalFetched);
    }
  });
};

/**
 *
 */
var SObjectCollection = exports.SObjectCollection = function(type, conn) {
  this.type = type;
  this._conn = conn;
};

SObjectCollection.prototype.create = function(records, callback) {
  this._conn.create(this.type, records, callback);
};

SObjectCollection.prototype.retrieve = function(ids, callback) {
  this._conn.retrieve(this.type, ids, callback);
};

SObjectCollection.prototype.update = function(records, callback) {
  this._conn.update(this.type, records, callback);
};

SObjectCollection.prototype.del = SObjectCollection.prototype.destroy = function(ids, callback) {
  this._conn.del(this.type, ids, callback);
};
