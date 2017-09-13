'use strict';

var chai = require('chai');
var sinon = require('sinon');
chai.use(require('sinon-chai'));
var should = require('chai').should();
var util = require('util');
var hooks = require('../lib');

function Query() {
    hooks.HasHooks.call(this, 'query');
}

util.inherits(Query, hooks.HasHooks);

Query.prototype.execute = hooks.hookify(function execute (params) {
    if (!arguments.length) throw new Error('No params to execute!');
    return {
        params: params,
        results: [1, 2, 3, 4, 5]
    };
});


var events = [ 'datasource.beforeScan', 'datasource.afterScan' ];

describe('hooks', function () {
    beforeEach(function () {
        hooks.hookTypes = {};
        hooks.removeAllListeners();
    });

    afterEach(function () {
        hooks.hookTypes = {};
    });

    describe('hooks.create()', function () {
        it('should create a new hook object', function () {
            var hook = hooks.create();
            should.exist(hook);
            hook.should.be.a('function');
        });

        it('should support adding listeners', function () {
            var hook = hooks.create();
            hook.should.have.property('add');
            hook.add.should.be.a('function');
            var registration = hook.add(console.log);
            should.exist(registration);
            registration.should.respondTo('remove');
        });

        it('should throw an exception if the listener is not a function', function () {
            var hook = hooks.create();
            hook.add.bind(hook).should.throw('Listener must be a function');
        });

        it('should return a promise when invoked', function () {
            var hook = hooks.create();
            var p = hook();
            should.exist(p);
            p.should.respondTo('then');
        });

        it('should invoke a promise-based listener', function () {
            var listener = sinon.spy();
            var hook = hooks.create();
            hook.add(listener);
            return hook()
                .then(function () {
                    listener.should.have.been.calledOnce;
                });
        });

        it('should invoke a listener with the same arguments', function () {
            var listener = sinon.spy();
            var hook = hooks.create();
            hook.add(listener);
            return hook(1, 2, 'yellow', 'blue')
                .then(function () {
                    listener.should.have.been.calledOnce;
                    listener.should.have.been.calledWith(1, 2, 'yellow', 'blue');
                });
        });

        it('should pass a callback function if the arity of the callback is greater than call', function () {
            var listener = function(arg1, arg2, done) {
                done(null, 'yay');
            };

            var hook = hooks.create();
            hook.add(listener, { foo: 'bar' });
            return hook(1, 2)
                .then(function (results) {
                    results.should.have.length(1);
                    results[0].should.equal('yay');
                });
        });

        it('should fail the promise if the callback function returns an error', function () {
            var listener = function(arg1, arg2, done) {
                done(new Error('Error!'));
            };

            var hook = hooks.create();
            hook.add(listener, { foo: 'bar' });
            return hook(1, 2)
                .then(function () {
                    throw new Error('should not have succeeded');
                })
                .catch(function (err) {
                    err.message.should.equal('Error!');
                });
        });

        it('should allow a listener to be deregistered', function () {
            var listener = sinon.spy();

            var hook = hooks.create();
            var registration = hook.add(listener);
            return hook()
                .then(function () {
                    registration.remove();
                    return hook();
                })
                .then(function () {
                    listener.should.have.been.calledOnce;
                });
        });

        it('should not fail if the same handler is removed twice', function () {
            var hook = hooks.create();
            var listener = sinon.spy();
            hook.listenerCount().should.equal(0);
            hook.add(listener);
            hook.listenerCount().should.equal(1);
            hook.remove(listener);
            hook.listenerCount().should.equal(0);
            hook.remove(listener);
            hook.listenerCount().should.equal(0);
        });
    });

    it('should support registering events', function () {
        hooks.addEvents(events);
    });

    it('should support a global listener', function () {
        hooks.addEvents(events);
        var spy = sinon.spy();
        var datasource = { name: 'World Demo' };
        hooks.on('datasource.beforeScan', spy);
        return hooks.runHook('datasource.beforeScan', datasource)
            .then(function (result) {
                spy.should.have.been.calledOnce;
                spy.should.have.been.calledWith(datasource);
            });
    });

    it('should support an instance with its own listeners', function () {
        var globalSpy = sinon.spy();
        var listener1 = sinon.spy();
        var listener2 = sinon.spy();

        var instance1 = hooks.newInstance('datasource');
        var instance2 = hooks.newInstance('datasource');

        hooks.addEvents(events);
        hooks.on('datasource.beforeScan', globalSpy);
        instance1.on('beforeScan', listener1);
        instance2.on('beforeScan', listener2);

        return instance1.runHook('beforeScan')
            .then(function () {
                return instance2.runHook('beforeScan');
            })
            .then(function () {
                globalSpy.should.have.been.calledTwice;
                listener1.should.have.been.calledOnce;
                listener2.should.have.been.calledOnce;
            });
    });

    it('should support array events', function () {
        hooks.addEvents.bind(hooks, ['whatever']).should.not.throw();
    });

    it('should register non-array events', function () {
        hooks.addEvents('whatever');
    });

    describe('instance listeners', function () {
        var datasource, instance;

        beforeEach(function () {
            hooks.addEvents(events);
            datasource = { name: 'World Demo' };
            instance = hooks.newInstance('datasource').curry(datasource);
        });

        it('should support currying arguments', function () {
            var spy = sinon.spy();
            instance.on('beforeScan', spy);
            return instance.runHook('beforeScan', 'foo', 'bar')
                .then(function () {
                    spy.should.have.been.calledWith(datasource, 'foo', 'bar');
                });
        });

        it('should support multiple listeners', function () {
            var l1 = sinon.spy();
            var l2 = sinon.spy();
            [l1, l2].forEach(instance.on.bind(instance, 'beforeScan'));
            return instance.runHook('beforeScan')
                .then(function () {
                    l1.should.have.been.calledOnce;
                    l2.should.have.been.calledOnce;
                });
        });

        it('should throw an error if a registration is attempted against a bad event', function () {
            instance.on.bind(instance, 'badEvent').should.throw('Unknown event: datasource.badEvent');
        });
    });

    describe('HasHooks', function () {
        var query;

        beforeEach(function () {
            hooks.addEvents([ 'query.beforeExecute', 'query.afterExecute' ]);
        });

        beforeEach(function () {
            query = new Query();
        });

        it('should respond to on', function () {
            query.should.respondTo('on');
        });

        it('should respond to runHook', function () {
            query.should.respondTo('runHook');
        });

        it('should emit a global event', function () {
            var spy = sinon.spy();
            hooks.on('query.afterExecute', spy);
            return query.execute('foo', 'bar')
                .then(function (result) {
                    spy.should.have.been.calledOnce;
                    spy.should.have.been.calledWith(query, 'foo', 'bar', result);
                });
        });

        it('should emit a global error event', function () {
            hooks.addEvents('query.executeError');
            var spy = sinon.spy();
            var spy1 = sinon.spy();
            var spy2 = sinon.spy();
            hooks.on('query.executeError', spy);
            hooks.on('query.beforeExecute', spy1);
            hooks.on('query.afterExecute', spy2);
            return query.execute()
                .then(function (result) {
                    should.not.exist('query.execute.then body getting hit');
                })
                .catch(function (err) {
                    spy.should.have.been.calledOnce;
                    spy.should.have.been.calledWith(query, err);
                    spy1.should.have.been.calledOnce;
                    spy1.should.have.been.calledWith(query);
                    spy2.should.not.have.been.called;
                });
        });

        it('should emit an instance event', function () {
            var spy1 = sinon.spy(), spy2 = sinon.spy();

            var q1 = new Query();
            var q2 = new Query();
            q1.on('beforeExecute', spy1);
            q2.on('beforeExecute', spy2);

            return q1.execute('foo')
                .then(function () {
                    return q2.execute('bar');
                })
                .then(function () {
                    spy1.should.have.been.calledOnce;
                    spy2.should.have.been.calledOnce;
                    spy1.should.have.been.calledWith(q1, 'foo');
                    spy2.should.have.been.calledWith(q2, 'bar');
                });
        });

        it('should emit an instance error event', function () {
            hooks.addEvents('query.executeError');
            var spy1 = sinon.spy(),
                spy2 = sinon.spy(),
                spy3 = sinon.spy(),
                spy4 = sinon.spy(),
                spy5 = sinon.spy(),
                spy6 = sinon.spy(),
                q1Err, q2Err;

            var q1 = new Query();
            var q2 = new Query();
            q1.on('beforeExecute', spy1);
            q1.on('executeError', spy3);
            q1.on('afterExecute', spy5);
            q2.on('beforeExecute', spy2);
            q2.on('executeError', spy4);
            q2.on('afterExecute', spy6);

            return q1.execute()
                .then(function () {
                    should.not.exist('q1.execute.then body getting hit');
                })
                .catch(function (err) {
                    q1Err = err;
                })
                .finally(function () {
                    spy1.should.have.been.calledOnce;
                    spy1.should.have.been.calledWith(q1);
                    should.exist(q1Err);
                    q1Err.should.be.an.instanceof(Error);
                    q1Err.should.have.property('message', 'No params to execute!');
                    spy3.should.have.been.calledOnce;
                    spy3.should.have.been.calledWith(q1, q1Err);
                    spy5.should.not.have.been.called;

                    return q2.execute()
                        .then(function () {
                            should.not.exist('q2.execute.then body getting hit');
                        })
                        .catch(function (err) {
                            q2Err = err;
                            spy2.should.have.been.calledOnce;
                            spy2.should.have.been.calledWith(q2);
                            should.exist(q2Err);
                            q2Err.should.be.an.instanceof(Error);
                            spy4.should.have.been.calledOnce;
                            spy4.should.have.been.calledWith(q2, q2Err);
                            q2Err.should.have.property('message', 'No params to execute!');
                            spy6.should.not.have.been.called;
                        });
                });
        });

        it('should ignore \'Unknown event\' error & gracefully continue normally (ie. re-throw original error) when a hookified function throws and no error hook event was added', function () {
            var spy1 = sinon.spy(), spy2 = sinon.spy();

            var q1 = new Query();
            q1.on('beforeExecute', spy1);
            q1.on('afterExecute', spy2);

            return q1.execute()
                .then(function () {
                    throw new Error('Should not succeed!');
                })
                .catch(function (err) {
                    spy1.should.have.been.calledOnce;
                    spy1.should.have.been.calledWith(q1);
                    spy2.should.not.have.been.called;
                    err.should.not.have.property('message', 'Unknown event: query.executeError');
                    err.should.have.property('message', 'No params to execute!');
                });
        });
    });

    describe('register()', function () {
        it('should expose hooks to the hapi server', function () {
            var next = sinon.spy();
            var server = {
                app: {},
                expose: sinon.spy(),
                on: sinon.spy()
            };

            hooks.register(server, {}, next);
            server.app.should.respondTo('ext');
            server.expose.should.have.been.calledThrice;
            server.on.should.have.been.calledWith('start');
            next.should.have.been.called;
        });
    });
});