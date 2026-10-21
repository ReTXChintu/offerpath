import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/live/upload_queue.dart';
import 'package:offerpath_mobile/models/live_practice.dart';
import 'package:offerpath_mobile/services/api_client.dart';

import '../support/live_fixtures.dart';

LivePracticeView view(String title) =>
    LivePracticeView.fromJson(liveViewJson(title: title));

void main() {
  test('uploads one at a time, in order; later ones wait', () async {
    final views = <String>[];
    final started = <int>[];
    final gates = [Completer<void>(), Completer<void>(), Completer<void>()];
    final queue = LiveUploadQueue(
      onView: (v) => views.add(v.title),
      onError: (m, e) => fail(m),
    );

    final results = <Future<bool>>[];
    for (var i = 0; i < 3; i++) {
      results.add(
        queue.add(() async {
          started.add(i);
          await gates[i].future;
          return view('v$i');
        }),
      );
    }
    await pumpEventQueue();
    expect(started, [0]);
    expect(queue.pending, 3);

    // The third finishing first changes nothing: it hasn't started.
    gates[2].complete();
    await pumpEventQueue();
    expect(started, [0]);

    gates[0].complete();
    await pumpEventQueue();
    expect(started, [0, 1]);
    expect(views, ['v0']);
    expect(queue.pending, 2);

    gates[1].complete();
    await queue.idle;
    expect(started, [0, 1, 2]);
    expect(views, ['v0', 'v1', 'v2']);
    expect(await Future.wait(results), [true, true, true]);
    expect(queue.busy, isFalse);
  });

  test('a failure is reported and the next one still goes', () async {
    final views = <String>[];
    final errors = <String>[];
    final queue = LiveUploadQueue(
      onView: (v) => views.add(v.title),
      onError: (m, e) => errors.add(m),
    );

    final first = queue.add(() async => view('a'));
    final second = queue.add(
      () async => throw const ApiException(
        status: 503,
        type: 'urn:offerpath:error:ai-unavailable',
        title: 'AI unavailable',
        detail: 'OpenAI timed out.',
      ),
    );
    final third = queue.add(
      () async => throw const ApiException(
        status: 0,
        type: 'network',
        title: "Couldn't reach the Offerpath server.",
        code: 'NETWORK',
      ),
    );
    final fourth = queue.add(() async => view('d'));
    await queue.idle;

    expect(views, ['a', 'd']);
    expect(errors, [
      'Missed a segment: OpenAI timed out.',
      "Missed a segment: Couldn't reach the Offerpath server.",
    ]);
    expect(await Future.wait([first, second, third, fourth]), [
      true,
      false,
      false,
      true,
    ]);
  });

  test('closing drops what is still waiting', () async {
    final gate = Completer<void>();
    final views = <String>[];
    final queue = LiveUploadQueue(
      onView: (v) => views.add(v.title),
      onError: (m, e) {},
    );
    final first = queue.add(() async {
      await gate.future;
      return view('a');
    });
    final second = queue.add(() async => view('b'));
    await pumpEventQueue();
    queue.close();
    expect(await second, isFalse);
    gate.complete();
    expect(await first, isTrue);
    expect(views, isEmpty);
  });
}
