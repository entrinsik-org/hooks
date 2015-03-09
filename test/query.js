'use strict';

var hooks = require('../lib');
var util = require('util');
var nextId = 100;

hooks.addEvents([
    { id: 'query.beforeExecute', description: 'before execute'},
    { id: 'query.afterExecute', description: 'after execute' }
]);

function Query() {
    hooks.HasHooks.call(this, 'query');
    this.id = nextId++;
}

util.inherits(Query, hooks.HasHooks);

Query.prototype.execute = hooks.hookify(function execute(params) {
    return {
        params: params,
        results: [1, 2, 3, 4, 5]
    };
});

exports.Query = Query;