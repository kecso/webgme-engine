/*globals define*/
/*eslint-env node, browser*/

/**
 * Thin Core layer that replaces DiffCore for the merge / external-diff engine.
 * Exposes getHostedPointers + attachChild — no generateTreeDiff / concat / apply.
 *
 * @author kecso / https://github.com/kecso
 */

define([
    'common/core/CoreAssert',
    'common/core/constants'
], function (ASSERT, CONSTANTS) {
    'use strict';

    /**
     * Longest common absolute path prefix ('' for root). Same idea as DiffCore.
     * @param {string} onePath
     * @param {string} otherPath
     * @returns {string}
     */
    function getAncestorPath(onePath, otherPath) {
        var ancestorPath = '',
            onePathArray = (onePath || '').split('/'),
            otherPathArray = (otherPath || '').split('/'),
            i = 0;

        onePathArray.shift();
        otherPathArray.shift();
        if (onePathArray.length > 0 && otherPathArray.length > 0) {
            while (i < onePathArray.length && onePathArray[i] === otherPathArray[i]) {
                ancestorPath += '/' + onePathArray[i];
                i += 1;
            }
        }
        return ancestorPath;
    }

    /**
     * @param {object} innerCore
     * @param {object} options
     * @constructor
     */
    function CoreHostedPointers(innerCore, options) {
        ASSERT(typeof options === 'object');
        ASSERT(typeof options.globConf === 'object');
        ASSERT(typeof options.logger !== 'undefined');

        var logger = options.logger,
            self = this,
            key;

        for (key in innerCore) {
            this[key] = innerCore[key];
        }

        logger.debug('initialized CoreHostedPointers');

        /**
         * Pointer edges hosted in this node's overlay table (may refer to deep
         * descendants), grouped by absolute source path — same shape as raw
         * overlay (`source → name → target`), but with absolute paths.
         *
         * Synchronous — call only on an already loaded node (overlays attached
         * via loadRoot / loadChild / loadByPath).
         *
         * Relative overlay keys are joined with getPath(node) via joinPaths.
         *
         * Null vs missing (same as Core / NullPointerCore):
         * - Value `null` = deliberate nullptr (pointer is set, no target). Stored
         *   as overlay target `/_nullptr` under the **source** node (NullPointerCore
         *   creates a `_nullptr` child of the source, so the overlay host is the
         *   source itself — parent hosts will not list that edge; the source's
         *   hash changes).
         * - Key absent = pointer not defined on this overlay (inherited / default
         *   may still apply elsewhere). Never emit a key for undefined.
         *
         * @param {object} node - loaded core node (overlay host)
         * @returns {Object.<string, Object.<string, string|null>>}
         *   `{ [sourcePath]: { [name]: targetPath|null } }`. Empty host → `{}`.
         */
        this.getHostedPointers = function (node) {
            var hostPath,
                raw,
                result,
                sourceRel,
                names,
                name,
                targetRel,
                sourcePath,
                targetPath,
                byName;

            ASSERT(self.isValidNode(node));

            hostPath = self.getPath(node);
            raw = self.getRawOverlayInformation(node);
            result = {};

            for (sourceRel in raw) {
                if (Object.prototype.hasOwnProperty.call(raw, sourceRel) === false) {
                    continue;
                }
                names = raw[sourceRel];
                if (!names || typeof names !== 'object') {
                    continue;
                }

                // Overlay keys are paths relative to the host ('' or '/…').
                sourcePath = self.joinPaths(hostPath, sourceRel);
                byName = result[sourcePath];
                if (!byName) {
                    byName = {};
                    result[sourcePath] = byName;
                }

                for (name in names) {
                    if (Object.prototype.hasOwnProperty.call(names, name) === false) {
                        continue;
                    }
                    targetRel = names[name];

                    // Deliberate nullptr: getRawOverlayInformation maps '/_nullptr' → null.
                    // Do not treat undefined as null (undefined = not an overlay value).
                    if (targetRel === null) {
                        targetPath = null;
                    } else if (typeof targetRel === 'string') {
                        // Belt-and-suspenders: same rule as NullPointerCore.getPointerPath.
                        if (targetRel.indexOf(CONSTANTS.NULLPTR_RELID) !== -1) {
                            targetPath = null;
                        } else {
                            targetPath = self.joinPaths(hostPath, targetRel);
                        }
                    } else {
                        continue;
                    }

                    byName[name] = targetPath;
                }
            }

            return result;
        };

        /**
         * Walk parent → … → root to the node whose path equals hostPath.
         * Overlay hosts for a graft sit on this chain (never below the parent).
         * @param {object} parent
         * @param {string} hostPath
         * @returns {object}
         */
        function hostNodeOnParentChain(parent, hostPath) {
            var node = parent,
                path;

            while (node) {
                path = self.getPath(node);
                if (path === hostPath) {
                    return node;
                }
                node = self.getParent(node);
            }

            throw new Error('attachChild: overlay host [' + hostPath +
                '] is not on the parent containment chain');
        }

        /**
         * Insert one absolute pointer into the correct ancestor overlay.
         * Nullptr edges are not accepted — they live on the source node and
         * arrive via contentHash.
         * @param {object} parent - attach parent (entry to the container chain)
         * @param {{name: string, from: string, to: string}} pointer
         */
        function insertPointerOnChain(parent, pointer) {
            var fromPath,
                toPath,
                hostPath,
                host,
                sourceRel,
                targetRel;

            ASSERT(pointer && typeof pointer.name === 'string');
            ASSERT(typeof pointer.from === 'string');
            ASSERT(typeof pointer.to === 'string');

            fromPath = pointer.from;
            toPath = pointer.to;
            hostPath = getAncestorPath(fromPath, toPath);
            host = hostNodeOnParentChain(parent, hostPath);
            sourceRel = fromPath.substring(hostPath.length);
            targetRel = toPath.substring(hostPath.length);

            self.overlayInsert(host, sourceRel, pointer.name, targetRel);
        }

        /**
         * Attach an already-persisted content object as child `relid` under
         * parent (DiffCore-style hash graft). Does not createNode.
         *
         * Overlay edges that live on the parent…root chain for the new subtree
         * (not inside the content blob) must be supplied as absolute pointers and
         * are inserted **before** the hash graft so loadChild sees a valid base.
         * Nullptr overlays stay inside contentHash (hosted on the source node).
         *
         * @param {object} parent - loaded parent node
         * @param {string} relid - child relid
         * @param {string} contentHash - storage hash of the child object
         * @param {Array<{name: string, from: string, to: string}>} [pointers]
         *   Absolute path edges to place on the container chain (e.g. base → FCO).
         */
        this.attachChild = function (parent, relid, contentHash, pointers) {
            var i;

            ASSERT(self.isValidNode(parent));
            ASSERT(typeof relid === 'string' && relid.length > 0);
            ASSERT(typeof contentHash === 'string' && contentHash.length > 0);
            ASSERT(pointers === undefined || pointers === null || Array.isArray(pointers));

            if (pointers && pointers.length) {
                for (i = 0; i < pointers.length; i += 1) {
                    insertPointerOnChain(parent, pointers[i]);
                }
            }

            self.setProperty(parent, relid, contentHash);
            // Invalidate both CoreRel and CoreType children caches so loadChild
            // sees the grafted relid (CoreType.loadChild gates on allChildrenRelids).
            parent.childrenRelids = null;
            parent.allChildrenRelids = null;
        };
    }

    return CoreHostedPointers;
});
