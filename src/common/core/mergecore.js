/*globals define*/
/*eslint-env node, browser*/

/**
 * Merge-oriented Core factory: same onion as Core, but DiffCore is replaced by
 * CoreHostedPointers (getHostedPointers only). Used by the external ops-first
 * merge engine — not a drop-in for generateTreeDiff / tryToConcatChanges.
 *
 * @author kecso / https://github.com/kecso
 */

define(['common/core/core'], function (Core) {
    'use strict';

    /**
     * @param {object} project
     * @param {object} options - globConf, logger (same as Core)
     * @constructor
     */
    function MergeCore(project, options) {
        var opts = Object.assign({}, options || {}, {mergeHostedPointers: true});
        Core.call(this, project, opts);
    }

    /**
     * Preferred factory entry (name may stay createMergeCore in docs).
     * @param {object} project
     * @param {object} [options]
     * @returns {MergeCore}
     */
    function createMergeCore(project, options) {
        return new MergeCore(project, options);
    }

    MergeCore.createMergeCore = createMergeCore;

    return MergeCore;
});
