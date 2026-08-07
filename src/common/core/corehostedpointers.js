/*globals define*/
/*eslint-env node, browser*/

/**
 * Thin Core layer that replaces DiffCore for the merge / external-diff engine.
 * Exposes getHostedPointers only — no generateTreeDiff / concat / apply.
 *
 * @author kecso / https://github.com/kecso
 */

define([
    'common/core/CoreAssert',
    'common/core/constants'
], function (ASSERT, CONSTANTS) {
    'use strict';

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
    }

    return CoreHostedPointers;
});
