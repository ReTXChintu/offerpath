import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/segment_recorder.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/state/live_practice_controller.dart';

import '../support/fake_api.dart';
import '../support/fake_mic.dart';
import '../support/live_fixtures.dart';

void main() {
  const get = '/api/v1/live-practice/s1';

  test('after the end it checks back while a grade is being written', () async {
    var gets = 0;
    final fake = FakeApi();
    fake.routes['GET $get'] = (_) {
      gets++;
      return FakeReply.ok(
        liveViewJson(
          status: 'ENDED',
          questions: [
            gets < 2
                ? liveQuestionJson(spokenAnswer: 'x', grading: true)
                : liveQuestionJson(spokenAnswer: 'x', score: 7),
          ],
        ),
      );
    };
    final c = LivePracticeController(
      api: fake.client(),
      sessionId: 's1',
      initial: LivePracticeView.fromJson(
        liveViewJson(
          status: 'ENDED',
          questions: [liveQuestionJson(spokenAnswer: 'x', grading: true)],
        ),
      ),
      recorder: SegmentRecorder(recorder: FakeMicRecorder()),
      pollEvery: const Duration(milliseconds: 10),
    );
    addTearDown(c.dispose);

    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(gets, 2);
    expect(c.view!.questions.single.score, 7);
    expect(c.view!.anyGrading, isFalse);
  });

  test(
    'ending stops the mic, sends the last segment first, then ends',
    () async {
      final mic = FakeMicRecorder();
      final clock = ManualClock();
      final fake = FakeApi()
        ..on('POST', '$get/audio', FakeReply.ok(liveViewJson()))
        ..on('POST', '$get/end', FakeReply.ok(liveViewJson(status: 'ENDED')));
      final c = LivePracticeController(
        api: fake.client(),
        sessionId: 's1',
        initial: LivePracticeView.fromJson(liveViewJson()),
        recorder: SegmentRecorder(recorder: mic, clock: clock.call),
        pollEvery: const Duration(minutes: 5),
      );
      addTearDown(c.dispose);

      expect(await c.startListening(), isTrue);
      for (var i = 0; i < 6; i++) {
        clock.advance(const Duration(milliseconds: 100));
        mic.pushLevel(-20);
        await pumpEventQueue();
      }
      expect(await c.end(), isTrue);
      expect(c.listening, isFalse);
      expect(mic.recording, isFalse);
      expect(fake.requests.map((r) => r.path), ['$get/audio', '$get/end']);
      expect(c.isEnded, isTrue);
    },
  );
}
