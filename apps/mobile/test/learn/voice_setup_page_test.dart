import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/voice_setup_page.dart';
import 'package:offerpath_mobile/state/voice_setup_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_realtime.dart';
import '../support/fake_voice.dart';

const _voice = '/api/v1/live-practice/voice';
const _model = '/api/v1/downloads/speaker-model';

void main() {
  late FakeLiveMic mic;
  late FakeModelStore models;

  setUp(() {
    mic = FakeLiveMic();
    models = FakeModelStore();
  });

  FakeApi server({Map<String, Object?>? profile}) {
    final fake = FakeApi()
      ..on('GET', _model, FakeReply.ok(speakerModelJson()))
      ..on('DELETE', _voice, const FakeReply(204));
    if (profile != null) fake.on('GET', _voice, FakeReply.ok(profile));
    fake.routes['PUT $_voice'] = (r) => FakeReply.ok({
      ...(r.body as Map).cast<String, dynamic>(),
      'updatedAt': '2026-10-21T11:00:00.000Z',
    });
    fake.routes['PATCH $_voice'] = (r) => FakeReply.ok(
      voiceProfileJson(threshold: (r.body as Map)['threshold'] as double),
    );
    return fake;
  }

  Future<void> open(WidgetTester tester, FakeApi fake) async {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: VoiceSetupPage(
          voice: fakeVoiceRepo(fake.client(), models: models, mic: mic),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Taps [button], "speaks" [audio], and taps Stop.
  Future<void> speak(
    WidgetTester tester,
    String button,
    List<int> audio,
  ) async {
    await tester.tap(find.widgetWithText(FilledButton, button));
    await tester.pump();
    mic.push(audio);
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'download the model, read three sentences, and the voice is saved',
    (tester) async {
      final fake = server();
      await open(tester, fake);

      expect(find.text('Step 1 of 2: the voice model'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Download (26 MB)'));
      await tester.pumpAndSettle();
      expect(models.downloads, 1);

      expect(find.text('Sentence 1 of 3'), findsOneWidget);
      expect(find.text('“${voiceSentences[0]}”'), findsOneWidget);

      // Too quiet: read it again.
      await speak(tester, 'Record', tone(4000, 0.001));
      expect(find.byKey(const ValueKey('voice-take-problem')), findsOneWidget);
      expect(find.text('Sentence 1 of 3'), findsOneWidget);

      await speak(tester, 'Record', tone(4000, ownerVoice));
      expect(find.text('Sentence 2 of 3'), findsOneWidget);
      expect(find.text('“${voiceSentences[1]}”'), findsOneWidget);
      await speak(tester, 'Record the next one', tone(4000, ownerVoice));
      await speak(tester, 'Record the next one', tone(4000, ownerVoice));

      final put = fake.requests.singleWhere((r) => r.method == 'PUT');
      expect((put.body as Map)['model'], speakerModelFile);
      expect((put.body as Map)['embedding'], [1.0, 0.0]);
      expect(find.text('Your voice is set up'), findsOneWidget);
    },
  );

  testWidgets(
    'test mode shows the verdict; the slider saves the threshold; delete asks first',
    (tester) async {
      models.path = '/models/$speakerModelFile';
      final fake = server(profile: voiceProfileJson(threshold: 0.5));
      await open(tester, fake);
      expect(find.text('Your voice is set up'), findsOneWidget);
      expect(find.text('0.50'), findsOneWidget);

      await speak(tester, 'Test', tone(2000, otherVoice));
      expect(find.text('Another voice'), findsOneWidget);
      expect(find.textContaining('Similarity 0.00'), findsOneWidget);

      await speak(tester, 'Test', tone(2000, ownerVoice));
      expect(find.text('Recognised as you'), findsOneWidget);
      expect(find.textContaining('Similarity 1.00'), findsOneWidget);

      // Drag to the far left: 0.20.
      await tester.drag(
        find.byKey(const ValueKey('voice-threshold')),
        const Offset(-2000, 0),
      );
      await tester.pumpAndSettle();
      final patch = fake.requests.singleWhere((r) => r.method == 'PATCH');
      expect(patch.body, {'threshold': 0.2});
      expect(find.text('0.20'), findsOneWidget);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(fake.requests.last.method, 'DELETE');
      expect(find.text('Sentence 1 of 3'), findsOneWidget);
    },
  );

  testWidgets('a voiceprint from another model asks to record again', (
    tester,
  ) async {
    models.path = '/models/$speakerModelFile';
    await open(tester, server(profile: voiceProfileJson(model: 'old.onnx')));
    expect(find.text('Record your voice again'), findsOneWidget);
    expect(find.text('Sentence 1 of 3'), findsOneWidget);
  });
}
