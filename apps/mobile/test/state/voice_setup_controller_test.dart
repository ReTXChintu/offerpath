import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/voice_math.dart';
import 'package:offerpath_mobile/learn/live/voice_repository.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/state/voice_setup_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/fake_voice.dart';

const _voice = '/api/v1/live-practice/voice';
const _model = '/api/v1/downloads/speaker-model';

class _Rig {
  _Rig({
    Map<String, Object?>? profile,
    String? modelPath = '/models/$speakerModelFile',
    List<List<double>>? embeddings,
  }) : models = FakeModelStore(path: modelPath),
       embedder = FakeEmbedder(queue: embeddings) {
    api.on('GET', _model, FakeReply.ok(speakerModelJson()));
    api.on(
      'GET',
      _voice,
      profile == null
          ? FakeReply.problem(404, 'not-found', 'No voice profile')
          : FakeReply.ok(profile),
    );
    api.routes['PUT $_voice'] = (r) {
      final body = (r.body as Map).cast<String, dynamic>();
      return FakeReply.ok({...body, 'updatedAt': '2026-10-21T11:00:00.000Z'});
    };
    api.routes['PATCH $_voice'] = (r) {
      final body = (r.body as Map).cast<String, dynamic>();
      return FakeReply.ok(
        voiceProfileJson(threshold: body['threshold'] as double),
      );
    };
    api.on('DELETE', _voice, const FakeReply(204));
    c = VoiceSetupController(
      repo: fakeVoiceRepo(
        api.client(),
        models: models,
        embedder: embedder,
        mic: mic,
        cache: cache,
      ),
    );
  }

  final api = FakeApi();
  final FakeModelStore models;
  final FakeEmbedder embedder;
  final mic = FakeLiveMic();
  final cache = MemoryVoiceCache();
  late final VoiceSetupController c;

  /// Records [audio] as one take (or test) and stops.
  Future<void> record(List<int> audio, {bool test = false}) async {
    await (test ? c.recordTest() : c.recordTake());
    mic.push(audio);
    await pumpEventQueue();
    await c.stopRecording();
  }

  List<FakeRequest> sent(String method) => api.requests
      .where((r) => r.method == method && r.path == _voice)
      .toList();
}

void main() {
  test(
    'three takes are embedded and saved as one averaged, normalised voiceprint',
    () async {
      final rig = _Rig(
        embeddings: [
          [3, 4, 0],
          [0, 10, 0],
          [0, 0, 2],
        ],
      );
      addTearDown(rig.c.dispose);
      await rig.c.load();
      expect(rig.c.step, VoiceStep.enrol);
      expect(rig.c.sentence, voiceSentences[0]);

      await rig.record(tone(4000, 0.4));
      expect(rig.c.take, 1);
      expect(rig.c.sentence, voiceSentences[1]);
      expect(rig.c.takeProblem, isNull);
      // The take reached the model trimmed and at 16 kHz (4 s at most).
      expect(rig.embedder.calls.single.length, lessThanOrEqualTo(4 * 16000));
      expect(rig.embedder.calls.single.length, greaterThan(3 * 16000));
      expect(rig.sent('PUT'), isEmpty);

      await rig.record(tone(4500, 0.4));
      await rig.record(tone(5000, 0.4));

      final put = rig.sent('PUT').single.body as Map;
      expect(put['model'], speakerModelFile);
      expect(put['threshold'], defaultVoiceThreshold);
      final expected = averageVoiceprint([
        [3, 4, 0],
        [0, 10, 0],
        [0, 0, 2],
      ]);
      final embedding = (put['embedding'] as List).cast<double>();
      expect(embedding, [for (final v in expected) closeTo(v, 1e-6)]);
      expect(cosineSimilarity(embedding, embedding), closeTo(1, 1e-6));

      expect(rig.c.step, VoiceStep.ready);
      expect(rig.c.profile!.model, speakerModelFile);
      // Kept on the phone too.
      expect(rig.cache.profile!.embedding, embedding);
      expect(rig.mic.starts, 3);
    },
  );

  test(
    'a take that is too quiet or too short is refused and read again',
    () async {
      final rig = _Rig();
      addTearDown(rig.c.dispose);
      await rig.c.load();

      await rig.record(tone(4000, 0.002));
      expect(rig.c.take, 0);
      expect(rig.c.takeProblem, contains('too quiet'));

      await rig.record(tone(1000, 0.4));
      expect(rig.c.take, 0);
      expect(rig.c.takeProblem, contains('too short'));
      expect(rig.embedder.calls, isEmpty);

      // Silence around the words doesn't count against it.
      await rig.record([
        ...tone(1500, 0),
        ...tone(3000, 0.4),
        ...tone(1500, 0),
      ]);
      expect(rig.c.take, 1);
      expect(rig.c.takeProblem, isNull);
      expect(rig.embedder.calls.single.length, lessThan(3500 * 16));
    },
  );

  test('a refused microphone says so', () async {
    final rig = _Rig();
    rig.mic.permission = false;
    addTearDown(rig.c.dispose);
    await rig.c.load();
    await rig.c.recordTake();
    expect(rig.c.recording, isFalse);
    expect(rig.c.takeProblem, voiceMicDeniedMessage);
  });

  test('without the model on the phone it downloads it first', () async {
    final rig = _Rig(modelPath: null);
    addTearDown(rig.c.dispose);
    await rig.c.load();
    expect(rig.c.step, VoiceStep.model);
    expect(rig.c.model!.sizeBytes, 26 * 1024 * 1024);

    rig.models.failWith = Exception('disk full');
    await rig.c.downloadModel();
    expect(rig.c.step, VoiceStep.model);
    expect(rig.c.error, contains('disk full'));

    final progress = <double?>[];
    rig.c.addListener(() => progress.add(rig.c.progress));
    await rig.c.downloadModel();
    expect(rig.models.downloads, 2);
    expect(progress, containsAll([0.5, 1.0]));
    expect(rig.c.step, VoiceStep.enrol);
    expect(rig.c.error, isNull);
  });

  test('a voiceprint from another model means recording again', () async {
    final rig = _Rig(profile: voiceProfileJson(model: 'old-model.onnx'));
    addTearDown(rig.c.dispose);
    await rig.c.load();
    expect(rig.c.step, VoiceStep.enrol);
    expect(rig.c.profileOutdated, isTrue);
  });

  test('test mode shows the similarity and the verdict; the slider saves the threshold', () async {
    final rig = _Rig(profile: voiceProfileJson(threshold: 0.6));
    addTearDown(rig.c.dispose);
    await rig.c.load();
    expect(rig.c.step, VoiceStep.ready);
    expect(rig.c.threshold, 0.6);

    await rig.record(tone(2000, ownerVoice), test: true);
    expect(rig.c.testSimilarity, closeTo(1, 1e-6));
    expect(rig.c.testRecognised, isTrue);

    await rig.record(tone(2000, otherVoice), test: true);
    expect(rig.c.testSimilarity, closeTo(0, 1e-6));
    expect(rig.c.testRecognised, isFalse);
    // A test never changes the voiceprint.
    expect(rig.sent('PUT'), isEmpty);

    rig.c.previewThreshold(0.25);
    expect(rig.sent('PATCH'), isEmpty);
    await rig.c.saveThreshold(0.25);
    expect(rig.sent('PATCH').single.body, {'threshold': 0.25});
    expect(rig.c.profile!.threshold, 0.25);
    expect(rig.cache.profile!.threshold, 0.25);

    // Out of range is kept in range.
    await rig.c.saveThreshold(0.95);
    expect(rig.sent('PATCH').last.body, {'threshold': 0.8});
  });

  test('a failed threshold save goes back and says why', () async {
    final rig = _Rig(profile: voiceProfileJson(threshold: 0.5));
    rig.api.on(
      'PATCH',
      _voice,
      FakeReply.problem(500, 'internal', 'Server error'),
    );
    addTearDown(rig.c.dispose);
    await rig.c.load();
    await rig.c.saveThreshold(0.7);
    expect(rig.c.threshold, 0.5);
    expect(rig.c.takeActionError(), 'Server error');
  });

  test('record again and delete', () async {
    final rig = _Rig(profile: voiceProfileJson());
    addTearDown(rig.c.dispose);
    await rig.c.load();

    rig.c.recordAgain();
    expect(rig.c.step, VoiceStep.enrol);
    rig.c.cancelRecordAgain();
    expect(rig.c.step, VoiceStep.ready);

    expect(await rig.c.deleteVoice(), isTrue);
    expect(rig.sent('DELETE'), hasLength(1));
    expect(rig.c.profile, isNull);
    expect(rig.c.step, VoiceStep.enrol);
    expect(rig.cache.profile, isNull);
  });

  test('without a model on the server it says so', () async {
    final rig = _Rig();
    rig.api.on('GET', _model, FakeReply.problem(404, 'not-found', 'No model'));
    addTearDown(rig.c.dispose);
    await rig.c.load();
    expect(rig.c.step, VoiceStep.failed);
    expect(rig.c.error, contains("doesn't have the voice model"));
  });
}
