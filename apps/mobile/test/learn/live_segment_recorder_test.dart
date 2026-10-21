import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/segment_recorder.dart';

import '../support/fake_mic.dart';

const speech = -20.0;
const quiet = -70.0;
const tick = Duration(milliseconds: 100);

void main() {
  group('SpeechDetector', () {
    SegmentDecision feed(
      SpeechDetector d,
      Duration Function() now,
      void Function() step,
      double db,
      int samples,
    ) {
      var last = SegmentDecision.none;
      for (var i = 0; i < samples; i++) {
        step();
        last = d.add(db, now());
        if (last != SegmentDecision.none) return last;
      }
      return last;
    }

    test('cuts 1.2 s after the speech stops', () {
      final clock = ManualClock();
      final d = SpeechDetector()..reset(Duration.zero);
      expect(
        feed(d, clock.call, () => clock.advance(tick), speech, 10),
        SegmentDecision.none,
      );
      expect(
        feed(d, clock.call, () => clock.advance(tick), quiet, 11),
        SegmentDecision.none,
      );
      expect(
        feed(d, clock.call, () => clock.advance(tick), quiet, 1),
        SegmentDecision.cut,
      );
      expect(clock.now, const Duration(milliseconds: 2200));
    });

    test('a short blip is discarded, not uploaded', () {
      final clock = ManualClock();
      final d = SpeechDetector()..reset(Duration.zero);
      feed(d, clock.call, () => clock.advance(tick), speech, 1);
      expect(
        feed(d, clock.call, () => clock.advance(tick), quiet, 20),
        SegmentDecision.discard,
      );
    });

    test('the threshold follows a noisy room', () {
      final clock = ManualClock();
      final d = SpeechDetector(threshold: -40, noiseMargin: 12)
        ..reset(Duration.zero);
      // A steady -50 dBFS hum lifts the bar to 12 dB above it.
      for (var i = 0; i < 5; i++) {
        clock.advance(tick);
        d.add(-50, clock.now);
      }
      expect(d.noiseFloor, -50);
      expect(d.effectiveThreshold, -38);
      clock.advance(tick);
      d.add(-39, clock.now);
      expect(d.speaking, isFalse);
      clock.advance(tick);
      d.add(-30, clock.now);
      expect(d.speaking, isTrue);
    });
  });

  group('SegmentRecorder', () {
    late FakeMicRecorder mic;
    late ManualClock clock;
    late SegmentRecorder recorder;
    late List<RecordedSegment> segments;

    setUp(() async {
      mic = FakeMicRecorder();
      clock = ManualClock();
      recorder = SegmentRecorder(recorder: mic, clock: clock.call);
      segments = [];
      recorder.segments.listen(segments.add);
      await recorder.start();
    });

    tearDown(() => recorder.dispose());

    Future<void> feed(double db, int samples) async {
      for (var i = 0; i < samples; i++) {
        clock.advance(tick);
        mic.pushLevel(db);
        await pumpEventQueue();
      }
    }

    test(
      'speech then 1.2 s of silence is one segment, and recording goes on',
      () async {
        await feed(speech, 15);
        expect(recorder.speaking.value, isTrue);
        expect(recorder.level.value, greaterThan(0.5));
        await feed(quiet, 12);
        expect(segments, hasLength(1));
        expect(segments.single.durationMs, 2700);
        expect(segments.single.bytes, [1]);
        // Restarted at once for the next segment.
        expect(mic.starts, 2);
        expect(mic.recording, isTrue);
        expect(recorder.speaking.value, isFalse);

        // The next one is timed from the restart.
        await feed(speech, 5);
        await feed(quiet, 12);
        expect(segments, hasLength(2));
        expect(segments.last.durationMs, 1700);
      },
    );

    test('pure silence uploads nothing; the recording is restarted', () async {
      await feed(quiet, 250);
      expect(segments, isEmpty);
      expect(mic.stops, greaterThan(0));
      expect(mic.recording, isTrue);
    });

    test('a segment never runs past 30 s', () async {
      await feed(speech, 305);
      expect(segments, hasLength(1));
      expect(segments.single.durationMs, 30000);
      expect(mic.recording, isTrue);
    });

    test('stopping sends what was said so far, and only that', () async {
      await feed(speech, 8);
      await recorder.stop();
      expect(segments, hasLength(1));
      expect(segments.single.durationMs, 800);
      expect(mic.recording, isFalse);
      expect(recorder.level.value, 0);

      await recorder.start();
      await feed(quiet, 5);
      await recorder.stop();
      expect(segments, hasLength(1));
    });

    test('stop without flush drops the segment', () async {
      await feed(speech, 8);
      await recorder.stop(flush: false);
      expect(segments, isEmpty);
    });
  });
}
