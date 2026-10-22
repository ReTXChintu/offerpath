import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/speaker_model_store.dart';
import 'package:offerpath_mobile/models/live_practice.dart';

import '../support/fake_api.dart';

const _file = '/api/v1/downloads/speaker-model/file';
const _content = 'not really an onnx model, but bytes all the same';

SpeakerModelInfo _info({String? sha, String fileName = 'model.onnx'}) =>
    SpeakerModelInfo(
      fileName: fileName,
      sizeBytes: _content.length,
      sha256: sha ?? sha256.convert(utf8.encode(_content)).toString(),
      url: _file,
    );

void main() {
  late Directory dir;
  late FakeApi fake;
  late FileSpeakerModelStore store;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('speaker-model-');
    fake = FakeApi()
      ..on(
        'GET',
        _file,
        const FakeReply(200, _content, 'application/octet-stream'),
      );
    store = FileSpeakerModelStore(fake.client(), directory: () async => dir);
  });
  tearDown(() => dir.delete(recursive: true));

  test('downloads from the server, checks the sha256 and keeps it', () async {
    final info = _info();
    expect(await store.localPath(info), isNull);
    final progress = <double?>[];
    final path = await store.download(info, onProgress: progress.add);
    expect(await File(path).readAsString(), _content);
    expect(progress, isNotEmpty);
    expect(fake.requests.single.path, _file);
    // Next time it's there, without downloading again.
    expect(await store.localPath(info), path);
    expect(fake.requests, hasLength(1));
  });

  test('a damaged download is thrown away', () async {
    final info = _info(sha: '00' * 32);
    await expectLater(
      store.download(info),
      throwsA(isA<SpeakerModelException>()),
    );
    expect(await store.localPath(info), isNull);
    expect(dir.listSync(), isEmpty);
  });

  test('a new sha from the server means downloading again', () async {
    await store.download(_info());
    expect(await store.localPath(_info(sha: 'ff' * 32)), isNull);
  });

  test(
    'a file without its check is hashed once; a new model replaces the old one',
    () async {
      final info = _info();
      await File('${dir.path}/model.onnx').writeAsString(_content);
      expect(await store.localPath(info), endsWith('model.onnx'));
      expect(File('${dir.path}/model.onnx.sha256').existsSync(), isTrue);

      final other = _info(fileName: '../other.onnx');
      final path = await store.download(other);
      expect(path, endsWith('speaker-model.onnx'));
      expect(dir.listSync().map((e) => e.uri.pathSegments.last).toSet(), {
        'speaker-model.onnx',
        'speaker-model.onnx.sha256',
      });
    },
  );
}
