'use strict';

var _ = require('lodash');
var util = require('util');
var P = require('bluebird');
var eu = require('ent-utils');
var internals = {};

internals.prefix = function(prefix, string) {
    return prefix + string.substring(0, 1).toUpperCase() + string.substring(1);
};

/**
 * Composes a new hook function that maintains its own list of listeners. The function, when invoked,
 * return a promise that resolves to an array of all handler resolutions. Handlers may be promise-based
 * or may accept an extra callback argument.
 * @return {Function}
 */
var createHook = function createHook() {
    var listeners = [];

    // a wrapper around Promise.all()
    var hook = function() {
        var args = arguments;
        var self = this;
        return P.all(listeners.map(function(listener) {
            listener = listener.length <= args.length ? listener : P.promisify(listener);
            return listener.apply(self, args);
        }));
    };

    /**
     * Adds a new promise-based or async listener function
     * @param listener
     * @return {{remove: Function}} registration a registration object with a remove function to remove the handler
     */
    hook.add = function add(listener) {
        if (!listener) throw new Error('Listener must be a function');

        listeners.push(listener);

        return {
            remove: hook.remove.bind(hook, listener)
        };
    };

    /**
     * Removes a listener
     * @param listener
     * @return {createHook} for chaining
     */
    hook.remove = function remove(listener) {
        var index = listeners.indexOf(listener);
        if (index >= 0) {
            listeners.splice(index, 1);
        }
        return this;
    };

    /**
     * Removes all listeners
     */
    hook.removeAll = function removeAll() {
        listeners = [];
    };

    /**
     * Returns the number of listeners registered for the hook
     * @return {Array.length|*}
     */
    hook.listenerCount = function listenerCount() {
        return listeners.length;
    };

    return hook;
};

/**
 * Global registry of hook types
 * @type {{}}
 */
var hookTypes = exports.hookTypes = {};

/**
 * Binds hook registrations to named hook events. Hooks are invoked on any handlers registered
 * locally as well as on any global listeners
 * @param {Hooks=} parent the parent hooks registry (always the global registry)
 * @param {string=} prefix a prefix for resolving shorthand event names
 * @constructor
 */
function Hooks(parent, prefix) {
    this.parent = parent;
    this.prefix = prefix;
    this.hooks = {};
    this.args = [];
}

/**
 * Expands a shorthand event into its fully qualified name
 * @param {String} event a shorthand event name (e.g. "beforeScan")
 * @return {*}
 */
Hooks.prototype.resolveEvent = function(event) {
    return this.prefix ? util.format('%s.%s', this.prefix, event) : event;
};

/**
 * Returns the hook function bound to a given event name
 * @param {String} event resolved event name (e.g. "datasource.beforeScan")
 * @return {Function}
 */
Hooks.prototype.getHook = function(event) {
    if (!hookTypes.hasOwnProperty(event)) throw new Error('Unknown event: ' + event);
    this.hooks[event] = this.hooks[event] || createHook();
    return this.hooks[event];
};

/**
 * Registers a listener with a hook event
 * @param {String} event a shorthand event name
 * @param {Function} listener the listener function
 * @return {{ remove: Function }} a registration object
 */
Hooks.prototype.on = function on(event, listener) {
    return this.getHook(this.resolveEvent(event)).add(listener);
};

/**
 * Runs a hook function bound to an event name
 * @param {string} event a shorthand event name
 * @param {...*} args
 * @return {*}
 */
Hooks.prototype.runHook = function runHook(event, args) {
    var self = this;

    args = this.args.concat([].slice.call(arguments, 1));
    event = this.resolveEvent(event);

    var result = this.getHook(event).apply(null, args);

    // check for parent (ie root) hooks and chain its handlers
    if (this.parent) {
        return result.then(function () {
            return self.parent.runHook.apply(self.parent, [event].concat(args));
        });
    } else {
        return result;
    }
};

/**
 * Partially applies one or more arguments to all hook invocations
 * @return {Hooks}
 */
Hooks.prototype.curry = function(/** arguments **/) {
    this.args = this.args.concat([].slice.call(arguments));
    return this;
};

/**
 * Removes all registered listeners
 * @return {Hooks}
 */
Hooks.prototype.removeAllListeners = function() {
    _.values(this.hooks).forEach(function (hook) {
        hook.removeAll();
    });
    return this;
};

/**
 * Composes a hook("beforeXYZ"), xyz(), hook("afterXYZ") sandwich
 * @param {Function} method the method to wrap
 * @param {String=} name the event name. The function's name will be used by default
 * @return {Function}
 */
exports.hookify = function hookify(method, name) {
    // e.g. function foo()
    name = name || method.name;
    var before = internals.prefix('before', name);
    var after = internals.prefix('after', name);

    return function() {
        var self = this;
        var args = [].slice.call(arguments);
        //noinspection JSPotentiallyInvalidUsageOfThis
        return this.runHook.apply(this, [before].concat(args))
            .then(function () {
                return method.apply(self, args);
            })
            .tap(function (result) {
                // errors at this point wont affect the result
                return self.runHook.apply(self, [after].concat(args).concat(result));
            });
    };
};

/**
 * Root hook registrations
 * @type {Hooks}
 */
var globals = new Hooks();

/**
 * A base class for objects that emit hook events.
 * @example
 * <pre>
 *     function Query() {
 *          HasHooks.call(this, 'query');
 *     }
 *
 *     util.inherits(Query, HasHooks);
 *
 *     Query.prototype.execute = hooks.hookify(function execute(...) {});
 *
 *     var q = new Query();
 *     q.on('beforeExecute', function(args) {
 *          ...
 *     });
 * </pre>
 * @param prefix
 * @constructor
 */
function HasHooks(prefix) {
    this.hooks = exports.newInstance(prefix).curry(this);
}

/**
 * Invokes the hook handlers
 * @return {Promise<[]>}
 */
HasHooks.prototype.runHook = function() {
    return this.hooks.runHook.apply(this.hooks, arguments);
};

/**
 * Registers a new hook handler
 * @return {*}
 */
HasHooks.prototype.on = function() {
    return this.hooks.on.apply(this.hooks, arguments);
};

/**
 * Registers event descriptors. Event descriptors must be registered prior to being emitted or listened for.
 * Event descriptors should have enough documentation to aid hook consumers
 * @param {...string | string[]} events
 */
exports.addEvents = function (events) {
    events = _.isArray(events) ? events : [].slice.call(events);
    events.forEach(function (event) {
        hookTypes[event] = true;
    });
};

exports.HasHooks = HasHooks;

// global delegates
exports.create = createHook;
exports.on = globals.on.bind(globals);
exports.removeAllListeners = globals.removeAllListeners.bind(globals);
exports.runHook = globals.runHook.bind(globals);

/**
 * Creates a child hooks registry that maintains its own list of listeners but also notifies its parent when hooks
 * are fired
 * global listeners
 * @param prefix
 * @return {Hooks}
 */
exports.newInstance = function(prefix) {
    return new Hooks(globals, prefix);
};

exports.setClsNamespace = function(namespace) {
    if (process.namespaces && process.namespaces[namespace]) {
        require('cls-bluebird')(process.namespaces[namespace]);
    }
};

exports.register = function(server, opts, next) {
    // corks all event registrations until all event types have been registered
    exports.on = eu.cork(exports.on);
    server.app.ext = exports.on;
    server.expose('addEvents', exports.addEvents);
    server.expose('newInstance', exports.newInstance);
    server.expose('on', exports.on);

    // requires in-app patching for cls but really shouldnt be a peer dependency
    if (opts.namespace) {
        exports.setClsNamespace(opts.namespace);
    }

    server.on('start', exports.on.uncork);
    next();
};


exports.register.attributes = { pkg: require('../package.json') };