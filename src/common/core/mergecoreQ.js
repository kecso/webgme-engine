/*globals define*/
/*eslint-env node, browser*/

/**
 * Q-promise wrapper around MergeCore (mirrors coreQ over Core).
 *
 * @author kecso / https://github.com/kecso
 */

define(['common/core/mergecore', 'q'], function (MergeCore, Q) {
    'use strict';

    function MergeCoreQ(storage, options) {
        var self = this;
        MergeCore.call(self, storage, options);

        function promisify(orgFn) {
            return function () {
                var args = Array.prototype.slice.call(arguments),
                    callback = typeof args[args.length - 1] === 'function' ? args.pop() : null,
                    deferred = Q.defer();

                args.push(function (err, res) {
                    if (err) {
                        deferred.reject(err instanceof Error ? err : new Error(err));
                    } else {
                        deferred.resolve(res);
                    }
                });
                orgFn.apply(self, args);
                return deferred.promise.nodeify(callback);
            };
        }

        // Common async loads used by the merge engine / tests.
        this.loadRoot = promisify(this.loadRoot);
        this.loadChild = promisify(this.loadChild);
        this.loadByPath = promisify(this.loadByPath);
        this.loadChildren = promisify(this.loadChildren);
        this.loadOwnChildren = promisify(this.loadOwnChildren);
        this.loadPointer = promisify(this.loadPointer);
        this.loadPaths = promisify(this.loadPaths);
    }

    function createMergeCore(project, options) {
        return new MergeCoreQ(project, options);
    }

    MergeCoreQ.createMergeCore = createMergeCore;

    return MergeCoreQ;
});
