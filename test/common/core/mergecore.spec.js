/*eslint-env node, mocha*/

/**
 * Phase 0: createMergeCore + getHostedPointers.
 * Uses the in-memory storage adapter only (no Mongo / GMEAuth).
 * @author kecso / https://github.com/kecso
 */

var testFixture = require('../../_globals.js'),
    Memory = require('../../../src/server/storage/memory');

describe('mergecore / getHostedPointers', function () {
    'use strict';

    var gmeConfig = testFixture.getGmeConfig(),
        expect = testFixture.expect,
        Q = testFixture.Q,
        logger = testFixture.logger.fork('mergecore.spec'),
        MergeCore = testFixture.requirejs('common/core/mergecore'),
        CONSTANTS = testFixture.requirejs('common/storage/constants'),
        projectId = 'guest+mergeCoreTesting',
        memory,
        project,
        mergeCore;

    beforeEach(function (done) {
        memory = new Memory(logger.fork('memory'), gmeConfig);
        memory.openDatabase()
            .then(function () {
                return memory.createProject(projectId);
            })
            .then(function (dbProject) {
                // CoreTree expects ProjectInterface-shaped storage; MemoryProject
                // is the raw adapter. CoreTree.persist calls
                // insertObject(data, stackedObjects) — not (data, callback).
                var rawInsert = dbProject.insertObject.bind(dbProject);
                dbProject.ID_NAME = CONSTANTS.MONGO_ID;
                dbProject.loadPaths = function (rootHash, paths, callback) {
                    callback(null, {});
                };
                dbProject.insertObject = function (obj, stackedOrCb) {
                    if (typeof stackedOrCb === 'function') {
                        return rawInsert(obj, stackedOrCb);
                    }
                    if (stackedOrCb && typeof stackedOrCb === 'object') {
                        return;
                    }
                    return rawInsert(obj);
                };
                project = dbProject;
                mergeCore = new MergeCore(project, {
                    globConf: gmeConfig,
                    logger: logger.fork('mergeCore')
                });
            })
            .nodeify(done);
    });

    afterEach(function (done) {
        Q()
            .then(function () {
                if (memory) {
                    return memory.deleteProject(projectId);
                }
            })
            .then(function () {
                if (memory) {
                    return memory.closeDatabase();
                }
            })
            .nodeify(done);
    });

    it('MergeCore should expose getHostedPointers and not DiffCore APIs', function () {
        expect(typeof mergeCore.getHostedPointers).to.equal('function');
        expect(mergeCore.generateTreeDiff).to.equal(undefined);
        expect(mergeCore.applyTreeDiff).to.equal(undefined);
        expect(mergeCore.tryToConcatChanges).to.equal(undefined);
        expect(mergeCore.applyResolution).to.equal(undefined);
    });

    it('createMergeCore factory should return MergeCore with getHostedPointers', function () {
        var core2 = MergeCore.createMergeCore(project, {
            globConf: gmeConfig,
            logger: logger.fork('factory')
        });
        expect(typeof core2.getHostedPointers).to.equal('function');
        expect(core2.generateTreeDiff).to.equal(undefined);
    });

    it('getHostedPointers should return absolute paths for overlay-hosted edges', function () {
        var root = mergeCore.createNode({}),
            mid = mergeCore.createNode({parent: root, relid: 'm'}),
            source = mergeCore.createNode({parent: mid, relid: 's'}),
            target = mergeCore.createNode({parent: mid, relid: 't'}),
            hosted,
            sourcePath,
            byName;

        mergeCore.setPointer(source, 'ref', target);

        // Common ancestor mid hosts the overlay entry for source → target.
        hosted = mergeCore.getHostedPointers(mid);
        expect(hosted).to.be.an('object');
        expect(hosted).to.not.be.instanceOf(Array);

        sourcePath = mergeCore.getPath(source);
        byName = hosted[sourcePath];
        expect(byName).to.be.an('object');
        expect(byName.ref).to.equal(mergeCore.getPath(target));
        expect(sourcePath.charAt(0)).to.equal('/');
        expect(byName.ref.charAt(0)).to.equal('/');
        // Must not be host-relative only (e.g. '/s' without '/m').
        expect(sourcePath).to.equal('/m/s');
        expect(byName.ref).to.equal('/m/t');
    });

    it('getHostedPointers should match getPointerPath for a hosted edge', function () {
        var root = mergeCore.createNode({}),
            mid = mergeCore.createNode({parent: root, relid: 'a'}),
            source = mergeCore.createNode({parent: mid, relid: 'b'}),
            target = mergeCore.createNode({parent: mid, relid: 'c'}),
            hosted,
            sourcePath;

        mergeCore.setPointer(source, 'follows', target);
        hosted = mergeCore.getHostedPointers(mid);
        sourcePath = mergeCore.getPath(source);

        expect(hosted[sourcePath]).to.be.an('object');
        expect(hosted[sourcePath].follows).to.equal(mergeCore.getPointerPath(source, 'follows'));
        expect(hosted[sourcePath].follows).to.equal(mergeCore.getPath(target));
    });

    it('getHostedPointers should return empty object when host has no overlay edges', function () {
        var root = mergeCore.createNode({}),
            leaf = mergeCore.createNode({parent: root, relid: 'y'});

        // Full Core records base:null on create; clear it so the host overlay is empty.
        mergeCore.deletePointer(leaf, 'base');
        expect(mergeCore.getHostedPointers(leaf)).to.deep.equal({});
    });

    it('getHostedPointers should group multiple names under the same source path', function () {
        var root = mergeCore.createNode({}),
            mid = mergeCore.createNode({parent: root, relid: 'm'}),
            source = mergeCore.createNode({parent: mid, relid: 's'}),
            t1 = mergeCore.createNode({parent: mid, relid: 't1'}),
            t2 = mergeCore.createNode({parent: mid, relid: 't2'}),
            hosted,
            sourcePath;

        mergeCore.setPointer(source, 'a', t1);
        mergeCore.setPointer(source, 'b', t2);
        hosted = mergeCore.getHostedPointers(mid);
        sourcePath = mergeCore.getPath(source);

        expect(hosted[sourcePath]).to.be.an('object');
        expect(hosted[sourcePath].a).to.equal(mergeCore.getPath(t1));
        expect(hosted[sourcePath].b).to.equal(mergeCore.getPath(t2));
    });

    it('getHostedPointers should use null for deliberate nullptr, not for undefined', function () {
        var root = mergeCore.createNode({}),
            source = mergeCore.createNode({parent: root, relid: 's'}),
            hosted,
            sourcePath;

        mergeCore.setPointer(source, 'ref', null);
        sourcePath = mergeCore.getPath(source);

        // Nullptr overlay lives on the source itself (NullPointerCore child).
        hosted = mergeCore.getHostedPointers(source);
        expect(hosted[sourcePath]).to.be.an('object');
        expect(Object.prototype.hasOwnProperty.call(hosted[sourcePath], 'ref')).to.equal(true);
        expect(hosted[sourcePath].ref).to.equal(null);
        expect(mergeCore.getPointerPath(source, 'ref')).to.equal(null);

        // Parent host must not list the nullptr (edge is on source's overlay only).
        expect(mergeCore.getHostedPointers(root)[sourcePath]).to.equal(undefined);

        // After delete, key is absent (undefined / not defined) — not null.
        mergeCore.deletePointer(source, 'ref');
        hosted = mergeCore.getHostedPointers(source);
        if (hosted[sourcePath]) {
            expect(Object.prototype.hasOwnProperty.call(hosted[sourcePath], 'ref')).to.equal(false);
        }
        expect(mergeCore.getPointerPath(source, 'ref')).to.equal(undefined);
    });

    it('attachChild should graft a persisted hash onto the parent', function () {
        var root = mergeCore.createNode({}),
            donorParent = mergeCore.createNode({parent: root, relid: 'd'}),
            child = mergeCore.createNode({parent: donorParent, relid: 'x'}),
            sink = mergeCore.createNode({parent: root, relid: 's'}),
            persisted,
            hash;

        mergeCore.setAttribute(child, 'name', 'grafted');
        persisted = mergeCore.persist(root);
        hash = mergeCore.getHash(child);
        expect(hash).to.be.a('string');
        expect(hash.length).to.be.above(0);
        expect(persisted.objects).to.be.an('object');

        expect(typeof mergeCore.attachChild).to.equal('function');
        expect(mergeCore.overlayInsert).to.equal(undefined);
        mergeCore.attachChild(sink, 'y', hash);
        expect(mergeCore.getChildrenRelids(sink)).to.include('y');
        expect(mergeCore.getChildrenHashes(sink).y).to.equal(hash);
    });

    it('attachChild should overlay-insert absolute pointers before grafting', function (done) {
        var root = mergeCore.createNode({}),
            fco = mergeCore.createNode({parent: root, relid: '1'}),
            child = mergeCore.createNode({parent: root, base: fco, relid: 'c'}),
            sink,
            persisted,
            hash,
            Q = testFixture.Q,
            chain = Q(),
            keys,
            i;

        mergeCore.setAttribute(fco, 'name', 'FCO');
        mergeCore.setAttribute(child, 'name', 'grafted');
        persisted = mergeCore.persist(root);
        hash = mergeCore.getHash(child);
        keys = Object.keys(persisted.objects || {});
        for (i = 0; i < keys.length; i += 1) {
            (function (entry) {
                var data = entry && entry.newData ? entry.newData : entry;
                chain = chain.then(function () {
                    return Q(project.insertObject(data));
                });
            }(persisted.objects[keys[i]]));
        }

        chain
            .then(function () {
                sink = mergeCore.createNode({parent: root, relid: 's'});
                mergeCore.attachChild(sink, 'y', hash, [
                    {name: 'base', from: '/s/y', to: '/1'}
                ]);
                return Q.ninvoke(mergeCore, 'loadChild', sink, 'y');
            })
            .then(function (grafted) {
                expect(grafted).to.not.equal(null);
                expect(mergeCore.getPointerPath(grafted, 'base')).to.equal('/1');
                expect(mergeCore.getPath(mergeCore.getBase(grafted))).to.equal('/1');
            })
            .nodeify(done);
    });

    it('moveChild should move under a new parent at an explicit relid', function () {
        var root = mergeCore.createNode({}),
            fco = mergeCore.createNode({parent: root, relid: '1'}),
            a = mergeCore.createNode({parent: root, base: fco, relid: 'a'}),
            b = mergeCore.createNode({parent: root, base: fco, relid: 'b'}),
            n = mergeCore.createNode({parent: a, base: fco, relid: 'n'}),
            moved;

        expect(typeof mergeCore.moveChild).to.equal('function');
        moved = mergeCore.moveChild(n, b, 'z');
        expect(mergeCore.getPath(moved)).to.equal('/b/z');
        expect(mergeCore.getRelid(moved)).to.equal('z');
    });
});
