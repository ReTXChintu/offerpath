import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';

import '../../models/live_practice.dart';

/// One upload: a recorded segment or typed text, sent to the API.
typedef LiveUpload = Future<LivePracticeView> Function();

class _Job {
  _Job(this.run, this.failurePrefix);

  final LiveUpload run;
  final String failurePrefix;
  final done = Completer<bool>();
}

/// Sends uploads one at a time, in the order they were added; later ones
/// wait while one is in flight. Each reply (the whole session) goes to
/// [onView]. A failure (OpenAI down, no network) goes to [onError] as one
/// sentence ("Missed a segment: ...") and the queue moves on to the next.
class LiveUploadQueue extends ChangeNotifier {
  LiveUploadQueue({required this.onView, required this.onError});

  final void Function(LivePracticeView view) onView;
  final void Function(String message, Object error) onError;

  final Queue<_Job> _waiting = Queue();
  _Job? _current;
  bool _closed = false;
  Completer<void>? _idle;
  bool _draining = false;

  /// Uploads waiting or in flight.
  int get pending => _waiting.length + (_current == null ? 0 : 1);

  bool get busy => pending > 0;

  /// Adds an upload. Completes with whether it went through.
  Future<bool> add(
    LiveUpload upload, {
    String failurePrefix = 'Missed a segment',
  }) {
    final job = _Job(upload, failurePrefix);
    if (_closed) {
      job.done.complete(false);
      return job.done.future;
    }
    _waiting.add(job);
    notifyListeners();
    if (!_draining) unawaited(_drain());
    return job.done.future;
  }

  /// Completes once nothing is waiting or in flight.
  Future<void> get idle {
    if (!busy) return Future.value();
    return (_idle ??= Completer<void>()).future;
  }

  Future<void> _drain() async {
    _draining = true;
    while (_waiting.isNotEmpty && !_closed) {
      final job = _current = _waiting.removeFirst();
      var ok = false;
      try {
        final view = await job.run();
        if (!_closed) onView(view);
        ok = true;
      } catch (error) {
        if (!_closed) {
          onError('${job.failurePrefix}: ${liveErrorMessage(error)}', error);
        }
      }
      _current = null;
      job.done.complete(ok);
      if (!_closed) notifyListeners();
    }
    _draining = false;
    final idle = _idle;
    _idle = null;
    if (idle != null && !idle.isCompleted) idle.complete();
  }

  /// Drops what's still waiting (leaving the screen); the upload in flight
  /// finishes but its reply is ignored.
  void close() {
    _closed = true;
    for (final job in _waiting) {
      job.done.complete(false);
    }
    _waiting.clear();
    final idle = _idle;
    _idle = null;
    if (idle != null && !idle.isCompleted) idle.complete();
  }

  @override
  void dispose() {
    close();
    super.dispose();
  }
}
