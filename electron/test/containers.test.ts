// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the pure local-container modules (node:test, no Electron).
 * Engine output samples are trimmed from captures of Docker 29.9.3 / 28.5.1
 * and Podman 5.6.2 (spikes S6, S10, S11).
 *
 *   npm run test:electron
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { containerName, parseImageRef, pathsOverlap, readHostPath, readRunOptions } from '../containers/validate';
import { FORBIDDEN_RUN_FLAGS, layerDigestsScript, machineSshArgs, NET_COUNTER_SCRIPT, runArgs, type RunSpec } from '../containers/argv';
import { DownloadTracker } from '../containers/download';
import { parseBearerChallenge, readManifestAnonymously, type AnonymousFetch } from '../containers/registry';
import { classifyEarlyExit, classifyPullError, classifyRunError, isPortInUse, redact } from '../containers/classify';
import { checkHostFolder, type FolderFs, type HostFolderContext } from '../containers/mounts';
import { ContainerStore } from '../containers/store';
import {
  defaultRouteInterface,
  envValues,
  isLocalEngineUri,
  parseCapacity,
  parseLayerDigests,
  parseManifest,
  parseNetDevRx,
  parseStoreInfo,
  pickPlatformManifest,
  parseContainerInspect,
  parseSize,
  parseStats,
  modelNameFromLog,
  parseImageInspect,
  parsePs,
  parseVersion,
  updatePullProgress,
} from '../containers/parse';

const HARBOR = 'registry.example.com';
const REF = { host: HARBOR, repo: 'library/gb_test_risk', tag: 'latest', digest: null };

// --- image references ---

test('image reference: host, repository and tag', () => {
  const ref = parseImageRef(`${HARBOR}/library/gb_test_risk:latest`);
  assert.equal(ref.host, HARBOR);
  assert.equal(ref.repo, 'library/gb_test_risk');
  assert.equal(ref.tag, 'latest');
  assert.equal(ref.normalized, `${HARBOR}/library/gb_test_risk:latest`);
});

test('image reference: latest is added, digests and registry ports are kept', () => {
  assert.equal(parseImageRef(`${HARBOR}/library/just-hmeq1_0`).normalized, `${HARBOR}/library/just-hmeq1_0:latest`);
  const digest = `sha256:${'a'.repeat(64)}`;
  const byDigest = parseImageRef(`${HARBOR}/library/x@${digest}`);
  assert.equal(byDigest.tag, null);
  assert.equal(byDigest.digest, digest);
  assert.equal(parseImageRef('registry:5000/team/model:1.2').host, 'registry:5000');
  assert.equal(parseImageRef('localhost/mas-scorer-spike/hello:arm64').host, 'localhost');
});

test('image reference: Docker Hub is never assumed and unsafe input is refused', () => {
  for (const bad of [
    'library/model:latest',
    'model',
    `-${HARBOR}/library/x`,
    `${HARBOR}/library/x --privileged`,
    `https://${HARBOR}/library/x`,
    `${HARBOR}/Library/X`,
    `${HARBOR}/library/x‮`,
    `${HARBOR}/library/x:`,
    `${HARBOR}/library/x@sha256:short`,
    '',
  ]) {
    assert.throws(() => parseImageRef(bad), Error, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('run options: closed schema and limits', () => {
  assert.deepEqual(readRunOptions({ cpus: 2, memoryMb: 2048, mode: 'SAS' }), {
    cpus: 2,
    memoryMb: 2048,
    mode: 'SAS',
    displayName: undefined,
    env: [],
    mounts: [],
  });
  assert.equal(readRunOptions({ cpus: 0.5, memoryMb: 512, mode: 'BATCH', displayName: '  Risk  ' }).displayName, 'Risk');
  assert.throws(() => readRunOptions({ cpus: 2, memoryMb: 2048, mode: 'SAS', privileged: true }));
  assert.throws(() => readRunOptions({ cpus: 0, memoryMb: 2048, mode: 'SAS' }));
  assert.throws(() => readRunOptions({ cpus: 2, memoryMb: 100, mode: 'SAS' }));
  assert.throws(() => readRunOptions({ cpus: 2, memoryMb: 2048.5, mode: 'SAS' }));
  assert.throws(() => readRunOptions({ cpus: 2, memoryMb: 2048, mode: 'SAGEMAKER' }));
  assert.throws(() => readRunOptions({ cpus: 2, memoryMb: 2048, mode: 'SAS', displayName: 'a\u0007b' }));
});

const BASE = { cpus: 2, memoryMb: 2048, mode: 'SAS' };

test('environment variables: names, values and the ones the app sets itself', () => {
  const ok = readRunOptions({ ...BASE, env: [{ name: 'SAS_SCR_METRICS', value: 'true' }, { name: '_x1', value: 'a=b c "q" C:\\x' }] });
  assert.deepEqual(ok.env, [
    { name: 'SAS_SCR_METRICS', value: 'true' },
    { name: '_x1', value: 'a=b c "q" C:\\x' },
  ]);
  assert.deepEqual(readRunOptions({ ...BASE, env: [{ name: 'EMPTY', value: '' }] }).env, [{ name: 'EMPTY', value: '' }]);
  for (const bad of [
    [{ name: '1ABC', value: 'x' }],
    [{ name: 'A-B', value: 'x' }],
    [{ name: '--privileged', value: 'x' }],
    [{ name: '', value: 'x' }],
    [{ name: 'A', value: 'line\nbreak' }],
    [{ name: 'A', value: 1 }],
    [{ name: 'A', value: 'x', extra: 1 }],
    [{ name: 'A', value: 'x' }, { name: 'A', value: 'y' }],
    [{ name: 'SAS_SCR_REST_API_TYPE', value: 'BATCH' }],
    [{ name: 'SAS_SCR_APP_PATH', value: '/other' }],
    [{ name: 'A', value: 'x'.repeat(4097) }],
    Array.from({ length: 51 }, (_, i) => ({ name: `V${i}`, value: '' })),
    'A=B',
  ]) {
    assert.throws(() => readRunOptions({ ...BASE, env: bad }), Error, `should refuse ${JSON.stringify(bad).slice(0, 60)}`);
  }
  assert.throws(() => readRunOptions({ ...BASE, env: [{ name: 'toString', value: 'x' }, { name: 'toString', value: 'y' }] }));
  assert.equal(readRunOptions({ ...BASE, env: [{ name: 'constructor', value: 'x' }] }).env[0].name, 'constructor');
});

test('environment variables: SCR logger names with dots are allowed', () => {
  const env = readRunOptions({ ...BASE, env: [{ name: 'SAS_SCR_LOG_LEVEL_App.tk.MAS.Service', value: 'DEBUG' }] }).env;
  assert.equal(env[0].name, 'SAS_SCR_LOG_LEVEL_App.tk.MAS.Service');
  for (const bad of ['.x', '1.x', 'a b', 'a=b']) {
    assert.throws(() => readRunOptions({ ...BASE, env: [{ name: bad, value: '' }] }), Error, `should refuse ${bad}`);
  }
});

test('SCR variable catalog: valid names, known groups, documented values only', () => {
  const file = path.resolve(__dirname, '../../../src/components/containers/scrEnvCatalog.json');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    groups: { id: string; appliesTo: string }[];
    entries: { name: string; group: string; kind: string; default?: string; suggested?: string; min?: number; description: string }[];
  };
  const groups = new Set(catalog.groups.map((g) => g.id));
  const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  const names = new Set<string>();
  for (const e of catalog.entries) {
    assert.ok(!names.has(e.name), `${e.name} twice`);
    names.add(e.name);
    // Every name gets through the main process's own check (and none is reserved).
    assert.doesNotThrow(() => readRunOptions({ ...BASE, env: [{ name: e.name, value: e.suggested ?? e.default ?? '' }] }), e.name);
    assert.ok(groups.has(e.group), `${e.name}: group ${e.group}`);
    assert.ok(e.description.length > 5, `${e.name}: description`);
    const values = [e.default, e.suggested].filter((v): v is string => v !== undefined);
    if (e.kind === 'level') for (const v of values) assert.ok(levels.includes(v), `${e.name}: ${v}`);
    else if (e.kind === 'boolean') for (const v of values) assert.ok(v === 'true' || v === 'false', `${e.name}: ${v}`);
    else if (e.kind === 'number') for (const v of values) assert.ok(Number.isFinite(Number(v)), `${e.name}: ${v}`);
    else assert.equal(e.kind, 'text', `${e.name}: kind`);
  }
  // Set elsewhere, or not usable with a container published on 127.0.0.1:8080 only.
  for (const left of ['SAS_SCR_REST_API_TYPE', 'SAS_SCR_APP_PATH', 'SAS_SCR_SSL_ENABLED', 'SAS_SCR_SSL_KEY', 'SAS_SCR_SSL_CERTIFICATE']) {
    assert.ok(!names.has(left), `${left} is not offered`);
  }
  assert.ok(![...names].some((n) => n.startsWith('SAS_SCR_BATCH_')), 'no Batch Agent variables');
});

test('folders: host path syntax on Windows and Linux', () => {
  assert.equal(readHostPath('C:\\Users\\me\\data\\', 'win32'), 'C:\\Users\\me\\data');
  assert.equal(readHostPath('C:/Users/me/My Data', 'win32'), 'C:\\Users\\me\\My Data');
  assert.equal(readHostPath('D:\\', 'win32'), 'D:\\');
  assert.equal(readHostPath('/home/me/data/', 'linux'), '/home/me/data');
  for (const bad of ['\\\\server\\share\\x', '//server/share', 'data', 'C:data', 'C:\\a,b', 'C:\\a"b', 'C:\\x\u0007', '']) {
    assert.throws(() => readHostPath(bad, 'win32'), Error, `should refuse ${JSON.stringify(bad)}`);
  }
  for (const bad of ['data', '~/data', '/a,b']) assert.throws(() => readHostPath(bad, 'linux'), Error, `should refuse ${bad}`);
});

test('folders: container paths stay away from the system, the runtime and /tmp', () => {
  const mount = (containerPath: string) => ({ hostPath: '/srv/in', containerPath, readOnly: true });
  assert.deepEqual(readRunOptions({ ...BASE, mounts: [mount('/data/')] }, 'linux').mounts, [mount('/data')]);
  assert.equal(readRunOptions({ ...BASE, mounts: [mount('/opt/models')] }, 'linux').mounts[0].containerPath, '/opt/models');
  assert.equal(readRunOptions({ ...BASE, mounts: [mount('/pybox/images')] }, 'linux').mounts[0].containerPath, '/pybox/images');
  for (const bad of ['/', '/tmp', '/tmp/x', '/opt', '/opt/scr/viya', '/etc', '/proc/1', '/usr/local/x', '/var', '/var/run/x', 'data', '/a/../etc', '/a b', '/a:b', '/a,b']) {
    assert.throws(() => readRunOptions({ ...BASE, mounts: [mount(bad)] }, 'linux'), Error, `should refuse ${bad}`);
  }
  assert.throws(() => readRunOptions({ ...BASE, mounts: [mount('/data'), mount('/data')] }, 'linux'));
  assert.throws(() => readRunOptions({ ...BASE, mounts: [mount('/data'), mount('/data/sub')] }, 'linux'));
  assert.throws(() => readRunOptions({ ...BASE, mounts: [{ hostPath: '/srv/in', containerPath: '/data' }] }, 'linux'));
  assert.throws(() => readRunOptions({ ...BASE, mounts: [{ ...mount('/data'), propagation: 'shared' }] }, 'linux'));
  assert.throws(() => readRunOptions({ ...BASE, mounts: Array.from({ length: 6 }, (_, i) => mount(`/d${i}`)) }, 'linux'));
});

test('paths overlap: same, inside, beside', () => {
  assert.ok(pathsOverlap('/a', '/a'));
  assert.ok(pathsOverlap('/a', '/a/b'));
  assert.ok(pathsOverlap('/a/b', '/a'));
  assert.ok(!pathsOverlap('/a', '/ab'));
  assert.ok(!pathsOverlap('/a/..b', '/a/c'));
  assert.ok(pathsOverlap('C:\\Users\\Me', 'c:\\users\\me\\.ssh', path.win32, true));
  assert.ok(!pathsOverlap('C:\\data', 'D:\\data', path.win32, true));
});

// A Windows computer as the main process sees it.
const WIN: HostFolderContext = {
  platform: 'win32',
  homeDir: 'C:\\Users\\me',
  userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\mas-scorer',
  tmpDir: 'C:\\Users\\me\\AppData\\Local\\Temp',
  env: { SystemRoot: 'C:\\WINDOWS', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData' },
};

/** Folders that exist, links (lower-case key → target) and files. */
function fakeFs(folders: string[], links: Record<string, string> = {}, files: string[] = []): FolderFs {
  const known = new Map([...folders, ...files].map((f) => [f.toLowerCase(), f]));
  return {
    realpath: (p) => {
      const target = links[p.toLowerCase()] ?? known.get(p.toLowerCase());
      if (!target) throw new Error('ENOENT');
      return target;
    },
    isDirectory: (p) => !files.some((f) => f.toLowerCase() === p.toLowerCase()),
  };
}

test('host folders: data folders pass with their real path; drives, home, keys, system and app data do not', () => {
  const folders = [
    'C:\\Users\\me\\Pictures\\leaves',
    'C:\\Users\\me',
    'C:\\Users',
    'C:\\',
    'D:\\',
    'C:\\Users\\me\\.ssh',
    'C:\\Users\\me\\AppData\\Roaming',
    'C:\\Users\\me\\AppData\\Roaming\\mas-scorer\\logs',
    'C:\\WINDOWS\\System32',
    'C:\\Program Files\\App',
    'C:\\Users\\me\\.local\\share\\containers\\podman',
    'C:\\Users\\me\\AppData\\Local\\Temp\\job1',
  ];
  const fsImpl = fakeFs(folders, { 'c:\\users\\me\\link': 'C:\\WINDOWS\\System32' }, ['C:\\Users\\me\\notes.txt']);
  const ok = checkHostFolder('c:\\users\\me\\pictures\\leaves', WIN, fsImpl);
  assert.deepEqual(ok, { ok: true, path: 'C:\\Users\\me\\Pictures\\leaves' });
  assert.equal(checkHostFolder('C:\\Users\\me\\AppData\\Local\\Temp\\job1', WIN, fsImpl).ok, true);
  const refused: Record<string, RegExp> = {
    'C:\\Users\\me': /holds .*\.ssh|holds .*mas-scorer/,
    'C:\\Users': /holds/,
    'C:\\': /whole drive/,
    'D:\\': /whole drive/,
    'C:\\Users\\me\\.ssh': /is a protected folder/,
    'C:\\Users\\me\\AppData\\Roaming': /holds .*mas-scorer/,
    'C:\\Users\\me\\AppData\\Roaming\\mas-scorer\\logs': /is inside .*mas-scorer/,
    'C:\\WINDOWS\\System32': /is inside C:\\WINDOWS/,
    'C:\\Program Files\\App': /is inside/,
    'C:\\Users\\me\\.local\\share\\containers\\podman': /is inside/,
    'C:\\Users\\me\\link': /is inside C:\\WINDOWS/,
    'C:\\Users\\me\\missing': /does not exist/,
    'C:\\Users\\me\\notes.txt': /not a folder/,
  };
  for (const [folder, why] of Object.entries(refused)) {
    const result = checkHostFolder(folder, WIN, fsImpl);
    assert.equal(result.ok, false, `should refuse ${folder}`);
    if (!result.ok) assert.match(result.reason, why, folder);
  }
});

test('host folders: Linux system folders and engine sockets', () => {
  const linux: HostFolderContext = {
    platform: 'linux',
    homeDir: '/home/me',
    userDataDir: '/home/me/.config/mas-scorer',
    tmpDir: '/tmp',
    env: { XDG_RUNTIME_DIR: '/run/user/1000' },
  };
  const fsImpl = fakeFs(['/srv/data', '/home/me/data', '/home/me', '/var', '/var/lib/docker', '/run/user/1000/podman', '/etc/x', '/']);
  assert.equal(checkHostFolder('/srv/data', linux, fsImpl).ok, true);
  assert.equal(checkHostFolder('/home/me/data', linux, fsImpl).ok, true);
  for (const bad of ['/home/me', '/var', '/var/lib/docker', '/run/user/1000/podman', '/etc/x', '/']) {
    assert.equal(checkHostFolder(bad, linux, fsImpl).ok, false, `should refuse ${bad}`);
  }
  // Linux paths are case-sensitive: /ETC is not /etc.
  assert.equal(checkHostFolder('/ETC', linux, fakeFs(['/ETC'])).ok, true);
});

test('container name: masscorer-<slug>-<hex>', () => {
  assert.equal(containerName('library/gb_test_risk', 'a1b2c3d4'), 'masscorer-gb_test_risk-a1b2c3');
  assert.match(containerName('team/' + 'x'.repeat(80), 'ffffff'), /^masscorer-x{30}-ffffff$/);
});

// --- run arguments ---

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  name: 'masscorer-gb_test_risk-a1b2c3',
  installId: '11111111-2222-3333-4444-555555555555',
  image: `${HARBOR}/library/gb_test_risk@sha256:${'b'.repeat(64)}`,
  platform: 'linux/amd64',
  hostPort: 18123,
  kind: 'scr',
  cpus: 2,
  memoryMb: 2048,
  mode: 'SAS',
  env: [],
  mounts: [],
  ...over,
});

test('run arguments: loopback only, hardened, explicit platform, image last', () => {
  const args = runArgs(spec());
  assert.equal(args[0], 'run');
  assert.equal(args.at(-1), spec().image);
  const publish = args.filter((_, i) => args[i - 1] === '-p');
  assert.deepEqual(publish, ['127.0.0.1:18123:8080']);
  assert.ok(args.includes('--read-only'));
  assert.equal(args[args.indexOf('--platform') + 1], 'linux/amd64');
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(args[args.indexOf('--tmpfs') + 1], '/tmp:rw,size=256m');
  assert.ok(args.includes('SAS_SCR_REST_API_TYPE=SAS'));
  for (const flag of FORBIDDEN_RUN_FLAGS) assert.ok(!args.includes(flag), `must not emit ${flag}`);
});

test('run arguments: folders as one --mount token each, variables as one --env token each', () => {
  const args = runArgs(
    spec({
      mounts: [
        { hostPath: 'C:\\Users\\me\\My Data', containerPath: '/data', readOnly: true },
        { hostPath: '/srv/out', containerPath: '/out', readOnly: false },
      ],
      env: [
        { name: 'SAS_SCR_METRICS', value: 'true' },
        { name: 'ODD', value: '--privileged -v /:/host' },
      ],
    })
  );
  assert.ok(args.includes('--mount=type=bind,source=C:\\Users\\me\\My Data,target=/data,readonly'));
  assert.ok(args.includes('--mount=type=bind,source=/srv/out,target=/out'));
  assert.ok(args.includes('--env=SAS_SCR_METRICS=true'));
  assert.ok(args.includes('--env=ODD=--privileged -v /:/host'));
  for (const flag of FORBIDDEN_RUN_FLAGS) assert.ok(!args.includes(flag), `must not emit ${flag}`);
  assert.ok(!args.includes('--mount') && !args.includes('--env'), 'flag and value always travel as one token');
  for (const a of args.filter((x) => x.startsWith('--mount'))) {
    assert.match(a, /^--mount=type=bind,source=[^,]+,target=\/[^,]+(,readonly)?$/);
  }
  assert.equal(args.at(-1), spec().image);
  // The app's own SCR setting comes before the user's variables (which may not name it).
  assert.ok(args.indexOf('SAS_SCR_REST_API_TYPE=SAS') < args.indexOf('--env=SAS_SCR_METRICS=true'));
});

test('run arguments: Python/R images get no read-only root and no SCR settings', () => {
  const args = runArgs(spec({ kind: 'other', platform: 'linux/arm64' }));
  assert.ok(!args.includes('--read-only'));
  assert.ok(!args.some((a) => a.startsWith('SAS_SCR_')));
  assert.equal(args[args.indexOf('--platform') + 1], 'linux/arm64');
});

// --- error classification ---

test('pull errors: Podman texts', () => {
  const podman = (s: string) => classifyPullError(s, 'podman', REF).code;
  assert.equal(
    podman(`Error: initializing source docker://${HARBOR}/no-such-project-spike/x:1: reading manifest 1 in ${HARBOR}/no-such-project-spike/x: unauthorized: project no-such-project-spike not found`),
    'not-found'
  );
  assert.equal(podman('reading manifest 1 in x: unauthorized: authentication required'), 'signin');
  assert.equal(
    podman(`Error: reading manifest no-such-tag-spike in ${HARBOR}/library/gb_test_risk: unknown: artifact library/gb_test_risk:no-such-tag-spike not found`),
    'not-found'
  );
  assert.equal(
    podman('Error: pinging container registry no-such-host-spike.invalid: Get "https://no-such-host-spike.invalid/v2/": dial tcp: lookup no-such-host-spike.invalid: no such host'),
    'network'
  );
  assert.equal(podman('reading manifest 1 in docker.io/no-such-user-spike-zz/x: requested access to the resource is denied'), 'signin');
});

test('pull errors: Docker texts', () => {
  const docker = (s: string) => classifyPullError(s, 'docker', REF).code;
  assert.equal(
    docker(`Error response from daemon: unknown: failed to resolve reference "${HARBOR}/no-such-project-spike/x:1": unexpected status from HEAD request to https://${HARBOR}/v2/no-such-project-spike/x/manifests/1: 401 Unauthorized`),
    'signin'
  );
  assert.equal(
    docker(`Error response from daemon: failed to resolve reference "${HARBOR}/library/gb_test_risk:no-such-tag-spike": ${HARBOR}/library/gb_test_risk:no-such-tag-spike: not found`),
    'not-found'
  );
  assert.equal(
    docker(`Error response from daemon: failed to resolve reference "${HARBOR}/library/gb_test_risk:latest": failed to do request: Head "https://${HARBOR}/v2/library/gb_test_risk/manifests/latest": tls: failed to verify certificate: x509: certificate signed by unknown authority`),
    'tls'
  );
  assert.equal(
    docker('Error response from daemon: failed to resolve reference "no-such-host-spike.invalid/x/y:1": failed to do request: Head "https://no-such-host-spike.invalid/v2/x/y/manifests/1": dial tcp: lookup no-such-host-spike.invalid on 10.255.255.254:53: no such host'),
    'network'
  );
  assert.equal(docker("Error response from daemon: pull access denied for no-such-user-spike-zz/x, repository does not exist or may require 'docker login'"), 'signin');
  assert.equal(docker('no matching manifest for linux/arm64/v8 in the manifest list entries'), 'no-platform');
});

test('sign-in: the command is separate and copyable; the hint never asks for a password', () => {
  const p = classifyPullError('401 Unauthorized', 'podman', REF);
  assert.equal(p.code, 'signin');
  assert.equal(p.command, `podman login ${HARBOR}`);
  assert.ok(!(p.hint ?? '').includes('podman login'));
  assert.match(p.hint ?? '', /never asks for, stores or passes on registry passwords/);
});

test('Harbor "project not found" is a path problem; the web-address prefix is offered without "harbor/"', () => {
  const repo = 'harbor/library/cv_resnet18_cu13_r4_618e974c34a84064b5797094932866e0';
  const output =
    `Error: initializing source docker://${HARBOR}/${repo}:latest: reading manifest latest in ${HARBOR}/${repo}: ` +
    'unauthorized: project harbor not found: project harbor not found';
  const p = classifyPullError(output, 'podman', { host: HARBOR, repo, tag: 'latest', digest: null });
  assert.equal(p.code, 'not-found');
  assert.equal(p.title, `${HARBOR} has no project "harbor"`);
  assert.equal(p.suggestedRef, `${HARBOR}/library/cv_resnet18_cu13_r4_618e974c34a84064b5797094932866e0:latest`);
  assert.equal(p.command, undefined);

  const other = classifyPullError('unauthorized: project no-such-project-spike not found', 'podman', {
    host: HARBOR,
    repo: 'no-such-project-spike/x',
    tag: '1',
    digest: null,
  });
  assert.equal(other.code, 'not-found');
  assert.equal(other.suggestedRef, undefined);
});

test('port in use (Docker leaves a Created container behind)', () => {
  assert.ok(isPortInUse('docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint x: Bind for 127.0.0.1:18081 failed: port is already allocated'));
  assert.ok(!isPortInUse('Error: no such image'));
});

test('early exit: no emulator, Docker and Podman (crun) wording', () => {
  const docker = classifyEarlyExit('2026-11-10T15:53:14Z exec /hello: exec format error', 255, 'arm64', 'amd64');
  assert.equal(docker.code, 'no-emulator');
  assert.match(docker.title, /can't run ARM images/);
  const podman = classifyEarlyExit('{"msg":"exec container process `/hello`: Exec format error","level":"error"}', 1, 'amd64', 'arm64');
  assert.equal(podman.code, 'no-emulator');
  assert.match(podman.title, /x86-64/);
  assert.match(podman.hint ?? '', /never installs an emulator/);
});

test('early exit: other start failures show the exit code and the log tail', () => {
  const p = classifyEarlyExit(
    'Unable to create tempDir. java.io.tmpdir is set to /tmp\njava.nio.file.FileSystemException: /tmp: Read-only file system',
    1,
    'amd64',
    'amd64'
  );
  assert.equal(p.code, 'exited');
  assert.match(p.title, /exit code 1/);
  assert.match(p.detail ?? '', /Read-only file system/);
});

test('run errors: a folder the engine cannot see', () => {
  const podman = classifyRunError(
    'Error: statfs /mnt/c/Users/me/AppData/Local/Temp/mnt-test/nope: no such file or directory'
  );
  assert.match(podman.title, /cannot see a folder/);
  const docker = classifyRunError(
    'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/x'
  );
  assert.match(docker.title, /cannot see a folder/);
  assert.equal(classifyRunError('Error: something else').title, 'The container could not be started');
});

test('redaction: tokens and URL credentials go, digests and paths stay', () => {
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.c2lnbmF0dXJlX2hlcmVfbG9uZw';
  assert.ok(!redact(`Authorization: Bearer ${jwt}`).includes(jwt));
  assert.equal(redact('https://robot:s3cr3t@registry.example.com/v2/'), 'https://[redacted]@registry.example.com/v2/');
  const digest = `sha256:${'0123456789abcdef'.repeat(4)}`;
  assert.ok(redact(`pulled ${digest}`).includes(digest));
  const path = '-Djava.library.path=/opt/scr/viya/home/SASFoundation/sasexe/with/more/parts';
  assert.equal(redact(path), path);
  assert.ok(redact('password=hunter2 ok').includes('password=[redacted]'));
});

// --- parsers ---

test('version: Docker Server.Arch and Podman Server.OsArch', () => {
  const docker = parseVersion(
    JSON.stringify({
      Client: { Version: '29.9.3', Os: 'linux', Arch: 'amd64' },
      Server: { Version: '29.9.3', Os: 'linux', Arch: 'arm64' },
    })
  );
  assert.equal(docker.arch, 'arm64');
  assert.equal(docker.serverVersion, '29.9.3');
  assert.ok(docker.serverReachable);
  const podman = parseVersion(
    JSON.stringify({
      Client: { Version: '5.6.2', OsArch: 'windows/amd64' },
      Server: { Version: '5.6.2', OsArch: 'linux/amd64', Os: 'linux' },
    })
  );
  assert.equal(podman.arch, 'amd64');
  assert.equal(podman.os, 'linux');
  const down = parseVersion(JSON.stringify({ Client: { Version: '29.9.3' }, Server: null }));
  assert.equal(down.serverReachable, false);
  assert.equal(parseVersion('').serverReachable, false);
});

test('ps: Docker JSON lines and the Podman array', () => {
  const docker = parsePs(
    [
      JSON.stringify({ ID: 'e206122aa7f6', Names: 'masscorer-a-1', State: 'running', Status: 'Up 46 seconds', Labels: 'a=1,b=x,y' }),
      JSON.stringify({ ID: 'b415be8641a1', Names: 'masscorer-b-2', State: 'exited', Status: 'Exited (255) 3 seconds ago' }),
    ].join('\n')
  );
  assert.deepEqual(docker.map((r) => [r.id, r.name, r.state]), [
    ['e206122aa7f6', 'masscorer-a-1', 'running'],
    ['b415be8641a1', 'masscorer-b-2', 'exited'],
  ]);
  const podman = parsePs(
    JSON.stringify([{ Id: '974eeda32785d9ee7ff1078f685eea8ecf08553bea3a5d39c0a194bd286726c0', Names: ['masscorer-c-3'], State: 'exited', Status: 'Exited (1) 9 seconds ago', ExitCode: 1, Labels: { a: '1' } }])
  );
  assert.equal(podman[0].name, 'masscorer-c-3');
  assert.equal(podman[0].exitCode, 1);
  assert.deepEqual(parsePs(''), []);
});

test('image inspect: SCR app path, kind and the digest of the pulled repository', () => {
  const scr = parseImageInspect(
    JSON.stringify([
      {
        Id: 'abc',
        Architecture: 'amd64',
        Os: 'linux',
        Size: 1397370185,
        RepoDigests: [`other.example.com/x/y@sha256:${'c'.repeat(64)}`, `${HARBOR}/library/gb_test_risk@sha256:${'d'.repeat(64)}`],
        Config: {
          Env: ['PATH=/usr/bin', 'SAS_SCR_APP_PATH=/gb_test_risk', 'MAS_PYPATH=/x'],
          Entrypoint: ['/usr/lib/jvm/jre/bin/java', '-cp', '/opt/scr/viya/home/solo', 'com.sas.mas.solo.Application'],
        },
      },
    ]),
    `${HARBOR}/library/gb_test_risk`
  );
  assert.ok(scr);
  assert.equal(scr.kind, 'scr');
  assert.equal(scr.appPath, 'gb_test_risk');
  assert.equal(scr.digestRef, `${HARBOR}/library/gb_test_risk@sha256:${'d'.repeat(64)}`);
  const python = parseImageInspect(
    JSON.stringify([{ Id: 'def', Architecture: 'amd64', Os: 'linux', RepoDigests: [], Config: { Env: ['PATH=/usr/bin'], Entrypoint: ['/bin/bash', 'startServer.sh'] } }]),
    `${HARBOR}/library/xgboost`
  );
  assert.ok(python);
  assert.equal(python.kind, 'other');
  assert.equal(python.appPath, null);
  assert.equal(python.digestRef, null);
});

test('container inspect: image ID and the values of the variables the app set', () => {
  const state = parseContainerInspect(
    JSON.stringify([
      {
        Image: 'f4c2e1',
        State: { Status: 'running', Running: true, ExitCode: 0 },
        Config: { Env: ['PATH=/usr/bin', 'container=podman', 'FOO=a=b', 'HOME=/root', 'FOO=later', 'EMPTY='] },
      },
    ])
  );
  assert.ok(state);
  assert.equal(state.image, 'f4c2e1');
  assert.deepEqual(envValues(state.env, ['FOO', 'EMPTY', 'GONE']), [
    { name: 'FOO', value: 'later' },
    { name: 'EMPTY', value: '' },
  ]);
});

test('store: records from before variables and folders get empty lists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-store-'));
  try {
    const file = path.join(dir, 'containers.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        installId: 'i',
        engineChoice: 'podman',
        owned: { m1: { managedId: 'm1', createdAt: '2026-11-11T00:00:00Z', options: { cpus: 2, memoryMb: 2048, mode: 'SAS' } } },
      })
    );
    const record = new ContainerStore(file).get('m1');
    assert.deepEqual(record?.options, { cpus: 2, memoryMb: 2048, mode: 'SAS', envNames: [], mounts: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sizes: decimal and binary units as the engines print them', () => {
  assert.equal(parseSize('0B'), 0);
  assert.equal(parseSize('126B'), 126);
  assert.equal(parseSize('1.04kB'), 1040);
  assert.equal(parseSize('73.58MB'), 73_580_000);
  assert.equal(parseSize('2.147GB'), 2_147_000_000);
  assert.equal(parseSize('512MiB'), 512 * 1024 * 1024);
  assert.equal(parseSize(' 1.766MiB '), Math.round(1.766 * 1024 * 1024));
  assert.equal(parseSize('2GiB'), 2 * 1024 ** 3);
  assert.equal(parseSize('--'), null);
  assert.equal(parseSize(undefined), null);
});

test('stats: Podman raw numbers and Docker text', () => {
  // Podman 5.6.2, stats --no-stream --format '{{json .}}'
  const podman = parseStats(
    '{"AvgCPU":0.0526,"ContainerID":"e29ea6dec83d935c3d1ae9f2af9487d0659b9d263f4bb0050cd545c753bc63bf","Name":"masscorer-cv-e06f21","PerCPU":null,"CPU":0.0526,"CPUNano":3746308000,"CPUSystemNano":807240,"SystemNano":1794407290197348349,"MemUsage":73584640,"MemLimit":2147483648,"MemPerc":3.43,"Network":{"eth0":{"RxBytes":14129,"TxBytes":3280},"eth1":{"RxBytes":1,"TxBytes":2}},"BlockInput":68964352,"BlockOutput":0,"PIDs":13,"UpTime":3746308000,"Duration":3746308000}'
  );
  assert.deepEqual(podman[0], {
    id: 'e29ea6dec83d935c3d1ae9f2af9487d0659b9d263f4bb0050cd545c753bc63bf',
    cpuPercent: 0.0526,
    cpuNano: 3746308000,
    systemNano: 1794407290197348349,
    memBytes: 73584640,
    memLimitBytes: 2147483648,
    memPercent: 3.43,
    pids: 13,
    netRxBytes: 14130,
    netTxBytes: 3282,
    blockReadBytes: 68964352,
    blockWriteBytes: 0,
  });
  // Docker 29.9.3, same command
  const docker = parseStats(
    '{"BlockIO":"4.96MB / 0B","CPUPerc":"12.50%","Container":"76a895525345bab515573dfda523dc974857f5b5c755eaa6b9cb7b1a1223dce3","ID":"76a895525345","MemPerc":"0.34%","MemUsage":"1.766MiB / 512MiB","Name":"x","NetIO":"1.04kB / 126B","PIDs":"1"}\n'
  );
  assert.equal(docker[0].id, '76a895525345bab515573dfda523dc974857f5b5c755eaa6b9cb7b1a1223dce3');
  assert.equal(docker[0].cpuPercent, 12.5);
  assert.equal(docker[0].cpuNano, undefined);
  assert.equal(docker[0].memLimitBytes, 512 * 1024 * 1024);
  assert.equal(docker[0].netRxBytes, 1040);
  assert.equal(docker[0].blockReadBytes, 4_960_000);
  assert.equal(docker[0].pids, 1);
  assert.deepEqual(parseStats(''), []);
});

test('engine capacity: Podman host and Docker NCPU/MemTotal', () => {
  assert.deepEqual(parseCapacity(JSON.stringify({ host: { cpus: 12, memTotal: 16421949440, memFree: 15148134400 } })), {
    cpus: 12,
    memTotalBytes: 16421949440,
    memFreeBytes: 15148134400,
  });
  assert.deepEqual(parseCapacity(JSON.stringify({ NCPU: 12, MemTotal: 16421949440, ServerVersion: '29.9.3' })), {
    cpus: 12,
    memTotalBytes: 16421949440,
    memFreeBytes: undefined,
  });
  assert.equal(parseCapacity('{}'), null);
});

test('model name from a SAS Python Runtime start-up log', () => {
  const log = [
    '2026-11-11 10:23:18 - root - INFO - Model files have been unzipped in /pybox/model',
    '2026-11-11 10:23:18 - root - INFO - The model name is derived from the ModelProperties.json file.',
    '2026-11-11T11:23:18+01:00 2026-11-11 10:23:18 - root - INFO - The model name is cv_resnet18_cu13_r4.',
    '2026-11-11 10:23:18 - root - INFO - Completed app initialization and setup!',
  ].join('\n');
  assert.equal(modelNameFromLog(log), 'cv_resnet18_cu13_r4');
  assert.equal(modelNameFromLog('2026-11-10 13:39:33 - root - INFO - The model name is XGBoost.'), 'XGBoost');
  assert.equal(modelNameFromLog('The model name is derived from the ModelProperties.json file.'), null);
  assert.equal(modelNameFromLog('The model name is ../../etc.'), null);
  assert.equal(modelNameFromLog('The model name is internal.'), null);
  assert.equal(modelNameFromLog('nothing here'), null);
});

test('engine endpoints: only this computer', () => {
  assert.ok(isLocalEngineUri('ssh://user@127.0.0.1:62181/run/user/1000/podman/podman.sock'));
  assert.ok(isLocalEngineUri('npipe:////./pipe/dockerDesktopLinuxEngine'));
  assert.ok(isLocalEngineUri('unix:///var/run/docker.sock'));
  assert.ok(isLocalEngineUri(null));
  assert.ok(!isLocalEngineUri('ssh://core@192.0.2.10:22/run/podman/podman.sock'));
  assert.ok(!isLocalEngineUri('tcp://127.0.0.1:2375'));
  assert.ok(!isLocalEngineUri('tcp://build-host:2376'));
});

// Docker 29.9.3, output piped, python:3.12-slim with its base layer already present.
const DOCKER_PULL = `3.12-slim: Pulling from library/python
05e0eee5572e: Pulling fs layer
2dc99d2d0a39: Pulling fs layer
37fb86c2a767: Pulling fs layer
68bced9e0afa: Pulling fs layer
37fb86c2a767: Already exists
05e0eee5572e: Download complete
2dc99d2d0a39: Download complete
f26199dfe4a6: Download complete
e0a5f9afcd02: Download complete
68bced9e0afa: Download complete
68bced9e0afa: Pull complete
2dc99d2d0a39: Pull complete
05e0eee5572e: Pull complete
Digest: sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
Status: Downloaded newer image for python:3.12-slim`.split('\n');

test('pull progress: Docker layer lines and Podman blob lines', () => {
  let p: ReturnType<typeof updatePullProgress> = { layersTotal: 0, layersDone: 0, text: '' };
  for (const line of DOCKER_PULL.slice(0, 6)) p = updatePullProgress(p, line);
  // "Already exists" after "Pulling fs layer" is the same layer, not another one.
  assert.equal(p.layersTotal, 4);
  assert.equal(p.layersDone, 1);
  for (const line of DOCKER_PULL.slice(6, 11)) p = updatePullProgress(p, line);
  // "Download complete" for blobs that are not layers (config, attestations) adds nothing.
  assert.equal(p.layersTotal, 4);
  assert.equal(p.layersDone, 1);
  for (const line of DOCKER_PULL.slice(11)) p = updatePullProgress(p, line);
  assert.equal(p.layersDone, 4);
  assert.equal(p.text, 'Finishing');

  let q: ReturnType<typeof updatePullProgress> = { layersTotal: 0, layersDone: 0, text: '' };
  for (const line of ['Trying to pull x...', `Copying blob sha256:${'1'.repeat(64)}`, `Copying blob sha256:${'2'.repeat(64)}`]) {
    q = updatePullProgress(q, line);
  }
  // Podman only says when a blob starts: no count of finished layers.
  assert.equal(q.layersDone, 0);
  assert.equal(q.text, 'Downloading');
  q = updatePullProgress(q, 'Writing manifest to image destination');
  assert.equal(q.text, 'Finishing');
});

// --- download progress ---

const D = (c: string) => `sha256:${c.repeat(64)}`;
const INDEX = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.index.v1+json',
  manifests: [
    { digest: D('a'), platform: { architecture: 'amd64', os: 'linux' } },
    { digest: D('b'), platform: { architecture: 'unknown', os: 'unknown' } },
    { digest: D('c'), platform: { architecture: 'arm', os: 'linux', variant: 'v7' } },
    { digest: D('d'), platform: { architecture: 'arm64', os: 'linux', variant: 'v8' } },
  ],
}, null, 3);

test('manifest: index entries and the platform the engine pulls', () => {
  const m = parseManifest(INDEX);
  assert.equal(m?.kind, 'index');
  if (m?.kind !== 'index') return;
  assert.equal(m.manifests.length, 4);
  assert.equal(pickPlatformManifest(m.manifests, 'amd64'), D('a'));
  assert.equal(pickPlatformManifest(m.manifests, 'arm64'), D('d'));
  assert.equal(pickPlatformManifest(m.manifests, undefined), D('a'));
  // No arm64 variant: the x86-64 one, which the app then pulls for emulation.
  assert.equal(pickPlatformManifest(m.manifests.filter((e) => e.arch !== 'arm64'), 'arm64'), D('a'));
  assert.equal(pickPlatformManifest(m.manifests.filter((e) => e.os !== 'linux'), 'amd64'), null);
});

test('manifest: layer sizes of one image, and refusals', () => {
  const image = parseManifest(JSON.stringify({
    schemaVersion: 2,
    config: { digest: D('9'), size: 7000 },
    layers: [{ digest: D('1'), size: 29856132 }, { digest: D('2'), size: 1290000 }],
  }));
  assert.deepEqual(image, { kind: 'image', layers: [{ digest: D('1'), size: 29856132 }, { digest: D('2'), size: 1290000 }] });
  assert.equal(parseManifest(JSON.stringify({ layers: [{ digest: 'sha256:short', size: 1 }] })), null);
  assert.equal(parseManifest(JSON.stringify({ layers: [{ digest: D('1') }] })), null);
  assert.equal(parseManifest('Error: manifest unknown'), null);
});

test('network counter lines and the default route', () => {
  assert.equal(parseNetDevRx('  eth0: 59453023   40430    0    0    0     0          0        57   259666    2647    0    0'), 59453023);
  assert.equal(parseNetDevRx('enp0s1:123 4 0 0'), 123);
  assert.equal(parseNetDevRx('Inter-|   Receive'), null);
  const route = 'Iface\tDestination\tGateway\tFlags\nveth0\t0011A8C0\t00000000\t0001\neth0\t00000000\t0101A8C0\t0003\n';
  assert.equal(defaultRouteInterface(route), 'eth0');
  assert.equal(defaultRouteInterface('Iface\tDestination\n'), null);
});

test('Podman layer store: digests and where it is', () => {
  const json = JSON.stringify([
    { id: 'x', 'compressed-diff-digest': D('1'), 'compressed-size': 29856132 },
    { id: 'y', 'diff-digest': D('7') },
  ]);
  assert.deepEqual([...parseLayerDigests(json)], [D('1')]);
  assert.deepEqual([...parseLayerDigests(`"compressed-diff-digest":"${D('2')}"\n"compressed-diff-digest":"${D('2')}"\n`)], [D('2')]);
  assert.deepEqual(parseStoreInfo(JSON.stringify({ store: { graphDriverName: 'overlay', graphRoot: '/var/lib/containers/storage' } })), {
    graphRoot: '/var/lib/containers/storage',
    driver: 'overlay',
  });
  assert.equal(parseStoreInfo(JSON.stringify({ store: { graphDriverName: 'over lay', graphRoot: '/x' } })), null);
});

test('machine scripts: fixed text, checked names and paths', () => {
  assert.deepEqual(machineSshArgs('podman-machine-default', NET_COUNTER_SCRIPT), ['machine', 'ssh', 'podman-machine-default', NET_COUNTER_SCRIPT]);
  assert.throws(() => machineSshArgs('-o ProxyCommand=x', 'true'));
  assert.throws(() => machineSshArgs('a b', 'true'));
  // The loop ends when its reader goes away, and after two hours at the latest.
  assert.match(NET_COUNTER_SCRIPT, /while \[ "\$i" -lt 7200 \] && grep/);
  const script = layerDigestsScript(['/var/lib/containers/storage/overlay-layers/layers.json']);
  assert.match(script, /^cat '\/var\/lib\/containers\/storage\/overlay-layers\/layers\.json' 2>\/dev\/null \| grep -o /);
  assert.throws(() => layerDigestsScript(["/x/'; rm -rf / #"]));
  assert.throws(() => layerDigestsScript(['/x/../etc/shadow']));
  assert.throws(() => layerDigestsScript(['relative/layers.json']));
});

test('download tracker: network counter, layers already present', () => {
  const t = new DownloadTracker('machine-network');
  assert.equal(t.snapshot(), undefined);
  t.sample(1_000_000, 0); // before the pull: not counted
  t.start();
  t.setLayers([{ digest: D('1'), size: 30_000_000 }, { digest: D('2'), size: 10_000_000 }, { digest: D('3'), size: 4_000_000 }]);
  t.setPresent(new Set([D('1')]));
  t.sample(3_000_000, 1000);
  t.sample(8_000_000, 2000);
  let s = t.snapshot();
  assert.equal(s?.totalBytes, 14_000_000);
  assert.equal(s?.totalIsUpperBound, undefined);
  assert.equal(s?.receivedBytes, 7_000_000);
  assert.equal(s?.rateBps, 3_500_000); // 7 MB over 2 s
  // Old readings drop out of the rate window.
  t.sample(11_000_000, 3000);
  t.sample(13_000_000, 4000);
  t.sample(13_000_000, 5000);
  s = t.snapshot();
  assert.equal(s?.receivedBytes, 12_000_000);
  assert.ok((s?.rateBps ?? 0) < 3_500_000);
  // Other traffic never pushes the count past the total.
  t.sample(99_000_000, 6000);
  assert.equal(t.snapshot()?.receivedBytes, 14_000_000);
});

test('download tracker: counter reset, no layer list', () => {
  const t = new DownloadTracker('host-network');
  t.start();
  t.sample(5_000, 0); // the first reading after the start is the baseline
  t.sample(1_005_000, 1000);
  t.sample(500, 2000); // interface reset
  t.sample(1_500, 3000);
  const s = t.snapshot();
  assert.equal(s?.receivedBytes, 1_001_000);
  assert.equal(s?.totalBytes, undefined);
  // Without the engine's layer list every layer counts, and the total says so.
  t.setLayers([{ digest: D('1'), size: 10 }]);
  assert.equal(t.snapshot()?.totalIsUpperBound, true);
});

test('download tracker: Docker Desktop counts finished layers', () => {
  const t = new DownloadTracker('layers');
  t.setLayers([
    { digest: `sha256:05e0eee5572e${'0'.repeat(52)}`, size: 12_000_000 },
    { digest: `sha256:2dc99d2d0a39${'0'.repeat(52)}`, size: 1_300_000 },
    { digest: `sha256:37fb86c2a767${'0'.repeat(52)}`, size: 29_856_132 },
    { digest: `sha256:68bced9e0afa${'0'.repeat(52)}`, size: 250 },
  ]);
  t.start();
  let s = t.snapshot();
  assert.equal(s?.totalIsUpperBound, true); // Docker has not said yet which layers it has
  for (const line of DOCKER_PULL.slice(0, 6)) t.line(line);
  s = t.snapshot();
  assert.equal(s?.totalBytes, 13_300_250);
  assert.equal(s?.totalIsUpperBound, undefined);
  assert.equal(s?.receivedBytes, 0);
  assert.equal(s?.rateBps, undefined);
  t.line('05e0eee5572e: Download complete');
  assert.equal(t.snapshot()?.receivedBytes, 12_000_000);
  for (const line of DOCKER_PULL.slice(7)) t.line(line);
  assert.equal(t.snapshot()?.receivedBytes, 13_300_250);
});

// --- anonymous manifest reads ---

const MANIFEST = JSON.stringify({ schemaVersion: 2, layers: [{ digest: `sha256:${'1'.repeat(64)}`, size: 5 }] });

/** A registry that wants a token for every manifest; `public` decides whether its token service hands out anonymous ones. */
function fakeRegistry(opts: { public: boolean; realm?: string }) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: AnonymousFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const respond = (status: number, body = '', headers: Record<string, string> = {}) => ({
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      text: async () => body,
    });
    if (url.startsWith('https://auth.example/token')) {
      return opts.public ? respond(200, JSON.stringify({ token: 'anon-token' })) : respond(401);
    }
    if (init.headers.Authorization === 'Bearer anon-token') return respond(200, MANIFEST);
    return respond(401, '', {
      'www-authenticate': `Bearer realm="${opts.realm ?? 'https://auth.example/token'}",service="harbor-registry",scope="repository:library/gb_test_risk:pull"`,
    });
  };
  return { fetch, calls };
}

test('anonymous manifest: public repository, token without credentials', async () => {
  const reg = fakeRegistry({ public: true });
  const text = await readManifestAnonymously(reg.fetch, 'registry.example', 'library/gb_test_risk', '1', new AbortController().signal);
  assert.equal(text, MANIFEST);
  assert.equal(reg.calls.length, 3);
  assert.equal(reg.calls[0].url, 'https://registry.example/v2/library/gb_test_risk/manifests/1');
  assert.equal(reg.calls[0].headers.Authorization, undefined);
  const token = new URL(reg.calls[1].url);
  assert.equal(token.searchParams.get('service'), 'harbor-registry');
  assert.equal(token.searchParams.get('scope'), 'repository:library/gb_test_risk:pull');
  // The token service is asked with no Authorization header at all.
  assert.deepEqual(reg.calls[1].headers, {});
});

test('anonymous manifest: private repository and odd challenges give nothing', async () => {
  const signal = new AbortController().signal;
  const priv = fakeRegistry({ public: false });
  assert.equal(await readManifestAnonymously(priv.fetch, 'registry.example', 'library/x', 'latest', signal), null);
  const http = fakeRegistry({ public: true, realm: 'http://auth.example/token' });
  assert.equal(await readManifestAnonymously(http.fetch, 'registry.example', 'library/x', 'latest', signal), null);
  assert.equal(http.calls.length, 1);
  assert.equal(parseBearerChallenge('Basic realm="x"'), null);
  assert.deepEqual(parseBearerChallenge('Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'), {
    realm: 'https://auth.docker.io/token',
    service: 'registry.docker.io',
    scope: undefined,
  });
  // Docker Hub's API lives at registry-1.docker.io.
  const hub = fakeRegistry({ public: true });
  await readManifestAnonymously(hub.fetch, 'docker.io', 'library/python', 'sha256:abc', signal);
  assert.equal(hub.calls[0].url, 'https://registry-1.docker.io/v2/library/python/manifests/sha256:abc');
});
